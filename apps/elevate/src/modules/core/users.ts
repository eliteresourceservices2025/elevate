import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { invitations, users } from "./schema";

/**
 * Create the core.users row on first verified sign-in and mark the invitation accepted.
 * Sign-up itself is gated earlier by the before-user-created auth hook.
 */
export async function provisionCoreUser(input: { id: string; email: string }) {
  const email = input.email.toLowerCase();

  await db.insert(users).values({ id: input.id, email }).onConflictDoNothing({ target: users.id });

  await db
    .update(invitations)
    .set({ acceptedAt: new Date() })
    .where(and(sql`lower(${invitations.email}) = ${email}`, isNull(invitations.acceptedAt)));

  const [row] = await db.select().from(users).where(eq(users.id, input.id)).limit(1);
  return row;
}
