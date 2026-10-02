import "server-only";
import { eq, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { invitations, users } from "@/modules/core/schema";

type Tx = Pick<typeof db, "select" | "insert" | "update">;

export const INVITE_DAYS = 7;

/**
 * Saves an invitation for an email inside the caller's transaction (re-inviting refreshes the expiry). Returns { exists: true } when
 * that person already has an ELEVATE account, so nothing is saved. The caller authorizes first and sends the email after the commit.
 */
export async function ensureInvitation(tx: Tx, actor: { id: string; email: string }, rawEmail: string): Promise<{ exists: true } | { exists: false; expiresAt: Date }> {
  const email = rawEmail.trim().toLowerCase();
  const [account] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (account) return { exists: true };

  const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
  // Re-inviting refreshes the expiry. The unique index on lower(email) guards against a race.
  const [existing] = await tx.select({ id: invitations.id }).from(invitations).where(sql`lower(${invitations.email}) = ${email}`).limit(1);
  if (existing) {
    await tx.update(invitations).set({ invitedBy: actor.id, expiresAt, acceptedAt: null, createdAt: new Date() }).where(eq(invitations.id, existing.id));
  } else {
    await tx.insert(invitations).values({ email, invitedBy: actor.id, expiresAt });
  }
  await writeAudit({ actor, action: "invitation.create", targetType: "invitation", targetId: email, after: { email, expiresAt } }, tx);
  return { exists: false, expiresAt };
}
