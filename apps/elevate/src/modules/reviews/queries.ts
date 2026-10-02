import "server-only";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { ForbiddenError, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/modules/core/schema";
import { downlineEmployeeIds, managerChainUserIds } from "@/modules/org/service";
import { teams } from "@/modules/org/schema";
import { employees } from "@/modules/people/schema";
import { stageOf, visibility, type Answers, type Question, type Stage, type Viewer } from "./constants";
import { goalNotes, goals, reviewAcknowledgments, reviewCalibrations, reviewCycles, reviewResponses, reviewSettings, reviewTemplates, reviews } from "./schema";

// Reads for the reviews pages. Each starts with requireUser and works out the viewer itself: HR everything, a lead their downline,
// everyone else their own. The person sees the lead's part and the final rating only once HR has shared the review.

export type ReviewRow = {
  id: string;
  employeeId: string;
  name: string;
  cycleId: string;
  cycleName: string;
  milestone: number | null;
  stage: Stage;
  /** The step due next, from the cycle's dates. */
  dueOn: string;
  overdue: boolean;
  mine: boolean;
  /** The signed-in user is the lead who has to write it. */
  toWrite: boolean;
};

const nameOf = (e: { first: string; last: string }) => `${e.first} ${e.last}`;
const today = () => new Date().toISOString().slice(0, 10);

function dueFor(stage: Stage, c: { selfDueOn: string; leadDueOn: string; calibrateDueOn: string }) {
  return stage === "awaiting_self" ? c.selfDueOn : stage === "awaiting_lead" ? c.leadDueOn : c.calibrateDueOn;
}

/** Reviews the signed-in user may see: all for HR, their downline's plus their own for a lead, their own for everyone else. */
export async function listReviews(): Promise<ReviewRow[]> {
  const user = await requireUser();
  const scope = scopeFor(user, "reviews.view");
  const ids = scope === "team" ? await downlineEmployeeIds(db, user.id) : [];
  const rows = await db
    .select({ r: reviews, c: reviewCycles, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName })
    .from(reviews)
    .innerJoin(reviewCycles, eq(reviewCycles.id, reviews.cycleId))
    .innerJoin(employees, eq(employees.id, reviews.employeeId))
    .orderBy(desc(reviews.createdAt));
  const t = today();
  return rows
    .filter((x) => x.userId === user.id || scope === "all" || (scope === "team" && (ids.includes(x.r.employeeId) || x.r.leadUserId === user.id)))
    .filter((x) => x.userId === user.id || scope !== null)
    .map((x) => {
      const stage = stageOf(x.r);
      const due = dueFor(stage, x.c);
      const open = stage !== "shared" && stage !== "acknowledged" && stage !== "ready_to_share";
      return { id: x.r.id, employeeId: x.r.employeeId, name: nameOf(x), cycleId: x.c.id, cycleName: x.c.name, milestone: x.r.milestone, stage, dueOn: due, overdue: open && due < t, mine: x.userId === user.id, toWrite: x.r.leadUserId === user.id && !x.r.leadSubmittedAt };
    });
}

export type CycleRow = { id: string; name: string; type: string; status: string; selfDueOn: string; leadDueOn: string; calibrateDueOn: string; total: number; byStage: Record<string, number> };

export async function listCycles(): Promise<CycleRow[]> {
  const user = await requireUser();
  if (scopeFor(user, "reviews.manage_cycles") !== "all") throw new ForbiddenError("reviews.manage_cycles");
  const cycles = await db.select().from(reviewCycles).orderBy(desc(reviewCycles.createdAt));
  const all = cycles.length ? await db.select().from(reviews).where(inArray(reviews.cycleId, cycles.map((c) => c.id))) : [];
  return cycles.map((c) => {
    const mine = all.filter((r) => r.cycleId === c.id);
    const byStage: Record<string, number> = {};
    for (const r of mine) byStage[stageOf(r)] = (byStage[stageOf(r)] ?? 0) + 1;
    return { id: c.id, name: c.name, type: c.type, status: c.status, selfDueOn: c.selfDueOn, leadDueOn: c.leadDueOn, calibrateDueOn: c.calibrateDueOn, total: mine.length, byStage };
  });
}

export async function getCycle(cycleId: string) {
  const user = await requireUser();
  if (scopeFor(user, "reviews.manage_cycles") !== "all") throw new ForbiddenError("reviews.manage_cycles");
  const [c] = await db.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId));
  if (!c) throw new ForbiddenError("reviews.manage_cycles");
  const rows = await db
    .select({ r: reviews, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName })
    .from(reviews)
    .innerJoin(employees, eq(employees.id, reviews.employeeId))
    .where(eq(reviews.cycleId, cycleId))
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName));
  const t = today();
  const list: ReviewRow[] = rows.map((x) => {
    const stage = stageOf(x.r);
    const due = dueFor(stage, c);
    return { id: x.r.id, employeeId: x.r.employeeId, name: nameOf(x), cycleId: c.id, cycleName: c.name, milestone: x.r.milestone, stage, dueOn: due, overdue: !["shared", "acknowledged", "ready_to_share"].includes(stage) && due < t, mine: x.userId === user.id, toWrite: false };
  });
  return { cycle: { id: c.id, name: c.name, type: c.type, status: c.status, selfDueOn: c.selfDueOn, leadDueOn: c.leadDueOn, calibrateDueOn: c.calibrateDueOn }, reviews: list };
}

