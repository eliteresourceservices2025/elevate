import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { authorize, ForbiddenError, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { employees } from "@/modules/people/schema";
import { teams } from "@/modules/org/schema";
import { users, userRoles } from "@/modules/core/schema";
import { reportName } from "@/modules/org/service";
import { getPrivacyNotice } from "@/modules/privacy/queries";
import { BOARD_STAGES, STAGES, type CriterionKey, type Stage } from "./constants";
import { applicationStageHistory, applications, candidateNotes, candidates, interviewers, interviews, jobOpenings, openingHiringTeam, scorecards } from "./schema";
import { calendarStatus } from "./calendar";
import { authorizeForOpening, getRetentionSettings, hiringTeamIds } from "./service";

// ---- Public (no sign-in): only open jobs, only what the page shows -------------------------------------------------------

export type PublicOpening = { id: string; title: string; location: string; payNote: string | null; description: string; openedAt: Date | null };

export async function listPublicOpenings(): Promise<Omit<PublicOpening, "description">[]> {
  return db
    .select({ id: jobOpenings.id, title: jobOpenings.title, location: jobOpenings.location, payNote: jobOpenings.payNote, openedAt: jobOpenings.openedAt })
    .from(jobOpenings)
    .where(and(eq(jobOpenings.status, "open"), isNull(jobOpenings.archivedAt)))
    .orderBy(desc(jobOpenings.openedAt));
}

export async function getPublicOpening(id: string): Promise<PublicOpening | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ id: jobOpenings.id, title: jobOpenings.title, location: jobOpenings.location, payNote: jobOpenings.payNote, description: jobOpenings.description, openedAt: jobOpenings.openedAt })
    .from(jobOpenings)
    .where(and(eq(jobOpenings.id, id), eq(jobOpenings.status, "open"), isNull(jobOpenings.archivedAt)));
  return row ?? null;
}

export async function getPublicPrivacyNotice() {
  const notice = await getPrivacyNotice();
  return notice ? { title: notice.title, version: notice.version, body: notice.body } : null;
}

// ---- Staff ---------------------------------------------------------------------------------------------------------------

export type StageCounts = Record<Stage, number>;
const emptyCounts = (): StageCounts => Object.fromEntries(STAGES.map((s) => [s, 0])) as StageCounts;

export type OpeningRow = { id: string; title: string; status: string; team: string | null; openedAt: Date | null; counts: StageCounts; total: number; newThisWeek: number };

/** Openings the person may see: everything for HR and recruiters, only the hiring-team openings for a team lead. */
export async function listOpenings(): Promise<{ scope: "all" | "team"; rows: OpeningRow[] }> {
  const user = await requireUser();
  const scope = scopeFor(user, "recruiting.view");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("recruiting.view");

  const where = scope === "team" ? and(isNull(jobOpenings.archivedAt), inArray(jobOpenings.id, db.select({ id: openingHiringTeam.openingId }).from(openingHiringTeam).where(eq(openingHiringTeam.userId, user.id)))) : isNull(jobOpenings.archivedAt);
  const openings = await db
    .select({ id: jobOpenings.id, title: jobOpenings.title, status: jobOpenings.status, team: teams.name, openedAt: jobOpenings.openedAt, createdAt: jobOpenings.createdAt })
    .from(jobOpenings)
    .leftJoin(teams, eq(teams.id, jobOpenings.teamId))
    .where(where)
    .orderBy(desc(jobOpenings.createdAt));
  if (openings.length === 0) return { scope, rows: [] };

  const counted = await db
    .select({ openingId: applications.openingId, stage: applications.stage, n: sql<number>`count(*)::int`, recent: sql<number>`count(*) filter (where ${applications.appliedAt} > now() - interval '7 days')::int` })
    .from(applications)
    .where(inArray(applications.openingId, openings.map((o) => o.id)))
    .groupBy(applications.openingId, applications.stage);
  const byOpening = new Map<string, { counts: StageCounts; recent: number }>();
  for (const c of counted) {
    const entry = byOpening.get(c.openingId) ?? { counts: emptyCounts(), recent: 0 };
    entry.counts[c.stage as Stage] = c.n;
    entry.recent += c.recent;
    byOpening.set(c.openingId, entry);
  }
  return {
    scope,
    rows: openings.map((o) => {
      const e = byOpening.get(o.id);
      const counts = e?.counts ?? emptyCounts();
      return { id: o.id, title: o.title, status: o.status, team: o.team, openedAt: o.openedAt, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), newThisWeek: e?.recent ?? 0 };
    }),
  };
}

