import "server-only";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/modules/core/schema";

/** Whether the quick tour should start by itself for the signed-in person: a new account that has not finished or skipped it yet. */
export async function tourStartsByItself(): Promise<boolean> {
  const user = await requireUser();
  const [row] = await db.select({ seen: users.onboardingTourSeenAt }).from(users).where(eq(users.id, user.id)).limit(1);
  return row ? row.seen === null : false;
}
