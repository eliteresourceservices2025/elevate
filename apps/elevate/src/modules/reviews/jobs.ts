import "server-only";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { employees } from "@/modules/people/schema";
import { stageOf, type Stage } from "./constants";
import { reviewCycles, reviews } from "./schema";
import { runEarlyReviews } from "./service";

// Scheduled work for reviews. Thin Inngest wrappers call these (src/inngest/functions.ts).

/** Daily: opens the month 3 and month 5 early-engagement reviews that came due. */
export async function runEarlyReviewScheduler(today: string) {
  return runEarlyReviews(today);
}

const WHO: Record<Stage, "person" | "lead" | "hr" | null> = { awaiting_self: "person", awaiting_lead: "lead", awaiting_hr: "hr", ready_to_share: "hr", shared: "person", acknowledged: null };

/**
 * Daily: reminds whoever has the next step on a review whose due date is today or past, once a day per review. Self reviews are
 * optional, so a late one only nudges the person; the lead's step is never blocked by it. HR gets one summary, not one note per review.
 */
export async function runReviewReminders(today: string): Promise<{ reminded: number }> {
  const open = await db
    .select({ r: reviews, c: reviewCycles, userId: employees.userId })
    .from(reviews)
    .innerJoin(reviewCycles, eq(reviewCycles.id, reviews.cycleId))
    .innerJoin(employees, eq(employees.id, reviews.employeeId))
    .where(and(eq(reviewCycles.status, "open"), or(isNull(reviews.lastReminderOn), lt(reviews.lastReminderOn, today))));
  const byUser = new Map<string, number>();
  let hrCount = 0;
  const touched: string[] = [];
  for (const x of open) {
    const stage = stageOf(x.r);
    // eslint-disable-next-line security/detect-object-injection -- stage comes from stageOf, a fixed set
    const who = WHO[stage];
    if (!who || stage === "shared") continue; // a shared review waits on the person, who was already told
    const due = stage === "awaiting_self" ? x.c.selfDueOn : stage === "awaiting_lead" ? x.c.leadDueOn : x.c.calibrateDueOn;
    if (due > today) continue;
    touched.push(x.r.id);
    if (who === "hr") hrCount += 1;
    else {
      const target = who === "person" ? x.userId : x.r.leadUserId;
      if (target) byUser.set(target, (byUser.get(target) ?? 0) + 1);
    }
  }
  const out: { userId: string; kind: string; title: string; body: string; link: string }[] = [];
  for (const [userId, n] of byUser) out.push({ userId, kind: "review.reminder", title: n === 1 ? "A review is waiting for you" : `${n} reviews are waiting for you`, body: "Open Reviews to finish them.", link: "/reviews" });
  if (hrCount > 0) for (const userId of await hrUserIds()) out.push({ userId, kind: "review.reminder", title: `${hrCount} ${hrCount === 1 ? "review needs" : "reviews need"} calibrating or sharing`, body: "Open Reviews to follow them.", link: "/reviews" });
  if (out.length > 0) await db.transaction((tx) => notify(tx, out));
  if (touched.length > 0) await db.update(reviews).set({ lastReminderOn: today }).where(inArray(reviews.id, touched));
  return { reminded: out.length };
}