/** Counts only, for the Executive (and the top of the page for everyone who can see it). No names, no openings' candidates. */
export async function getRecruitingSummary() {
  const user = await requireUser();
  await authorize(user, "recruiting.summary", { managerChainUserIds: [user.id] });
  const [open] = await db.select({ n: sql<number>`count(*)::int` }).from(jobOpenings).where(and(eq(jobOpenings.status, "open"), isNull(jobOpenings.archivedAt)));
  const stages = await db.select({ stage: applications.stage, n: sql<number>`count(*)::int` }).from(applications).groupBy(applications.stage);
  const counts = emptyCounts();
  for (const s of stages) counts[s.stage as Stage] = s.n;
  const [recent] = await db.select({ n: sql<number>`count(*)::int` }).from(applications).where(sql`${applications.appliedAt} > now() - interval '30 days'`);
  const [hired] = await db.select({ n: sql<number>`count(*)::int` }).from(applications).where(and(eq(applications.stage, "hired"), sql`${applications.closedAt} > now() - interval '90 days'`));
  return { openJobs: open.n, counts, applicationsLast30Days: recent.n, hiredLast90Days: hired.n };
}

const nameOrEmail = (n: { first: string | null; last: string | null; preferred: string | null } | null, email: string) => (n?.first && n.last ? reportName({ first: n.first, last: n.last, preferred: n.preferred }) : email);

export type PersonChoice = { userId: string; name: string };

