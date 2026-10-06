import "server-only";
import { eq, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { invitations, users } from "@/modules/core/schema";

type Tx = Pick<typeof db, "select" | "insert" | "update">;

export const INVITE_DAYS = 7;

/** What a Super Admin chose to give the person when they first sign in. `undefined` means "leave whatever the invitation already has". */
export type InviteGrant = { roles: string[]; safevoiceHandler: boolean };

/**
 * Saves an invitation for an email inside the caller's transaction (re-inviting refreshes the expiry). Returns { exists: true } when
 * that person already has an ELEVATE account, so nothing is saved. The caller authorizes first and sends the email after the commit.
 * `grant` (roles and Safe Voice handler) is passed only by a Super Admin: a re-invite by anyone else keeps what is already chosen.
 */
export async function ensureInvitation(tx: Tx, actor: { id: string; email: string }, rawEmail: string, grant?: InviteGrant): Promise<{ exists: true } | { exists: false; expiresAt: Date }> {
  const email = rawEmail.trim().toLowerCase();
  const [account] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (account) return { exists: true };

  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  // Re-inviting refreshes the expiry. The unique index on lower(email) guards against a race.
  const [existing] = await tx.select({ id: invitations.id }).from(invitations).where(sql`lower(${invitations.email}) = ${email}`).limit(1);
  if (existing) {
    await tx
      .update(invitations)
      .set({ invitedBy: actor.id, expiresAt, acceptedAt: null, createdAt: new Date(), ...(grant ? { roles: grant.roles, isSafevoiceHandler: grant.safevoiceHandler } : {}) })
      .where(eq(invitations.id, existing.id));
  } else {
    await tx.insert(invitations).values({ email, invitedBy: actor.id, expiresAt, roles: grant?.roles ?? [], isSafevoiceHandler: grant?.safevoiceHandler ?? false });
  }
  await writeAudit({ actor, action: "invitation.create", targetType: "invitation", targetId: email, after: { email, expiresAt, ...(grant ? { roles: grant.roles, safevoiceHandler: grant.safevoiceHandler } : {}) } }, tx);
  return { exists: false, expiresAt };
}
