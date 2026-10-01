import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isRoleSlug, type RoleSlug } from "@/lib/roles";
import { auditLog } from "@/modules/audit/schema";
import { invitations, userRoles, users } from "@/modules/core/schema";
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
};

export async function listInvitations(): Promise<InvitationRow[]> {
  const actor = await requireUser();
  await authorize(actor, "invitations.create");

  return db
    .select({
      id: invitations.id,
      email: invitations.email,
      createdAt: invitations.createdAt,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      invitedByEmail: users.email,
    })
    .from(invitations)
    .leftJoin(users, eq(users.id, invitations.invitedBy))
    .orderBy(desc(invitations.createdAt))
    .limit(200);
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