/** People who can be interviewers or on a hiring team: HR, Super Admin, recruiters and team leads. */
export async function listInterviewerChoices(): Promise<PersonChoice[]> {
  const user = await requireUser();
  await authorize(user, "recruiting.interview");
  const rows = await db
    .select({ userId: users.id, email: users.email, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(and(isNull(users.archivedAt), inArray(userRoles.roleSlug, ["super_admin", "hr_admin", "recruiter", "team_lead"])));
  const seen = new Map<string, PersonChoice>();
  for (const r of rows) if (!seen.has(r.userId)) seen.set(r.userId, { userId: r.userId, name: nameOrEmail(r.first ? { first: r.first, last: r.last, preferred: r.preferred } : null, r.email) });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export type BoardCard = { applicationId: string; name: string; appliedAt: Date; stageChangedAt: Date; nextInterview: Date | null; scorecards: number };

export async function getOpeningBoard(openingId: string) {
  const user = await requireUser();
  await authorizeForOpening(user, "recruiting.view", openingId);
  const [opening] = await db.select().from(jobOpenings).where(and(eq(jobOpenings.id, openingId), isNull(jobOpenings.archivedAt)));
  if (!opening) throw new ForbiddenError("recruiting.view"); // shown as "not found"

  const rows = await db
    .select({ applicationId: applications.id, name: candidates.fullName, anonymized: candidates.anonymizedAt, stage: applications.stage, appliedAt: applications.appliedAt, stageChangedAt: applications.stageChangedAt, closeKind: applications.closeKind })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(eq(applications.openingId, openingId))
    .orderBy(asc(applications.stageChangedAt));
  const ids = rows.map((r) => r.applicationId);
  const next = ids.length ? await db.select({ applicationId: interviews.applicationId, at: sql<Date>`min(${interviews.startsAt})` }).from(interviews).where(and(inArray(interviews.applicationId, ids), eq(interviews.status, "scheduled"), sql`${interviews.startsAt} > now()`)).groupBy(interviews.applicationId) : [];
  const cards = ids.length ? await db.select({ applicationId: scorecards.applicationId, n: sql<number>`count(*)::int` }).from(scorecards).where(inArray(scorecards.applicationId, ids)).groupBy(scorecards.applicationId) : [];
  const nextBy = new Map(next.map((n) => [n.applicationId, n.at]));
  const cardsBy = new Map(cards.map((c) => [c.applicationId, c.n]));

  const columns = Object.fromEntries(STAGES.map((s) => [s, [] as BoardCard[]])) as Record<Stage, BoardCard[]>;
  for (const r of rows) columns[r.stage as Stage].push({ applicationId: r.applicationId, name: r.anonymized ? "Removed applicant" : r.name, appliedAt: r.appliedAt, stageChangedAt: r.stageChangedAt, nextInterview: nextBy.get(r.applicationId) ?? null, scorecards: cardsBy.get(r.applicationId) ?? 0 });

  const teamIds = await hiringTeamIds(db, openingId);
  const hiringTeam = teamIds.length ? (await listAllNames(teamIds)) : [];
  const [team] = opening.teamId ? await db.select({ name: teams.name }).from(teams).where(eq(teams.id, opening.teamId)) : [];
  const canMove = scopeFor(user, "recruiting.move") !== null;
  const canManage = scopeFor(user, "recruiting.manage_openings") !== null;
  return { opening: { ...opening, teamName: team?.name ?? null }, columns, boardStages: BOARD_STAGES, hiringTeam, canMove, canManage };
}

async function listAllNames(userIds: string[]): Promise<PersonChoice[]> {
  const rows = await db
    .select({ userId: users.id, email: users.email, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(inArray(users.id, userIds));
  return rows.map((r) => ({ userId: r.userId, name: nameOrEmail(r.first ? { first: r.first, last: r.last, preferred: r.preferred } : null, r.email) }));
}

export type ScorecardView = { id: string; interviewerId: string; interviewerName: string; ratings: Partial<Record<CriterionKey, number>>; recommendation: string; comments: string; submittedAt: Date; mine: boolean };
export type InterviewView = { id: string; kind: string; startsAt: Date; minutes: number; location: string; note: string | null; status: string; calendarMode: string; meetLink: string | null; interviewers: PersonChoice[]; iAmInterviewer: boolean; mySubmitted: boolean; scorecards: ScorecardView[]; scorecardsHidden: boolean; waitingOn: number };

/**
 * One application with everything needed to decide. Others' scorecards stay hidden from an interviewer until they have
 * submitted their own; people who manage the process but are not interviewers on that interview see them all.
 */
export async function getApplication(applicationId: string) {
  const user = await requireUser();
  const [app] = await db.select().from(applications).where(eq(applications.id, applicationId));
  if (!app) throw new ForbiddenError("recruiting.view"); // same answer as "no access": the page shows not found
  await authorizeForOpening(user, "recruiting.view", app.openingId);

  const [opening] = await db.select({ id: jobOpenings.id, title: jobOpenings.title, status: jobOpenings.status, sendRejection: jobOpenings.sendRejection }).from(jobOpenings).where(eq(jobOpenings.id, app.openingId));
  const [candidate] = await db.select().from(candidates).where(eq(candidates.id, app.candidateId));

  const history = await db.select({ id: applicationStageHistory.id, fromStage: applicationStageHistory.fromStage, toStage: applicationStageHistory.toStage, note: applicationStageHistory.note, at: applicationStageHistory.at, by: applicationStageHistory.byUserId }).from(applicationStageHistory).where(eq(applicationStageHistory.applicationId, applicationId)).orderBy(asc(applicationStageHistory.at));
  const notes = await db.select({ id: candidateNotes.id, body: candidateNotes.body, createdAt: candidateNotes.createdAt, author: candidateNotes.authorId }).from(candidateNotes).where(eq(candidateNotes.applicationId, applicationId)).orderBy(desc(candidateNotes.createdAt));

  const iv = await db.select().from(interviews).where(eq(interviews.applicationId, applicationId)).orderBy(asc(interviews.startsAt));
  const ivIds = iv.map((i) => i.id);
  const people = ivIds.length ? await db.select({ interviewId: interviewers.interviewId, userId: interviewers.userId }).from(interviewers).where(inArray(interviewers.interviewId, ivIds)) : [];
  const cards = await db.select().from(scorecards).where(eq(scorecards.applicationId, applicationId));

  const nameIds = [...new Set([...history.map((h) => h.by), ...notes.map((n) => n.author), ...people.map((p) => p.userId), ...cards.map((c) => c.interviewerId)].filter((x): x is string => !!x))];
  const names = new Map((nameIds.length ? await listAllNames(nameIds) : []).map((n) => [n.userId, n.name]));
  const manages = scopeFor(user, "recruiting.manage_openings") !== null;

  const interviewViews: InterviewView[] = iv.map((i) => {
    const panel = people.filter((p) => p.interviewId === i.id).map((p) => ({ userId: p.userId, name: names.get(p.userId) ?? "Unknown" }));
    const iAmInterviewer = panel.some((p) => p.userId === user.id);
    const mine = cards.find((c) => c.interviewId === i.id && c.interviewerId === user.id);
    const all = cards.filter((c) => c.interviewId === i.id);
    const visible = iAmInterviewer ? (mine ? all : []) : manages || all.length === 0 ? all : all.filter((c) => c.interviewerId === user.id);
    return {
      id: i.id,
      kind: i.kind,
      startsAt: i.startsAt,
      minutes: i.minutes,
      location: i.location,
      note: i.note,
      status: i.status,
      calendarMode: i.calendarMode,
      meetLink: i.meetLink,
      interviewers: panel,
      iAmInterviewer,
      mySubmitted: Boolean(mine),
      scorecardsHidden: iAmInterviewer && !mine && all.length > 0,
      waitingOn: panel.length - all.length,
      scorecards: visible.map((c) => ({ id: c.id, interviewerId: c.interviewerId, interviewerName: names.get(c.interviewerId) ?? "Unknown", ratings: c.ratings as Partial<Record<CriterionKey, number>>, recommendation: c.recommendation, comments: c.comments, submittedAt: c.submittedAt, mine: c.interviewerId === user.id })),
    };
  });

  return {
    nowMs: Date.now(),
    application: { id: app.id, openingId: app.openingId, stage: app.stage as Stage, closeKind: app.closeKind, closeReason: app.closeReason, note: app.note, appliedAt: app.appliedAt, stageChangedAt: app.stageChangedAt },
    opening,
    candidate: candidate.anonymizedAt ? { removed: true as const } : { removed: false as const, name: candidate.fullName, email: candidate.email, phone: candidate.phone, country: candidate.country, hasResume: Boolean(candidate.resumePath), resumeKind: candidate.resumeKind, resumeName: candidate.resumeName, consentAt: candidate.consentAt, consentVersion: candidate.consentNoticeVersion },
    history: history.map((h) => ({ ...h, byName: h.by ? (names.get(h.by) ?? "Unknown") : "Applicant" })),
    notes: notes.map((n) => ({ ...n, authorName: names.get(n.author) ?? "Unknown" })),
    interviews: interviewViews,
    canMove: scopeFor(user, "recruiting.move") !== null,
    canInterview: scopeFor(user, "recruiting.interview") !== null,
    canDownload: true,
  };
}

/** The signed-in person's Google Calendar connection, for the Recruiting page and the interview form. Only those who may connect see it. */
export async function getCalendarCard() {
  const user = await requireUser();
  await authorize(user, "recruiting.connect_calendar", { ownerUserId: user.id });
  return calendarStatus(user.id);
}

export async function getRetentionView() {
  const user = await requireUser();
  await authorize(user, "recruiting.manage_retention");
  return getRetentionSettings();
}

/** Teams and clients for the opening form. */
export async function getOpeningFormOptions(openingId?: string) {
  const user = await requireUser();
  await authorize(user, "recruiting.manage_openings");
  const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams).where(isNull(teams.archivedAt)).orderBy(asc(teams.name));
  const choices = await listInterviewerChoices();
  const opening = openingId ? (await db.select().from(jobOpenings).where(eq(jobOpenings.id, openingId)))[0] : undefined;
  const hiringTeamUserIds = openingId ? await hiringTeamIds(db, openingId) : [];
  return { teams: teamRows, people: choices, opening: opening ?? null, hiringTeamUserIds };
}
