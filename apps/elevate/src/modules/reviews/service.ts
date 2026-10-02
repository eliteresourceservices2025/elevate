import "server-only";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { employees } from "@/modules/people/schema";
import { addDays, DEFAULT_EARLY_QUESTIONS, dueMilestones, type CycleType, type Milestone, type Question } from "./constants";
import { reviewCycles, reviewSettings, reviewTemplates, reviews } from "./schema";

// Internals for performance reviews (not a "use server" file, so nothing here is a public endpoint). Callers authorize first.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Actor = { id: string; email: string };

/** People who can be reviewed: current people (not archived, not separated). */
const REVIEWABLE = notInArray(employees.status, ["separated", "archived"]);

/** Gives questions their ids (a template's questions are saved without them). */
export function withIds(questions: Omit<Question, "id">[]): Question[] {
  return questions.map((q) => ({ ...q, id: crypto.randomUUID() }));
}

/** Notifies the person and the lead that a review is waiting. Links are relative; there is no review content. */
async function announce(tx: Tx, rows: { id: string; employeeUserId: string | null; leadUserId: string | null }[], what: string) {
  const out: { userId: string; kind: string; title: string; body: string; link: string }[] = [];
  for (const r of rows) {
    if (r.employeeUserId) out.push({ userId: r.employeeUserId, kind: "review.started", title: `${what}: write your self review`, body: "Open it to see what to do and when.", link: `/reviews/${r.id}` });
    if (r.leadUserId) out.push({ userId: r.leadUserId, kind: "review.started", title: `${what}: a review is waiting for you`, body: "Open it to write your review of a team member.", link: `/reviews/${r.id}` });
  }
  await notify(tx, out);
}

/** Opens a review for each person: the lead is whoever they report to now. Returns how many were created. */
export async function openReviews(tx: Tx, p: { cycleId: string; employeeIds: string[]; milestones?: Map<string, Milestone>; what: string }): Promise<number> {
  if (p.employeeIds.length === 0) return 0;
  const people = await tx.select({ id: employees.id, userId: employees.userId, managerId: employees.managerId }).from(employees).where(inArray(employees.id, p.employeeIds));
  const managerIds = [...new Set(people.flatMap((e) => (e.managerId ? [e.managerId] : [])))];
  const managers = managerIds.length ? await tx.select({ id: employees.id, userId: employees.userId }).from(employees).where(inArray(employees.id, managerIds)) : [];
  const leadOf = new Map(managers.map((m) => [m.id, m.userId]));
  const created = await tx
    .insert(reviews)
    .values(people.map((e) => ({ cycleId: p.cycleId, employeeId: e.id, leadUserId: e.managerId ? (leadOf.get(e.managerId) ?? null) : null, milestone: p.milestones?.get(e.id) ?? null })))
    .onConflictDoNothing()
    .returning({ id: reviews.id, employeeId: reviews.employeeId, leadUserId: reviews.leadUserId });
  const userOf = new Map(people.map((e) => [e.id, e.userId]));
  await announce(tx, created.map((r) => ({ id: r.id, employeeUserId: userOf.get(r.employeeId) ?? null, leadUserId: r.leadUserId })), p.what);
  return created.length;
}

/** The employees a launch scope covers. */
export async function peopleForScope(tx: Pick<typeof db, "select">, scope: { kind: "everyone" } | { kind: "teams"; teamIds: string[] } | { kind: "people"; employeeIds: string[] }): Promise<string[]> {
  const base = and(isNull(employees.archivedAt), REVIEWABLE);
  const rows =
    scope.kind === "everyone"
      ? await tx.select({ id: employees.id }).from(employees).where(base)
      : scope.kind === "teams"
        ? await tx.select({ id: employees.id }).from(employees).where(and(base, inArray(employees.teamId, scope.teamIds)))
        : await tx.select({ id: employees.id }).from(employees).where(and(base, inArray(employees.id, scope.employeeIds)));
  return rows.map((r) => r.id);
}

/** The questions early reviews use: HR's chosen template, else the built-in short one. */
export async function earlyQuestions(tx: Pick<typeof db, "select">): Promise<{ questions: Question[]; templateId: string | null; enabled: boolean }> {
  const [s] = await tx.select().from(reviewSettings).where(eq(reviewSettings.id, 1));
  if (s?.earlyTemplateId) {
    const [t] = await tx.select().from(reviewTemplates).where(and(eq(reviewTemplates.id, s.earlyTemplateId), isNull(reviewTemplates.archivedAt)));
    if (t) return { questions: t.questions, templateId: t.id, enabled: s.earlyEnabled };
  }
  return { questions: withIds(DEFAULT_EARLY_QUESTIONS), templateId: null, enabled: s?.earlyEnabled ?? true };
}

/**
 * Opens the month 3 and month 5 reviews that came due. Each milestone is a cycle of its own per calendar month ("Early-engagement
 * review, month 3, 2026-10"), created on the first need. Safe to run again: a person never gets the same milestone twice (a unique index).
 */
export async function runEarlyReviews(today: string): Promise<{ opened: number }> {
  const settings = await earlyQuestions(db);
  if (!settings.enabled) return { opened: 0 };
  const people = await db
    .select({ id: employees.id, startDate: employees.startDate })
    .from(employees)
    .where(and(isNull(employees.archivedAt), REVIEWABLE));
  const have = await db.select({ employeeId: reviews.employeeId, milestone: reviews.milestone }).from(reviews).where(inArray(reviews.milestone, [3, 5]));
  const done = new Map<string, number[]>();
  for (const h of have) done.set(h.employeeId, [...(done.get(h.employeeId) ?? []), h.milestone as number]);

  const due = new Map<Milestone, Map<string, Milestone>>(); // milestone -> employee -> milestone
  for (const e of people) {
    if (!e.startDate) continue;
    for (const m of dueMilestones(e.startDate, today, done.get(e.id) ?? [])) {
      due.set(m, (due.get(m) ?? new Map()).set(e.id, m));
    }
  }
  let opened = 0;
  for (const [milestone, who] of due) {
    opened += await db.transaction(async (tx) => {
      const name = `Early-engagement review, month ${milestone}, ${today.slice(0, 7)}`;
      const existing = await tx.select({ id: reviewCycles.id }).from(reviewCycles).where(and(eq(reviewCycles.type, "early"), eq(reviewCycles.name, name)));
      let cycleId = existing[0]?.id;
      if (!cycleId) {
        const [c] = await tx
          .insert(reviewCycles)
          .values({ name, type: "early" satisfies CycleType, questions: settings.questions, selfDueOn: addDays(today, 7), leadDueOn: addDays(today, 14), calibrateDueOn: addDays(today, 21) })
          .returning({ id: reviewCycles.id });
        cycleId = c.id;
      }
      const n = await openReviews(tx, { cycleId, employeeIds: [...who.keys()], milestones: who, what: `Month ${milestone} review` });
      if (n > 0) {
        const hr = await hrUserIds();
        await notify(tx, hr.map((userId) => ({ userId, kind: "review.early_opened", title: `${n} month ${milestone} ${n === 1 ? "review was" : "reviews were"} opened`, body: "Open Reviews to follow them.", link: `/reviews/cycles/${cycleId}` })));
        await writeAudit({ actor: null, action: "review.early_open", targetType: "review_cycle", targetId: cycleId, after: { milestone, opened: n } }, tx);
      }
      return n;
    });
  }
  return { opened };
}

export function requireOpenCycle(status: string) {
  if (status !== "open") throw new ActionFailure("This review cycle is closed.");
}