export type ReviewDetail = {
  id: string;
  cycleName: string;
  cycleId: string;
  cycleOpen: boolean;
  questions: Question[];
  milestone: number | null;
  employeeId: string;
  name: string;
  stage: Stage;
  viewer: Viewer;
  isPerson: boolean;
  canWriteSelf: boolean;
  canWriteLead: boolean;
  canCalibrate: boolean;
  canShare: boolean;
  canAcknowledge: boolean;
  canReassign: boolean;
  dues: { self: string; lead: string; calibrate: string };
  self: { answers: Answers; overallRating: number | null; comments: string | null; submittedAt: Date } | null;
  lead: { answers: Answers; overallRating: number | null; comments: string | null; submittedAt: Date } | null;
  /** The lead's own rating, hidden from the person when HR changed it. */
  leadRatingHidden: boolean;
  calibration: { finalRating: number; summary: string | null; changeReason: string | null; calibratedAt: Date } | null;
  acknowledgment: { comment: string | null; acknowledgedAt: Date } | null;
  leadName: string | null;
  leadOptions: { userId: string; name: string }[];
};

export async function getReview(reviewId: string): Promise<ReviewDetail> {
  const user = await requireUser();
  const viewScope = scopeFor(user, "reviews.view");
  const [row] = await db
    .select({ r: reviews, c: reviewCycles, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName })
    .from(reviews)
    .innerJoin(reviewCycles, eq(reviewCycles.id, reviews.cycleId))
    .innerJoin(employees, eq(employees.id, reviews.employeeId))
    .where(eq(reviews.id, reviewId));
  if (!row) throw new ForbiddenError("reviews.view");
  const chain = await managerChainUserIds(db, row.r.employeeId);
  const isPerson = row.userId === user.id;
  const isLead = chain.includes(user.id) || row.r.leadUserId === user.id;
  const isHr = viewScope === "all" && !isPerson;
  // Not yours looks the same as not there
  if (!isPerson && !isHr && !(viewScope === "team" && isLead)) throw new ForbiddenError("reviews.view");
  const viewer: Viewer = isPerson ? "person" : isHr ? "hr" : "lead";
  const stage = stageOf(row.r);
  const see = visibility(viewer, row.r);

  const responses = await db.select().from(reviewResponses).where(eq(reviewResponses.reviewId, reviewId));
  const [cal] = await db.select().from(reviewCalibrations).where(eq(reviewCalibrations.reviewId, reviewId)).orderBy(desc(reviewCalibrations.calibratedAt)).limit(1);
  const [ack] = await db.select().from(reviewAcknowledgments).where(eq(reviewAcknowledgments.reviewId, reviewId));
  const pick = (role: "self" | "lead", allowed: boolean) => {
    const r = responses.find((x) => x.role === role);
    return r && allowed ? { answers: r.answers as Answers, overallRating: r.overallRating, comments: r.comments, submittedAt: r.submittedAt } : null;
  };
  const leadResp = responses.find((x) => x.role === "lead");
  // The person is not shown a lead rating that HR changed; text answers and comments stay
  const changed = Boolean(cal && leadResp && leadResp.overallRating !== cal.finalRating);
  const hideLeadRating = viewer === "person" && changed;
  let lead = pick("lead", see.lead);
  if (lead && hideLeadRating) {
    const stripped: Answers = {};
    // eslint-disable-next-line security/detect-object-injection -- k comes from the stored answers
    for (const [k, v] of Object.entries(lead.answers)) stripped[k] = { text: v.text };
    lead = { ...lead, answers: stripped, overallRating: null };
  }

  const canWriteLead = viewer !== "person" && !row.r.leadSubmittedAt && row.c.status === "open" && (viewScope === "all" ? true : isLead);
  const canCalibrate = isHr && scopeFor(user, "reviews.calibrate") === "all" && Boolean(row.r.leadSubmittedAt) && !row.r.sharedAt;
  let leadName: string | null = null;
  if (row.r.leadUserId) {
    const [l] = await db.select({ first: employees.legalFirstName, last: employees.legalLastName, email: users.email }).from(users).leftJoin(employees, eq(employees.userId, users.id)).where(eq(users.id, row.r.leadUserId));
    leadName = l ? (l.first && l.last ? `${l.first} ${l.last}` : l.email) : null;
  }
  const canReassign = isHr && scopeFor(user, "reviews.manage_cycles") === "all" && !row.r.leadSubmittedAt;
  const leadOptions = canReassign
    ? (await db.select({ userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName }).from(employees).where(and(isNull(employees.archivedAt), eq(employees.status, "active")))).flatMap((e) => (e.userId && e.userId !== row.userId ? [{ userId: e.userId, name: `${e.first} ${e.last}` }] : [])).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return {
    id: row.r.id,
    cycleName: row.c.name,
    cycleId: row.c.id,
    cycleOpen: row.c.status === "open",
    questions: row.c.questions as Question[],
    milestone: row.r.milestone,
    employeeId: row.r.employeeId,
    name: nameOf(row),
    stage,
    viewer,
    isPerson,
    canWriteSelf: isPerson && !row.r.selfSubmittedAt && row.c.status === "open",
    canWriteLead,
    canCalibrate,
    canShare: canCalibrate && Boolean(row.r.calibratedAt) && scopeFor(user, "reviews.share") === "all",
    canAcknowledge: isPerson && Boolean(row.r.sharedAt) && !row.r.acknowledgedAt,
    canReassign,
    dues: { self: row.c.selfDueOn, lead: row.c.leadDueOn, calibrate: row.c.calibrateDueOn },
    self: pick("self", see.self),
    lead,
    leadRatingHidden: hideLeadRating,
    calibration: cal && see.calibration ? { finalRating: cal.finalRating, summary: cal.summary, changeReason: viewer === "hr" ? cal.changeReason : null, calibratedAt: cal.calibratedAt } : null,
    acknowledgment: ack ? { comment: ack.comment, acknowledgedAt: ack.acknowledgedAt } : null,
    leadName,
    leadOptions,
  };
}

