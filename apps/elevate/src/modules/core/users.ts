import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { BASE_ROLE, isRoleSlug, type RoleSlug } from "@/lib/roles";
import { writeAudit } from "@/modules/audit/write";
import { linkEmployeeToUser } from "@/modules/people/service";
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
    await tx.insert(users).values({ id: input.id, email }).onConflictDoNothing({ target: users.id });

    await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(sql`lower(${invitations.email}) = ${email}`, isNull(invitations.acceptedAt)));

    await tx
      .insert(userRoles)
      .values({ userId: input.id, roleSlug: BASE_ROLE })
      .onConflictDoNothing();

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
