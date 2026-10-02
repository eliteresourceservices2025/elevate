import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for performance reviews and goals (Phase 4.1): launching a cycle, who sees what at each step, the self -> lead ->
// calibration -> share -> acknowledgment flow, append-only evidence, early-engagement reviews at month 3 and 5, reminders and goals.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actionsModule = await import("@/modules/reviews/actions");
const goalsModule = await import("@/modules/reviews/goals-actions");
const queries = await import("@/modules/reviews/queries");
const service = await import("@/modules/reviews/service");
const jobs = await import("@/modules/reviews/jobs");
const { addMonths } = await import("@/modules/reviews/constants");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
type Res = { ok: boolean; error?: string; data?: { id?: string; cycleId?: string; reviews?: number; shared?: number } };
const act = { ...actionsModule, ...goalsModule } as unknown as Record<string, (input: unknown) => Promise<Res>>;
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const forbidden = (p: Promise<unknown>) => p.then(() => "resolved", (e: Error) => e.name);
const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let hr: TestUser;
let hr2: TestUser;
let exec: TestUser;
let stranger: TestUser;
let lead: TestUser;
let leadEmployeeId: string;
let questions: { id: string; type: string }[] = [];
let templateId: string;

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

async function makePerson(label: string, roles: RoleSlug[], managerId?: string, startDate = "2026-01-05") {
  const user = await makeUser(label, roles);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, start_date)
    values (${label}, 'Reviewed', ${user.email}, 'active', ${user.id}, ${managerId ?? null}, ${startDate}) returning id`);
  return { user, employeeId: e.id };
}

/** Launches a cycle for exactly these people and returns the review id of the first. */
async function launchFor(employeeIds: string[]) {
  as(hr);
  const r = await act.launchReviewCycle({ name: uniq("Cycle "), type: "quarterly", templateId, scope: { kind: "people", employeeIds }, selfDueOn: dayOffset(0), leadDueOn: dayOffset(3), calibrateDueOn: dayOffset(6) });
  if (!r.ok) throw new Error(r.error);
  const found = await rows<{ id: string; employee_id: string }>(sql`select id, employee_id from talent.reviews where cycle_id = ${r.data!.cycleId}`);
  return { cycleId: r.data!.cycleId as string, reviewIds: found.map((f) => f.id), byEmployee: new Map(found.map((f) => [f.employee_id, f.id])) };
}

const answersFor = (rating: number) => Object.fromEntries(questions.map((q) => [q.id, q.type === "rating" ? { rating } : { text: "Solid work this quarter." }]));

beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin"]);
  hr2 = await makeUser("hr2", ["hr_admin"]);
  exec = await makeUser("exec", ["executive"]);
  stranger = await makeUser("stranger", ["employee"]);
  const l = await makePerson("lead", ["team_lead"]);
  lead = l.user;
  leadEmployeeId = l.employeeId;
  as(hr);
  const t = await act.saveReviewTemplate({
    name: uniq("Quarterly "),
    questions: [
      { section: "Work", prompt: "Quality of work", type: "rating", required: true },
      { section: "Work", prompt: "Communication", type: "rating", required: true },
      { section: "Next", prompt: "What went well?", type: "text", required: false },
    ],
  });
  if (!t.ok) throw new Error(t.error);
  templateId = t.data!.id as string;
  const [tpl] = await rows<{ questions: { id: string; type: string }[] }>(sql`select questions from talent.review_templates where id = ${templateId}`);
  questions = tpl.questions;
});

describe("launching a cycle", () => {
  it("opens a review for each person with their lead, and tells both", async () => {
    const hire = await makePerson("hire", ["employee"], leadEmployeeId);
    const { reviewIds } = await launchFor([hire.employeeId]);
    expect(reviewIds).toHaveLength(1);
    const [r] = await rows<{ lead_user_id: string }>(sql`select lead_user_id from talent.reviews where id = ${reviewIds[0]}`);
    expect(r.lead_user_id).toBe(lead.id);
    const notes = await rows<{ user_id: string }>(sql`select user_id from ops.notifications where kind = 'review.started' and link = ${`/reviews/${reviewIds[0]}`}`);
    expect(notes.map((n) => n.user_id).sort()).toEqual([hire.user.id, lead.id].sort());
  });

  it("refuses a first due date in the past and anyone who is not HR", async () => {
    const hire = await makePerson("hire2", ["employee"], leadEmployeeId);
    as(hr);
    const late = await act.launchReviewCycle({ name: uniq("Late "), type: "annual", templateId, scope: { kind: "people", employeeIds: [hire.employeeId] }, selfDueOn: dayOffset(-3), leadDueOn: dayOffset(-2), calibrateDueOn: dayOffset(-1) });
    expect(late.ok).toBe(false);
    as(lead);
    expect((await act.launchReviewCycle({ name: uniq("Nope "), type: "annual", templateId, scope: { kind: "everyone" }, selfDueOn: dayOffset(1), leadDueOn: dayOffset(2), calibrateDueOn: dayOffset(3) })).error).toBe(NO_ACCESS);
  });

  it("keeps the questions as they were when the cycle launched", async () => {
    const hire = await makePerson("hire3", ["employee"], leadEmployeeId);
    const { cycleId } = await launchFor([hire.employeeId]);
    as(hr);
    await act.saveReviewTemplate({ id: templateId, name: uniq("Renamed "), questions: [{ section: "Only", prompt: "One question now", type: "text", required: false }] });
    const [c] = await rows<{ n: number }>(sql`select jsonb_array_length(questions)::int as n from talent.review_cycles where id = ${cycleId}`);
    expect(c.n).toBe(3);
    // put the original questions back for the other tests
    await act.saveReviewTemplate({ id: templateId, name: uniq("Quarterly "), questions: questions.map((q, i) => ({ section: i < 2 ? "Work" : "Next", prompt: `Question ${i + 1}`, type: q.type, required: q.type === "rating" })) });
    const [tpl] = await rows<{ questions: { id: string; type: string }[] }>(sql`select questions from talent.review_templates where id = ${templateId}`);
    questions = tpl.questions;
  });
});

describe("the review flow and who sees what", () => {
  it("runs self -> lead -> calibration -> share -> acknowledgment, with the right visibility at each step", async () => {
    const hire = await makePerson("flow", ["employee"], leadEmployeeId);
    const { reviewIds } = await launchFor([hire.employeeId]);
    const id = reviewIds[0];

    // Before anything: a stranger and the executive see nothing, the person and the lead see the open review
    as(stranger);
    expect(await forbidden(queries.getReview(id))).toBe("ForbiddenError");
    as(exec);
    expect(await forbidden(queries.getReview(id))).toBe("ForbiddenError");
    as(hire.user);
    expect((await queries.getReview(id)).canWriteSelf).toBe(true);

    // The lead cannot write the person's self review, the person cannot write the lead's
    as(lead);
    expect((await act.submitSelfReview({ reviewId: id, answers: answersFor(4) })).error).toBe(NO_ACCESS);
    as(hire.user);
    expect((await act.submitLeadReview({ reviewId: id, answers: answersFor(4), overallRating: 4 })).error).toBe(NO_ACCESS);

    // Self review: missing required ratings are refused, then it goes in once
    expect((await act.submitSelfReview({ reviewId: id, answers: {} })).ok).toBe(false);
    expect((await act.submitSelfReview({ reviewId: id, answers: answersFor(5), comments: "I think I did well." })).ok).toBe(true);
    expect((await act.submitSelfReview({ reviewId: id, answers: answersFor(5) })).ok).toBe(false);

    // The lead sees the self review only after submitting their own
    as(lead);
    expect((await queries.getReview(id)).self).toBeNull();
    expect((await act.submitLeadReview({ reviewId: id, answers: answersFor(3), overallRating: 3, comments: "Good, with room to grow." })).ok).toBe(true);
    expect((await queries.getReview(id)).self).not.toBeNull();

    // The person still sees only their own part
    as(hire.user);
    let seen = await queries.getReview(id);
    expect(seen.lead).toBeNull();
    expect(seen.calibration).toBeNull();
    expect(seen.canAcknowledge).toBe(false);
    expect((await act.acknowledgeReview({ reviewId: id })).ok).toBe(false); // not shared yet

    // Calibration: a changed rating needs a reason; the person's own HR cannot be their own calibrator
    as(hr);
    expect((await act.calibrateReview({ reviewId: id, finalRating: 4 })).ok).toBe(false);
    expect((await act.calibrateReview({ reviewId: id, finalRating: 4, changeReason: "Calibrated against the team", summary: "A solid quarter." })).ok).toBe(true);
    as(lead);
    expect((await act.calibrateReview({ reviewId: id, finalRating: 4 })).error).toBe(NO_ACCESS);
    as(hire.user);
    expect((await queries.getReview(id)).calibration).toBeNull(); // not shared yet

    // Sharing: only HR, once
    as(lead);
    expect((await act.shareReview({ reviewId: id })).error).toBe(NO_ACCESS);
    as(hr);
    expect((await act.shareReview({ reviewId: id })).ok).toBe(true);
    expect((await act.shareReview({ reviewId: id })).ok).toBe(false);
    expect((await act.calibrateReview({ reviewId: id, finalRating: 5, changeReason: "Late change" })).ok).toBe(false); // frozen once shared

    // The person now reads the lead's feedback and the final rating; the lead's own rating was changed, so it is not shown to them
    as(hire.user);
    seen = await queries.getReview(id);
    expect(seen.calibration?.finalRating).toBe(4);
    expect(seen.calibration?.changeReason).toBeNull(); // HR's reason stays with HR
    expect(seen.lead?.overallRating).toBeNull();
    expect(seen.leadRatingHidden).toBe(true);
    expect(Object.values(seen.lead!.answers).every((a) => a.rating === undefined)).toBe(true);
    expect(seen.canAcknowledge).toBe(true);

    // Acknowledgment: only the person, once
    as(lead);
    expect((await act.acknowledgeReview({ reviewId: id })).error).toBe(NO_ACCESS);
    as(hire.user);
    expect((await act.acknowledgeReview({ reviewId: id, comment: "Thanks, noted." })).ok).toBe(true);
    expect((await act.acknowledgeReview({ reviewId: id })).ok).toBe(false);
    const [ack] = await rows<{ comment: string }>(sql`select comment from talent.review_acknowledgments where review_id = ${id}`);
    expect(ack.comment).toBe("Thanks, noted.");

    // The lead sees the final result once shared; HR sees the reason
    as(lead);
    expect((await queries.getReview(id)).calibration?.finalRating).toBe(4);
    as(hr2);
    expect((await queries.getReview(id)).calibration?.changeReason).toBe("Calibrated against the team");
  });

  it("never lets anyone calibrate or share their own review, and never edits a submitted review", async () => {
    const own = await makePerson("hrown", ["hr_admin"], leadEmployeeId);
    const { reviewIds } = await launchFor([own.employeeId]);
    const id = reviewIds[0];
    as(lead);
    expect((await act.submitLeadReview({ reviewId: id, answers: answersFor(3), overallRating: 3 })).ok).toBe(true);
    as(own.user);
    expect((await act.calibrateReview({ reviewId: id, finalRating: 3 })).error).toMatch(/Another HR admin/);
    as(hr);
    expect((await act.calibrateReview({ reviewId: id, finalRating: 3 })).ok).toBe(true);
    as(own.user);
    expect((await act.shareReview({ reviewId: id })).ok).toBe(false);
    // The evidence is append-only at the database
    await expect(db.execute(sql`update talent.review_responses set comments = 'edited' where review_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from talent.review_calibrations where review_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`update talent.reviews set lead_submitted_at = now() + interval '1 day' where id = ${id}`)).rejects.toThrow();
  });

  it("lets HR give the lead's review to someone else, who can then write it", async () => {
    const hire = await makePerson("reassign", ["employee"], leadEmployeeId);
    const other = await makePerson("otherlead", ["team_lead"]);
    const { reviewIds } = await launchFor([hire.employeeId]);
    const id = reviewIds[0];
    as(lead);
    expect((await act.reassignReviewer({ reviewId: id, leadUserId: other.user.id })).error).toBe(NO_ACCESS);
    as(hr);
    expect((await act.reassignReviewer({ reviewId: id, leadUserId: hire.user.id })).ok).toBe(false); // not themselves
    expect((await act.reassignReviewer({ reviewId: id, leadUserId: other.user.id })).ok).toBe(true);
    as(other.user);
    expect((await queries.getReview(id)).canWriteLead).toBe(true);
    expect((await act.submitLeadReview({ reviewId: id, answers: answersFor(4), overallRating: 4 })).ok).toBe(true);
  });

  it("closes a cycle: nothing more can be submitted, but shared reviews can still be acknowledged", async () => {
    const hire = await makePerson("closing", ["employee"], leadEmployeeId);
    const { cycleId, reviewIds } = await launchFor([hire.employeeId]);
    as(hr);
    expect((await act.closeReviewCycle({ cycleId })).ok).toBe(true);
    expect((await act.closeReviewCycle({ cycleId })).ok).toBe(false);
    as(hire.user);
    expect((await act.submitSelfReview({ reviewId: reviewIds[0], answers: answersFor(3) })).ok).toBe(false);
  });
});