// ---- Templates and settings -------------------------------------------------------------------------------------------------

export async function getReviewTemplates() {
  const user = await requireUser();
  if (scopeFor(user, "reviews.manage_templates") !== "all") throw new ForbiddenError("reviews.manage_templates");
  const templates = await db.select().from(reviewTemplates).where(isNull(reviewTemplates.archivedAt)).orderBy(asc(reviewTemplates.name));
  const [settings] = await db.select().from(reviewSettings).where(eq(reviewSettings.id, 1));
  return { templates: templates.map((t) => ({ id: t.id, name: t.name, questions: t.questions as Question[] })), early: { enabled: settings?.earlyEnabled ?? true, templateId: settings?.earlyTemplateId ?? null } };
}

/** What the "launch a cycle" form needs: templates, teams and people. */
export async function getLaunchOptions() {
  const user = await requireUser();
  if (scopeFor(user, "reviews.manage_cycles") !== "all") throw new ForbiddenError("reviews.manage_cycles");
  const templates = await db.select({ id: reviewTemplates.id, name: reviewTemplates.name }).from(reviewTemplates).where(isNull(reviewTemplates.archivedAt)).orderBy(asc(reviewTemplates.name));
  const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(isNull(teams.archivedAt)).orderBy(asc(teams.name));
  const people = await db.select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName }).from(employees).where(isNull(employees.archivedAt)).orderBy(asc(employees.legalLastName), asc(employees.legalFirstName));
  return { templates, teams: teamRows, people: people.map((p) => ({ id: p.id, name: `${p.last}, ${p.first}` })) };
}

