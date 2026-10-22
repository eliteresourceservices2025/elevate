import "server-only";
import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { authorize, ForbiddenError, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { employees } from "@/modules/people/schema";
import { teams } from "@/modules/org/schema";
import { users, userRoles } from "@/modules/core/schema";
import { reportName } from "@/modules/org/service";
import { getPrivacyNotice } from "@/modules/privacy/queries";
import { BOARD_STAGES, STAGES, type CloseKind, type CriterionKey, type Source, type Stage } from "./constants";
import { escapeLike, type ApplicantFilters } from "./applicant-filters";
import { groupDuplicates } from "./duplicates";
import { BUILT_IN_TEMPLATES, TEMPLATE_KINDS, TEMPLATE_LABELS, TEMPLATE_WHEN, type MailTemplate, type TemplateKind } from "./mail";
import { FUNNEL_STAGES, percent, reachedCounts, type FunnelStage } from "./report-math";
import { todayInZone } from "@/modules/org/service";
import { keywordSetKey } from "./keywords";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { pageInfo } from "@/lib/pagination";
import { looksLikeId } from "./slug";
import { applicationStageHistory, applicationTagLinks, emailTemplates, applicationTags, applications, candidateNotes, candidates, careersPage, interviewers, interviews, jobOpenings, openingHiringTeam, scorecards } from "./schema";
import { calendarStatus } from "./calendar";
import { authorizeForOpening, getRetentionSettings, hiringTeamIds } from "./service";

// ---- Public (no sign-in): only open jobs, only what the page shows -------------------------------------------------------

export type PublicOpening = { id: string; slug: string | null; title: string; location: string; payNote: string | null; description: string; openedAt: Date | null };

export async function listPublicOpenings(): Promise<Omit<PublicOpening, "description">[]> {
  return db
    .select({ id: jobOpenings.id, slug: jobOpenings.slug, title: jobOpenings.title, location: jobOpenings.location, payNote: jobOpenings.payNote, openedAt: jobOpenings.openedAt })
    .from(jobOpenings)
    .where(and(eq(jobOpenings.status, "open"), isNull(jobOpenings.archivedAt)))
    .orderBy(desc(jobOpenings.openedAt));
}

/** Every open job with its description, for the public job feed (the same jobs as the careers page, newest first). */
export async function listPublicOpeningsWithDescriptions(): Promise<PublicOpening[]> {
  return db
    .select({ id: jobOpenings.id, slug: jobOpenings.slug, title: jobOpenings.title, location: jobOpenings.location, payNote: jobOpenings.payNote, description: jobOpenings.description, openedAt: jobOpenings.openedAt })
    .from(jobOpenings)
    .where(and(eq(jobOpenings.status, "open"), isNull(jobOpenings.archivedAt)))
    .orderBy(desc(jobOpenings.openedAt));
}

/** One open job by its readable address, or by its id (old links keep working). */
export async function getPublicOpening(idOrSlug: string): Promise<PublicOpening | null> {
  const value = idOrSlug.trim().toLowerCase();
  if (!value || value.length > 80 || !/^[a-z0-9-]+$/.test(value)) return null;
  const match = looksLikeId(value) ? eq(jobOpenings.id, value) : sql`lower(${jobOpenings.slug}) = ${value}`;
  const [row] = await db
    .select({ id: jobOpenings.id, slug: jobOpenings.slug, title: jobOpenings.title, location: jobOpenings.location, payNote: jobOpenings.payNote, description: jobOpenings.description, openedAt: jobOpenings.openedAt })
    .from(jobOpenings)
    .where(and(match, eq(jobOpenings.status, "open"), isNull(jobOpenings.archivedAt)));
  return row ?? null;
}

export type CareersPageContent = { title: string | null; intro: string | null; bannerVersion: number | null };

/** The careers page's own wording and banner (public). Null fields mean the built-in wording. */
export async function getCareersPage(): Promise<CareersPageContent> {
  const [row] = await db.select().from(careersPage).where(eq(careersPage.id, 1)).limit(1);
  return { title: row?.title ?? null, intro: row?.intro ?? null, bannerVersion: row?.bannerPath && row.bannerUpdatedAt ? row.bannerUpdatedAt.getTime() : null };
}

/** The same, for the staff editor (needs the permission). */
export async function getCareersPageForEdit(): Promise<CareersPageContent> {
  const user = await requireUser();
  await authorize(user, "recruiting.manage_careers_page");
  return getCareersPage();
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

export type BoardCard = { applicationId: string; name: string; appliedAt: Date; stageChangedAt: Date; nextInterview: Date | null; scorecards: number; closeKind?: CloseKind | null };

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
  for (const r of rows) columns[r.stage as Stage].push({ applicationId: r.applicationId, name: r.anonymized ? "Removed applicant" : r.name, appliedAt: r.appliedAt, stageChangedAt: r.stageChangedAt, nextInterview: nextBy.get(r.applicationId) ?? null, scorecards: cardsBy.get(r.applicationId) ?? 0, closeKind: r.closeKind as CloseKind | null });

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

  const [opening] = await db.select({ id: jobOpenings.id, title: jobOpenings.title, status: jobOpenings.status, sendRejection: jobOpenings.sendRejection, keywordsRequired: jobOpenings.keywordsRequired, keywordsNice: jobOpenings.keywordsNice }).from(jobOpenings).where(eq(jobOpenings.id, app.openingId));
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
    application: { id: app.id, openingId: app.openingId, stage: app.stage as Stage, closeKind: app.closeKind, closeReason: app.closeReason, note: app.note, appliedAt: app.appliedAt, stageChangedAt: app.stageChangedAt, source: app.source as Source | null, sourceDetail: app.sourceDetail },
    tags: await tagsOfApplication(applicationId),
    pool: await poolOf(candidate, app.candidateId, applicationId, scopeFor(user, "recruiting.pool") !== null),
    keyword: {
      configured: opening.keywordsRequired.length + opening.keywordsNice.length > 0,
      score: app.keywordScore,
      matched: app.keywordMatched ?? [],
      missed: app.keywordMissed ?? [],
      scoredAt: app.keywordScoredAt,
      // True when the job's keywords were changed after this application was scored.
      stale: app.keywordScoredAt !== null && app.keywordSetKey !== keywordSetKey({ required: opening.keywordsRequired, nice: opening.keywordsNice }),
    },
    tagChoices: scopeFor(user, "recruiting.tag") !== null ? await listTagChoices() : [],
    canTag: scopeFor(user, "recruiting.tag") !== null,
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

// ---- All applicants (across jobs) ----------------------------------------------------------------------------------------

export type ApplicantRow = {
  applicationId: string;
  name: string;
  email: string | null;
  openingId: string;
  openingTitle: string;
  stage: Stage;
  closeKind: CloseKind | null;
  appliedAt: Date;
  stageChangedAt: Date;
  source: Source | null;
  /** Keyword match, 0 to 100, or null when the job has no keywords or the resume could not be read. */
  keywordScore: number | null;
  /** In the talent pool, with their agreement to be kept still running. */
  inPool: boolean;
  tags: TagChoice[];
};

/**
 * Every application the person may see, one row each, filtered, sorted and cut to one page in the database. HR, Super Admin and
 * recruiters see everything; a team lead only the jobs they are on the hiring team for. Removed (anonymized) applicants are listed
 * without a name or email and are never matched by a search.
 */
export async function listApplicants(filters: ApplicantFilters, paging: { page: number; pageSize: number }) {
  const user = await requireUser();
  const scope = scopeFor(user, "recruiting.view");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("recruiting.view");

  const teamOnly = scope === "team" ? inArray(jobOpenings.id, db.select({ id: openingHiringTeam.openingId }).from(openingHiringTeam).where(eq(openingHiringTeam.userId, user.id))) : undefined;
  const conditions = [isNull(jobOpenings.archivedAt), teamOnly];
  if (filters.openingId) conditions.push(eq(applications.openingId, filters.openingId));
  if (filters.stage === "open") conditions.push(notInArray(applications.stage, ["hired", "rejected"]));
  else if (filters.stage !== "all") conditions.push(eq(applications.stage, filters.stage));
  if (filters.closeKind !== "all") conditions.push(eq(applications.closeKind, filters.closeKind));
  if (filters.source === "none") conditions.push(isNull(applications.source));
  else if (filters.source !== "all") conditions.push(eq(applications.source, filters.source));
  if (filters.tagId) conditions.push(inArray(applications.id, db.select({ id: applicationTagLinks.applicationId }).from(applicationTagLinks).where(eq(applicationTagLinks.tagId, filters.tagId))));
  if (filters.from) conditions.push(sql`(${applications.appliedAt} at time zone ${DEFAULT_TIMEZONE})::date >= ${filters.from}::date`);
  if (filters.to) conditions.push(sql`(${applications.appliedAt} at time zone ${DEFAULT_TIMEZONE})::date <= ${filters.to}::date`);
  if (filters.q) {
    const like = `%${escapeLike(filters.q.toLowerCase())}%`;
    conditions.push(and(isNull(candidates.anonymizedAt), or(sql`lower(${candidates.fullName}) like ${like}`, sql`lower(${candidates.email}) like ${like}`)));
  }
  if (filters.poolOnly) conditions.push(sql`${candidates.inPool} and ${candidates.poolExpiresAt} > now()`);
  if (filters.minScore !== null) conditions.push(sql`${applications.keywordScore} >= ${filters.minScore}`);
  const where = and(...conditions);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
    .where(where);
  const info = pageInfo(total, paging.page, paging.pageSize);

  const order = filters.sort === "name" ? [asc(sql`lower(${candidates.fullName})`), desc(applications.appliedAt)] : filters.sort === "updated" ? [desc(applications.stageChangedAt)] : filters.sort === "score" ? [sql`${applications.keywordScore} desc nulls last`, desc(applications.appliedAt)] : [desc(applications.appliedAt)];
  const rows = await db
    .select({
      applicationId: applications.id,
      name: candidates.fullName,
      email: candidates.email,
      anonymized: candidates.anonymizedAt,
      openingId: applications.openingId,
      openingTitle: jobOpenings.title,
      stage: applications.stage,
      closeKind: applications.closeKind,
      appliedAt: applications.appliedAt,
      stageChangedAt: applications.stageChangedAt,
      source: applications.source,
      keywordScore: applications.keywordScore,
      inPool: candidates.inPool,
      poolExpiresAt: candidates.poolExpiresAt,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
    .where(where)
    .orderBy(...order, asc(applications.id))
    .limit(info.pageSize)
    .offset(info.offset);

  const openings = await db
    .select({ id: jobOpenings.id, title: jobOpenings.title })
    .from(jobOpenings)
    .where(and(isNull(jobOpenings.archivedAt), teamOnly))
    .orderBy(asc(jobOpenings.title));

  // Tags for just the rows on this page, in one query.
  const tagRows = rows.length
    ? await db
        .select({ applicationId: applicationTagLinks.applicationId, id: applicationTags.id, name: applicationTags.name })
        .from(applicationTagLinks)
        .innerJoin(applicationTags, eq(applicationTags.id, applicationTagLinks.tagId))
        .where(and(inArray(applicationTagLinks.applicationId, rows.map((r) => r.applicationId)), isNull(applicationTags.archivedAt)))
        .orderBy(asc(sql`lower(${applicationTags.name})`))
    : [];
  const tagsBy = new Map<string, TagChoice[]>();
  for (const t of tagRows) tagsBy.set(t.applicationId, [...(tagsBy.get(t.applicationId) ?? []), { id: t.id, name: t.name }]);

  const list: ApplicantRow[] = rows.map((r) => ({
    applicationId: r.applicationId,
    name: r.anonymized ? "Removed applicant" : r.name,
    email: r.anonymized ? null : r.email,
    openingId: r.openingId,
    openingTitle: r.openingTitle,
    stage: r.stage as Stage,
    closeKind: r.closeKind as CloseKind | null,
    appliedAt: r.appliedAt,
    stageChangedAt: r.stageChangedAt,
    source: r.source as Source | null,
    keywordScore: r.keywordScore,
    inPool: r.inPool && r.poolExpiresAt !== null && r.poolExpiresAt > new Date(),
    tags: tagsBy.get(r.applicationId) ?? [],
  }));
  return { scope, rows: list, info, openings, tagChoices: await listTagChoices(), canBulk: scopeFor(user, "recruiting.bulk") !== null, canMerge: scopeFor(user, "recruiting.merge") !== null };
}

// ---- Tags -----------------------------------------------------------------------------------------------------------------

export type TagChoice = { id: string; name: string };

/** Every live tag, A to Z (internal: callers authorize first). */
async function listTagChoices(): Promise<TagChoice[]> {
  return db.select({ id: applicationTags.id, name: applicationTags.name }).from(applicationTags).where(isNull(applicationTags.archivedAt)).orderBy(asc(sql`lower(${applicationTags.name})`));
}

async function tagsOfApplication(applicationId: string): Promise<TagChoice[]> {
  return db
    .select({ id: applicationTags.id, name: applicationTags.name })
    .from(applicationTagLinks)
    .innerJoin(applicationTags, eq(applicationTags.id, applicationTagLinks.tagId))
    .where(and(eq(applicationTagLinks.applicationId, applicationId), isNull(applicationTags.archivedAt)))
    .orderBy(asc(sql`lower(${applicationTags.name})`));
}

// ---- Talent pool and duplicates ---------------------------------------------------------------------------------------------

export type PoolView = {
  /** They ticked "keep my details" and it has not run out. */
  consented: boolean;
  inPool: boolean;
  expiresAt: Date | null;
  canManage: boolean;
  /** Open jobs they have not applied for yet (only filled for someone who is in the pool and may be moved). */
  openings: { id: string; title: string }[];
};

async function poolOf(candidate: { anonymizedAt: Date | null; inPool: boolean; poolConsentAt: Date | null; poolExpiresAt: Date | null }, candidateId: string, _applicationId: string, canManage: boolean): Promise<PoolView> {
  const live = Boolean(candidate.poolConsentAt && candidate.poolExpiresAt && candidate.poolExpiresAt > new Date());
  const inPool = candidate.inPool && live;
  let openings: PoolView["openings"] = [];
  if (canManage && inPool && !candidate.anonymizedAt) {
    openings = await db
      .select({ id: jobOpenings.id, title: jobOpenings.title })
      .from(jobOpenings)
      .where(and(eq(jobOpenings.status, "open"), isNull(jobOpenings.archivedAt), sql`not exists (select 1 from talent.applications a where a.opening_id = ${jobOpenings.id} and a.candidate_id = ${candidateId})`))
      .orderBy(asc(jobOpenings.title));
  }
  return { consented: live, inPool, expiresAt: candidate.poolExpiresAt, canManage, openings };
}

export type DuplicateCandidate = { id: string; name: string; email: string; phone: string | null; appliedFor: { title: string; stage: Stage }[]; inPool: boolean };
export type DuplicateGroupView = { reasons: ("phone" | "name")[]; candidates: DuplicateCandidate[] };

/** Applicants who look like the same person (same phone or same name, different email). HR reviews each group and decides; nothing is merged for them. */
export async function listDuplicateGroups(): Promise<DuplicateGroupView[]> {
  const user = await requireUser();
  await authorize(user, "recruiting.merge");
  const all = await db
    .select({ id: candidates.id, fullName: candidates.fullName, email: candidates.email, phone: candidates.phone, inPool: candidates.inPool })
    .from(candidates)
    .where(isNull(candidates.anonymizedAt))
    .limit(20_000);
  const groups = groupDuplicates(all).slice(0, 100);
  if (groups.length === 0) return [];
  const ids = groups.flatMap((g) => g.ids);
  const apps = await db
    .select({ candidateId: applications.candidateId, title: jobOpenings.title, stage: applications.stage })
    .from(applications)
    .innerJoin(jobOpenings, eq(jobOpenings.id, applications.openingId))
    .where(inArray(applications.candidateId, ids))
    .orderBy(desc(applications.appliedAt));
  const byId = new Map(all.map((c) => [c.id, c]));
  return groups.map((g) => ({
    reasons: g.reasons,
    candidates: g.ids.map((id) => {
      const c = byId.get(id)!;
      return { id, name: c.fullName, email: c.email, phone: c.phone, inPool: c.inPool, appliedFor: apps.filter((a) => a.candidateId === id).map((a) => ({ title: a.title, stage: a.stage as Stage })) };
    }),
  }));
}

// ---- Reports and email wording --------------------------------------------------------------------------------------------

export type ReportFilters = { from: string | null; to: string | null; openingId: string | null };
export type RecruitingReport = {
  range: { from: string; to: string };
  total: number;
  funnel: { stage: FunnelStage; reached: number; ofApplied: number | null; ofPrevious: number | null }[];
  closed: { kind: CloseKind | null; n: number }[];
  timeInStage: { stage: Stage; medianDays: number | null; n: number }[];
  sources: { source: Source | null; total: number; interviews: number; hired: number }[];
  stale: { openingId: string; title: string; n: number }[];
  openings: { id: string; title: string }[];
};

const REPORT_DEFAULT_DAYS = 90;
const STALE_DAYS = 14;
const isoPlusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Counts only, never names: how far applications got, how long they sit in each stage, which sources turn into interviews and hires, how
 * applications ended, and where open applications have been waiting. For applications that came in within the date range (default: the
 * last 90 days), optionally for one job.
 */
export async function getRecruitingReport(f: ReportFilters): Promise<RecruitingReport> {
  const user = await requireUser();
  await authorize(user, "recruiting.reports");
  const today = todayInZone();
  const to = f.to ?? today;
  const from = f.from ?? isoPlusDays(to, -REPORT_DEFAULT_DAYS);
  const range = from <= to ? { from, to } : { from: to, to: from };
  const job = f.openingId ? sql`and a.opening_id = ${f.openingId}` : sql``;
  const inRange = sql`(a.applied_at at time zone ${DEFAULT_TIMEZONE})::date between ${range.from}::date and ${range.to}::date ${job}`;
  // How far each application got: 0 applied, 1 screening, 2 interview, 3 assessment, 4 offer, 5 hired (closed ones count where they stopped).
  const furthest = sql`(select application_id, max(case to_stage when 'screening' then 1 when 'interview' then 2 when 'assessment' then 3 when 'offer' then 4 when 'hired' then 5 else 0 end) as idx from talent.application_stage_history group by application_id)`;
  const q = async <T>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];

  const reach = await q<{ idx: number; n: number }>(sql`select coalesce(m.idx, 0)::int as idx, count(*)::int as n from talent.applications a left join ${furthest} m on m.application_id = a.id where ${inRange} group by 1`);
  const reached = reachedCounts(Object.fromEntries(reach.map((r) => [r.idx, r.n])));
  const total = reached[0];

  const closed = await q<{ kind: string | null; n: number }>(sql`select a.close_kind as kind, count(*)::int as n from talent.applications a where ${inRange} and a.stage = 'rejected' group by a.close_kind order by n desc`);
  const timing = await q<{ stage: string; n: number; median_days: number | null }>(sql`
    with s as (
      select h.application_id, h.to_stage as stage, h.at, lead(h.at) over (partition by h.application_id order by h.at, h.id) as next_at
      from talent.application_stage_history h join talent.applications a on a.id = h.application_id where ${inRange}
    )
    select stage, count(*)::int as n, percentile_cont(0.5) within group (order by extract(epoch from (coalesce(next_at, now()) - at)) / 86400.0) as median_days
    from s where stage in ('applied','screening','interview','assessment','offer') group by stage`);
  const sources = await q<{ source: string | null; total: number; interviews: number; hired: number }>(sql`
    select a.source, count(*)::int as total, count(*) filter (where coalesce(m.idx, 0) >= 2)::int as interviews, count(*) filter (where a.stage = 'hired')::int as hired
    from talent.applications a left join ${furthest} m on m.application_id = a.id where ${inRange} group by a.source order by total desc`);
  const stale = await q<{ opening_id: string; title: string; n: number }>(sql`
    select j.id as opening_id, j.title, count(*)::int as n from talent.applications a join talent.job_openings j on j.id = a.opening_id
    where a.stage not in ('hired','rejected') and a.stage_changed_at < now() - ${`${STALE_DAYS} days`}::interval and j.archived_at is null ${job}
    group by j.id, j.title order by n desc, j.title limit 10`);
  const openings = await db.select({ id: jobOpenings.id, title: jobOpenings.title }).from(jobOpenings).where(isNull(jobOpenings.archivedAt)).orderBy(asc(jobOpenings.title));

  return {
    range,
    total,
    funnel: FUNNEL_STAGES.map((stage, i) => ({ stage, reached: reached[i], ofApplied: percent(reached[i], total), ofPrevious: i === 0 ? null : percent(reached[i], reached[i - 1]) })),
    closed: closed.map((c) => ({ kind: c.kind as CloseKind | null, n: c.n })),
    timeInStage: (["applied", "screening", "interview", "assessment", "offer"] as const).map((stage) => {
      const row = timing.find((t) => t.stage === stage);
      return { stage, medianDays: row?.median_days === null || row?.median_days === undefined ? null : Number(row.median_days), n: row?.n ?? 0 };
    }),
    sources: sources.map((s) => ({ source: s.source as Source | null, total: s.total, interviews: s.interviews, hired: s.hired })),
    stale: stale.map((s) => ({ openingId: s.opening_id, title: s.title, n: s.n })),
    openings,
  };
}

export const REPORT_STALE_DAYS = STALE_DAYS;

export type EmailTemplateView = { kind: TemplateKind; label: string; when: string; subject: string; body: string; custom: boolean; builtIn: MailTemplate };

/** The wording of each applicant email: HR's own if they saved one, else the built-in. */
export async function listEmailTemplates(): Promise<EmailTemplateView[]> {
  const user = await requireUser();
  await authorize(user, "recruiting.manage_email_templates");
  const saved = await db.select().from(emailTemplates);
  return TEMPLATE_KINDS.map((kind) => {
    const row = saved.find((s) => s.kind === kind);
    return { kind, label: TEMPLATE_LABELS[kind], when: TEMPLATE_WHEN[kind], subject: row?.subject ?? BUILT_IN_TEMPLATES[kind].subject, body: row?.body ?? BUILT_IN_TEMPLATES[kind].body, custom: Boolean(row), builtIn: BUILT_IN_TEMPLATES[kind] };
  });
}