describe("summary for the executive", () => {
  it("shows counts only, and hides an average below five reviews", async () => {
    as(exec);
    const summary = await queries.getReviewSummary();
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.every((s) => s.averageRating === null || s.shared >= 5)).toBe(true);
    expect(Object.keys(summary[0]).sort()).toEqual(["acknowledged", "averageRating", "id", "name", "shared", "total"]);
    as(lead);
    expect(await forbidden(queries.getReviewSummary())).toBe("ForbiddenError");
  });
});

describe("early-engagement reviews", () => {
  const today = () => dayOffset(0);

  it("opens the month 3 review on its date, once, and the month 5 review later", async () => {
    const hire = await makePerson("early3", ["employee"], leadEmployeeId, addMonths(today(), -3));
    const first = await service.runEarlyReviews(today());
    expect(first.opened).toBeGreaterThanOrEqual(1);
    const mine = await rows<{ milestone: number; lead_user_id: string }>(sql`select milestone, lead_user_id from talent.reviews where employee_id = ${hire.employeeId}`);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ milestone: 3, lead_user_id: lead.id });
    // Safe to run again
    await service.runEarlyReviews(today());
    expect(await rows(sql`select 1 from talent.reviews where employee_id = ${hire.employeeId}`)).toHaveLength(1);
    // Two months later the month 5 review opens
    const later = addMonths(today(), 2);
    await db.execute(sql`update core.employees set start_date = ${addMonths(later, -5)} where id = ${hire.employeeId}`);
    await service.runEarlyReviews(later);
    const all = await rows<{ milestone: number }>(sql`select milestone from talent.reviews where employee_id = ${hire.employeeId} order by milestone`);
    expect(all.map((r) => r.milestone)).toEqual([3, 5]);
  });

  it("does not back-fill people who started long ago, and does nothing when switched off", async () => {
    const old = await makePerson("early-old", ["employee"], leadEmployeeId, "2024-01-15");
    await service.runEarlyReviews(today());
    expect(await rows(sql`select 1 from talent.reviews where employee_id = ${old.employeeId}`)).toHaveLength(0);

    as(hr);
    expect((await act.setEarlyReviews({ enabled: false })).ok).toBe(true);
    const due = await makePerson("early-off", ["employee"], leadEmployeeId, addMonths(today(), -3));
    expect((await service.runEarlyReviews(today())).opened).toBe(0);
    expect(await rows(sql`select 1 from talent.reviews where employee_id = ${due.employeeId}`)).toHaveLength(0);
    expect((await act.setEarlyReviews({ enabled: true })).ok).toBe(true);
    await service.runEarlyReviews(today());
    expect(await rows(sql`select 1 from talent.reviews where employee_id = ${due.employeeId}`)).toHaveLength(1);
  });
});

