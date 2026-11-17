import "server-only";
import type { db } from "@/lib/db";
import { guests } from "./schema";

type Tx = Pick<typeof db, "insert">;

/** Called from first sign-in set-up (core/users.ts): the guest row that ties a guest account to its client. Idempotent. */
export async function provisionGuest(tx: Tx, input: { userId: string; clientId: string; invitedBy: string | null }): Promise<void> {
  await tx.insert(guests).values({ userId: input.userId, clientId: input.clientId, invitedBy: input.invitedBy }).onConflictDoNothing();
}
