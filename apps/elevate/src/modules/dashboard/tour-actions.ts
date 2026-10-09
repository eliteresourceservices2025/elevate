"use server";

import { and, eq, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { db } from "@/lib/db";
import { runAction, type ActionResult } from "@/lib/run-action";
import { users } from "@/modules/core/schema";

/**
 * The person finished or skipped the quick tour: it stops starting by itself. Their own account only, nothing else changes, and
 * it is safe to repeat (the first time is kept). Replaying the tour from Settings never needs this.
 */
export async function completeTour(): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "tour.complete", { ownerUserId: actor.id });
    await db.update(users).set({ onboardingTourSeenAt: new Date() }).where(and(eq(users.id, actor.id), isNull(users.onboardingTourSeenAt)));
    return { ok: true, data: undefined };
  });
}