describe("reminders", () => {
  it("reminds whoever has the next step once a day, only after the due date", async () => {
    const hire = await makePerson("remind", ["employee"], leadEmployeeId);
    const { reviewIds } = await launchFor([hire.employeeId]);
    const before = await jobs.runReviewReminders(dayOffset(-1)); // before the due date: nothing for this review
    void before;
    expect(await rows(sql`select 1 from ops.notifications where kind = 'review.reminder' and user_id = ${hire.user.id}`)).toHaveLength(0);
    await jobs.runReviewReminders(dayOffset(1));
    expect(await rows(sql`select 1 from ops.notifications where kind = 'review.reminder' and user_id = ${hire.user.id}`)).toHaveLength(1);
    await jobs.runReviewReminders(dayOffset(1)); // the same day again: no second nudge
    expect(await rows(sql`select 1 from ops.notifications where kind = 'review.reminder' and user_id = ${hire.user.id}`)).toHaveLength(1);
    expect(reviewIds).toHaveLength(1);
  });
});

describe("goals", () => {
  it("lets a person add their own goal, and their lead add one for them, but not a stranger", async () => {
    const hire = await makePerson("goals", ["employee"], leadEmployeeId);
    as(hire.user);
    const mine = await act.saveGoal({ employeeId: hire.employeeId, title: "Cut reply time to 2 hours", targetOn: dayOffset(30) });
    expect(mine.ok).toBe(true);
    as(lead);
    const forThem = await act.saveGoal({ employeeId: hire.employeeId, title: "Learn the scheduling tool" });
    expect(forThem.ok).toBe(true);
    as(stranger);
    expect((await act.saveGoal({ employeeId: hire.employeeId, title: "Sneaky goal" })).error).toBe(NO_ACCESS);
    expect((await act.setGoalStatus({ goalId: mine.data!.id, status: "done" })).error).toBe(NO_ACCESS);
    const theirs = (await queries.listGoals()).goals.filter((g) => g.employeeId === hire.employeeId);
    expect(theirs).toHaveLength(0);
  });

  it("tracks status and notes, shows them to the person and lead, and archives instead of deleting", async () => {
    const hire = await makePerson("goals2", ["employee"], leadEmployeeId);
    as(hire.user);
    const g = await act.saveGoal({ employeeId: hire.employeeId, title: "Finish onboarding training" });
    const goalId = g.data!.id as string;
    expect((await act.setGoalStatus({ goalId, status: "in_progress" })).ok).toBe(true);
    expect((await act.addGoalNote({ goalId, note: "Module 2 done" })).ok).toBe(true);
    as(lead);
    const seen = (await queries.listGoals()).goals.find((x) => x.id === goalId)!;
    expect(seen).toMatchObject({ status: "in_progress", canManage: true });
    expect(seen.notes.map((n) => n.note)).toEqual(["Module 2 done"]);
    as(hire.user);
    expect((await act.archiveGoal({ goalId })).ok).toBe(true);
    expect(await rows(sql`select 1 from talent.goals where id = ${goalId} and archived_at is not null`)).toHaveLength(1);
    expect((await queries.listGoals()).goals.find((x) => x.id === goalId)).toBeUndefined();
  });

  it("does not write goal or note text to the audit log", async () => {
    const hire = await makePerson("goals3", ["employee"], leadEmployeeId);
    as(hire.user);
    const g = await act.saveGoal({ employeeId: hire.employeeId, title: "Secret-ish goal title" });
    await act.addGoalNote({ goalId: g.data!.id, note: "Private progress remark" });
    const leaked = await rows(sql`select 1 from ops.audit_log where target_id = ${g.data!.id as string} and (before::text like '%Secret-ish%' or after::text like '%Secret-ish%' or after::text like '%Private progress%')`);
    expect(leaked).toHaveLength(0);
  });
});