// ---- Executive summary: counts and averages only, small groups hidden ------------------------------------------------------

export const MIN_GROUP = 5;

export async function getReviewSummary() {
  const user = await requireUser();
  if (scopeFor(user, "reviews.summary") === null) throw new ForbiddenError("reviews.summary");
  const cycles = await db.select().from(reviewCycles).orderBy(desc(reviewCycles.createdAt)).limit(12);
  const out = [];
  for (const c of cycles) {
    const rows = await db.select().from(reviews).where(eq(reviews.cycleId, c.id));
    const shared = rows.filter((r) => r.sharedAt);
    const cals = shared.length ? await db.select().from(reviewCalibrations).where(inArray(reviewCalibrations.reviewId, shared.map((r) => r.id))) : [];
    const latest = new Map<string, number>();
    for (const x of cals.sort((a, b) => a.calibratedAt.getTime() - b.calibratedAt.getTime())) latest.set(x.reviewId, x.finalRating);
    const ratings = [...latest.values()];
    out.push({
      id: c.id,
      name: c.name,
      total: rows.length,
      shared: shared.length,
      acknowledged: rows.filter((r) => r.acknowledgedAt).length,
      // An average of a handful of people points at individuals, so it is hidden below the minimum group size
      averageRating: ratings.length >= MIN_GROUP ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    });
  }
  return out;
}

// ---- Goals ------------------------------------------------------------------------------------------------------------------

export type GoalView = { id: string; employeeId: string; name: string; title: string; description: string | null; targetOn: string | null; status: string; mine: boolean; canManage: boolean; notes: { id: string; note: string; createdAt: Date; mine: boolean }[] };

export async function listGoals(): Promise<{ goals: GoalView[]; people: { id: string; name: string }[] }> {
  const user = await requireUser();
  const scope = scopeFor(user, "goals.view");
  const manageScope = scopeFor(user, "goals.manage");
  const ids = scope === "team" ? await downlineEmployeeIds(db, user.id) : [];
  const rows = await db
    .select({ g: goals, userId: employees.userId, first: employees.legalFirstName, last: employees.legalLastName })
    .from(goals)
    .innerJoin(employees, eq(employees.id, goals.employeeId))
    .where(isNull(goals.archivedAt))
    .orderBy(asc(employees.legalLastName), asc(goals.targetOn));
  const visible = rows.filter((x) => x.userId === user.id || scope === "all" || (scope === "team" && ids.includes(x.g.employeeId)));
  const notes = visible.length ? await db.select().from(goalNotes).where(inArray(goalNotes.goalId, visible.map((x) => x.g.id))).orderBy(asc(goalNotes.createdAt)) : [];
  const list = visible.map((x) => ({
    id: x.g.id,
    employeeId: x.g.employeeId,
    name: nameOf(x),
    title: x.g.title,
    description: x.g.description,
    targetOn: x.g.targetOn,
    status: x.g.status,
    mine: x.userId === user.id,
    canManage: manageScope !== null && (x.userId === user.id || manageScope === "all" || (manageScope === "team" && ids.includes(x.g.employeeId))),
    notes: notes.filter((n) => n.goalId === x.g.id).map((n) => ({ id: n.id, note: n.note, createdAt: n.createdAt, mine: n.authorUserId === user.id })),
  }));
  // Who a goal can be added for: oneself, and the people below (HR: everyone)
  const mine = await db.select({ id: employees.id, first: employees.legalFirstName, last: employees.legalLastName, userId: employees.userId }).from(employees).where(isNull(employees.archivedAt));
  const people = mine.filter((e) => e.userId === user.id || manageScope === "all" || (manageScope === "team" && ids.includes(e.id))).map((e) => ({ id: e.id, name: `${e.last}, ${e.first}` })).sort((a, b) => a.name.localeCompare(b.name));
  return { goals: list, people: manageScope === null ? [] : people };
}
