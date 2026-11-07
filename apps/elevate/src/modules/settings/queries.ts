import "server-only";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isRoleSlug, type PayrollLevel, type RoleSlug } from "@/lib/roles";
import { employees } from "@/modules/people/schema";
import { auditLog } from "@/modules/audit/schema";
import { invitations, userRoles, users } from "@/modules/core/schema";
import { currentSignatory } from "@/modules/payroll/signatory";
import { auditQuerySchema } from "./validators";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";

export type PersonRow = {
  id: string;
  email: string;
  isSafevoiceHandler: boolean;
  archived: boolean;
  createdAt: Date;
  roles: RoleSlug[];
};

export async function listPeopleWithRoles(): Promise<PersonRow[]> {
  const actor = await requireUser();
  await authorize(actor, "settings.manage_roles");

  const people = await db.select().from(users).orderBy(users.email);
  const roleRows = await db.select({ userId: userRoles.userId, slug: userRoles.roleSlug }).from(userRoles);

  const byUser = new Map<string, RoleSlug[]>();
  for (const { userId, slug } of roleRows) {
    if (!isRoleSlug(slug)) continue;
    byUser.set(userId, [...(byUser.get(userId) ?? []), slug]);
  }

  return people.map((p) => ({
    id: p.id,
    email: p.email,
    isSafevoiceHandler: p.isSafevoiceHandler,
    archived: p.archivedAt !== null,
    createdAt: p.createdAt,
    roles: byUser.get(p.id) ?? [],
  }));
}

export type InvitationRow = {
  id: string;
  email: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  invitedByEmail: string | null;
  /** What they get on top of Employee when they first sign in, as chosen in the invitation. */
  roles: string[];
  isSafevoiceHandler: boolean;
};

export async function listInvitations(): Promise<InvitationRow[]> {
  const actor = await requireUser();
  await authorize(actor, "invitations.create");

  // Only someone who may give roles sees what was chosen: who is a Safe Voice handler in particular is not for HR to read off this list.
  const seesGrants = can(actor, "settings.manage_roles");
  const rows = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      invitedByEmail: users.email,
      roles: invitations.roles,
      isSafevoiceHandler: invitations.isSafevoiceHandler,
    })
    .from(invitations)
    .leftJoin(users, eq(users.id, invitations.invitedBy))
    .orderBy(desc(invitations.createdAt))
    .limit(200);
  return rows.map((r) => (seesGrants ? r : { ...r, roles: [], isSafevoiceHandler: false }));
}

export type PayrollAccessRow = { userId: string; name: string; email: string; level: PayrollLevel | null };

/** Active sign-in accounts, so a Super Admin can pick who has payroll access. Names and levels only, no pay figures. */
export async function getPayrollAccessList(): Promise<PayrollAccessRow[]> {
  const actor = await requireUser();
  await authorize(actor, "settings.set_payroll_access");

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      level: users.payrollAccess,
      first: employees.legalFirstName,
      last: employees.legalLastName,
      preferred: employees.preferredName,
    })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(isNull(users.archivedAt))
    .orderBy(users.email);

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.first ? `${r.preferred?.trim() || r.first} ${r.last}` : r.email,
    level: (r.level as PayrollLevel | null) ?? null,
  }));
}

export type PayrollSignatoryView = { name: string; title: string; signatureDataUrl: string | null; signatureUnreadable: boolean };

/** The name, title and signature printed on payslips, for the Super Admin's page. Null when nobody has been set yet. */
export async function getPayrollSignatory(): Promise<PayrollSignatoryView | null> {
  const actor = await requireUser();
  await authorize(actor, "settings.set_payroll_signatory");

  const current = await currentSignatory(db);
  if (!current) return null;
  return {
    name: current.name,
    title: current.title,
    signatureDataUrl: current.signatureBase64 ? `data:image/jpeg;base64,${current.signatureBase64}` : null,
    signatureUnreadable: current.signatureUnreadable,
  };
}

export async function listAuditEntries(rawQuery: unknown) {
  const actor = await requireUser();
  await authorize(actor, "settings.view_audit");

  const parsed = auditQuerySchema.safeParse(rawQuery);
  const { page, size, action } = parsed.success ? parsed.data : { page: 1, size: DEFAULT_PAGE_SIZE, action: undefined };
  const where = action ? sql`${auditLog.action} like ${action + "%"}` : undefined;

  const rows = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(size)
    .offset((page - 1) * size);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(where);

  return { rows, page, total, pageSize: size, action: action ?? "" };
}
