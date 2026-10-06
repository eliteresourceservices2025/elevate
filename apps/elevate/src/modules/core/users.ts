import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { BASE_ROLE, isRoleSlug, type RoleSlug } from "@/lib/roles";
import { writeAudit } from "@/modules/audit/write";
import { linkEmployeeToUser } from "@/modules/people/service";
import { needsProvisioning } from "./provision-rules";
import { invitations, userRoles, users } from "./schema";

export type CoreUser = {
  id: string;
  email: string;
  archivedAt: Date | null;
  isSafevoiceHandler: boolean;
  roles: RoleSlug[];
};

function superAdminEmails(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * First verified sign-in: create the core.users row, mark the invitation accepted, give the
 * base Employee role, and, only while no Super Admin exists yet, promote an email listed in
 * SUPER_ADMIN_EMAILS. Sign-up itself is gated earlier by the before-user-created auth hook.
 */
export async function provisionCoreUser(input: { id: string; email: string }): Promise<CoreUser> {
  const email = input.email.toLowerCase();

  return db.transaction(async (tx) => {
    // If another request is setting up the same account, fail in seconds instead of queueing behind it for minutes.
    await tx.execute(sql`set local lock_timeout = '5s'`);
    await tx.insert(users).values({ id: input.id, email }).onConflictDoNothing({ target: users.id });

    // Marks the invitation accepted and reads what the Super Admin chose for this person. Only the first set-up gets a row back, so the
    // choices are applied exactly once, and an invitation that had already run out gives nothing.
    const [accepted] = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(sql`lower(${invitations.email}) = ${email}`, isNull(invitations.acceptedAt)))
      .returning({ roles: invitations.roles, isSafevoiceHandler: invitations.isSafevoiceHandler, invitedBy: invitations.invitedBy, expiresAt: invitations.expiresAt });

    await tx
      .insert(userRoles)
      .values({ userId: input.id, roleSlug: BASE_ROLE })
      .onConflictDoNothing();

    if (accepted && accepted.expiresAt.getTime() > Date.now() && (accepted.roles.length > 0 || accepted.isSafevoiceHandler)) {
      const granted = accepted.roles.filter(isRoleSlug).filter((r) => r !== BASE_ROLE);
      if (granted.length > 0) {
        await tx.insert(userRoles).values(granted.map((roleSlug) => ({ userId: input.id, roleSlug, grantedBy: accepted.invitedBy }))).onConflictDoNothing();
      }
      if (accepted.isSafevoiceHandler) await tx.update(users).set({ isSafevoiceHandler: true }).where(eq(users.id, input.id));
      await writeAudit(
        {
          actor: null,
          action: "invitation.grants_applied",
          targetType: "user",
          targetId: input.id,
          after: { email, roles: [BASE_ROLE, ...granted], isSafevoiceHandler: accepted.isSafevoiceHandler },
          metadata: { invitedBy: accepted.invitedBy, reason: "Chosen by a Super Admin in the invitation, applied at first sign-in" },
        },
        tx,
      );
    }

    if (superAdminEmails().includes(email)) {
      const [existing] = await tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.roleSlug, "super_admin"))
        .limit(1);

      if (!existing) {
        await tx.insert(userRoles).values({ userId: input.id, roleSlug: "super_admin" });
        await writeAudit(
          {
            actor: null,
            action: "roles.bootstrap_super_admin",
            targetType: "user",
            targetId: input.id,
            after: { email, roles: [BASE_ROLE, "super_admin"] },
            metadata: { reason: "Listed in SUPER_ADMIN_EMAILS and no Super Admin existed" },
          },
          tx,
        );
      }
    }

    // Attach this account to the matching people record, if HR created one for this email.
    const linkedEmployeeId = await linkEmployeeToUser(tx, { userId: input.id, email });
    if (linkedEmployeeId) {
      await writeAudit(
        { actor: { id: input.id, email }, action: "people.link_user", targetType: "employee", targetId: linkedEmployeeId },
        tx,
      );
    }

    const [row] = await tx.select().from(users).where(eq(users.id, input.id)).limit(1);
    const roleRows = await tx.select({ slug: userRoles.roleSlug }).from(userRoles).where(eq(userRoles.userId, input.id));

    return {
      id: row.id,
      email: row.email,
      archivedAt: row.archivedAt,
      isSafevoiceHandler: row.isSafevoiceHandler,
      roles: roleRows.map((r) => r.slug).filter(isRoleSlug),
    };
  });
}

/** One cheap read: the account row and its roles, or null if the account has never been set up. */
async function loadCoreUser(id: string): Promise<CoreUser | null> {
  // Both reads at once: this runs on every request, and each round trip to the database costs real time when it is far away.
  const [[row], roleRows] = await Promise.all([
    db.select().from(users).where(eq(users.id, id)).limit(1),
    db.select({ slug: userRoles.roleSlug }).from(userRoles).where(eq(userRoles.userId, id)),
  ]);
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    archivedAt: row.archivedAt,
    isSafevoiceHandler: row.isSafevoiceHandler,
    roles: roleRows.map((r) => r.slug).filter(isRoleSlug),
  };
}

/**
 * Called on every request. Set-up work (invitation, base role, first Super Admin, linking to a
 * people record) runs once, inside provisionCoreUser; after that this is a read.
 * It re-provisions only when something that set-up provides is missing.
 */
export async function ensureCoreUser(input: { id: string; email: string }): Promise<CoreUser> {
  const existing = await loadCoreUser(input.id);
  const email = input.email.toLowerCase();

  const listed = superAdminEmails().includes(email);
  const isSuperAdmin = Boolean(existing?.roles.includes("super_admin"));
  // Only a listed person who is not yet Super Admin can need the bootstrap, and only while nobody holds the role: ask just then.
  const anySuperAdmin = existing && listed && !isSuperAdmin ? await superAdminExists() : true;

  if (existing && !needsProvisioning({ exists: true, hasBaseRole: existing.roles.includes(BASE_ROLE), listed, isSuperAdmin, anySuperAdmin })) return existing;
  return provisionCoreUser(input);
}

async function superAdminExists(): Promise<boolean> {
  const [row] = await db.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.roleSlug, "super_admin")).limit(1);
  return Boolean(row);
}

/** Archives a sign-in account (used when someone leaves): the next request from it is refused and it signs out. Nothing is deleted. */
export async function archiveUserAccount(tx: Pick<typeof db, "update">, userId: string): Promise<void> {
  await tx.update(users).set({ archivedAt: new Date() }).where(and(eq(users.id, userId), isNull(users.archivedAt)));
}
