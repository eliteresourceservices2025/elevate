import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { notify } from "@/modules/notifications/service";
import { checklistTasks, offboardingCases, onboardingCases } from "./schema";
import { executeSeparation, isSeparationDue, syncCase, todayIn } from "./service";

// Scheduled work for onboarding and offboarding. Thin Inngest wrappers call these (src/inngest/functions.ts).

/** Hourly: removes access for every open offboarding whose last working day has ended in the person's own zone. Safe to repeat. */
export async function runSeparations(now = new Date()): Promise<{ checked: number; separated: number; failed: number }> {
  const open = await db.select().from(offboardingCases).where(and(eq(offboardingCases.status, "open"), isNull(offboardingCases.accessRemovedAt)));
  let separated = 0;
  let failed = 0;
  for (const c of open) {
    if (!(await isSeparationDue(c, now))) continue;
    try {
      const result = await executeSeparation(c.id, null);
      if (result.done) separated += 1;
      else failed += 1;
    } catch {
      failed += 1; // the steps already done are saved; the next run continues
    }
  }
  return { checked: open.length, separated, failed };
}

/** Every 30 minutes: records tasks ELEVATE can see are done (a document uploaded, a policy acknowledged, an agreement signed). */
export async function runChecklistSync(): Promise<{ closed: number }> {
  let closed = 0;
  for (const c of await db.select({ id: onboardingCases.id }).from(onboardingCases).where(eq(onboardingCases.status, "open"))) closed += await syncCase("onboarding", c.id);
  for (const c of await db.select({ id: offboardingCases.id }).from(offboardingCases).where(eq(offboardingCases.status, "open"))) closed += await syncCase("offboarding", c.id);
  return { closed };
}

/**
 * Daily: tells an owner about their tasks that are due today or overdue, at most once a day per task. Tasks that belong to HR go to
 * every HR admin as one note per case, not one per task.
 */
export async function runChecklistReminders(today = todayIn()): Promise<{ reminded: number }> {
  const due = await db
    .select()
    .from(checklistTasks)
    .where(and(eq(checklistTasks.status, "todo"), eq(checklistTasks.check, "manual"), or(eq(checklistTasks.dueOn, today), lt(checklistTasks.dueOn, today)), or(isNull(checklistTasks.lastReminderOn), lt(checklistTasks.lastReminderOn, today))));
  let reminded = 0;
  const byUser = new Map<string, { count: number; link: string }>();
  for (const t of due) {
    const caseId = t.onboardingCaseId ?? t.offboardingCaseId;
    const kind = t.onboardingCaseId ? "onboarding" : "offboarding";
    const [c] = t.onboardingCaseId
      ? await db.select({ status: onboardingCases.status }).from(onboardingCases).where(eq(onboardingCases.id, t.onboardingCaseId))
      : await db.select({ status: offboardingCases.status }).from(offboardingCases).where(eq(offboardingCases.id, t.offboardingCaseId as string));
    if (c?.status !== "open" || !t.ownerUserId) continue; // HR-owned tasks show on the HR pages; no per-task noise
    const entry = byUser.get(t.ownerUserId) ?? { count: 0, link: kind === "onboarding" ? "/onboarding" : "/offboarding" };
    entry.count += 1;
    byUser.set(t.ownerUserId, entry);
    await db.update(checklistTasks).set({ lastReminderOn: today }).where(eq(checklistTasks.id, t.id));
    void caseId;
  }
  if (byUser.size > 0) {
    await db.transaction((tx) =>
      notify(
        tx,
        [...byUser].map(([userId, v]) => ({ userId, kind: "checklist.reminder", title: v.count === 1 ? "A checklist task is due" : `${v.count} checklist tasks are due`, body: "Open your tasks to finish them.", link: v.link })),
      ),
    );
    reminded = byUser.size;
  }
  return { reminded };
}
