import "server-only";
import { sql } from "drizzle-orm";
import { ForbiddenError, authorize, can, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageInfo, type PageInfo } from "@/lib/pagination";
import { downlineEmployeeIds, todayInZone } from "@/modules/org/service";
import { listLearnCourses, pickCourse } from "./course-catalog";
import type { LearnCourseInfo } from "./constants";
import { uuidArray } from "./jobs";
import type { InstructionFacts } from "./instructions";
import { describeDue } from "./rules";
import { trainingFilterSchema } from "./validators";

// Training status for HR and for leads. A lead sees status only (passed, not yet, overdue); scores and attempts are HR's. The
// course is chosen by the filter (HIPAA by default); each person's NEWEST assignment for it decides what is shown.

export type TrainingState = "none" | "open" | "overdue" | "passed" | "expired" | "cancelled" | "no_account" | "queued";

export type TrainingRow = {
  employeeId: string;
  /** Null for a new hire who has not signed in yet: they cannot have an assignment until they do (see "queued"). */
  userId: string | null;
  name: string;
  team: string | null;
  assignmentId: string | null;
  track: string | null;
  assignmentReason: string | null;
  /** Only update assignments have this: the changed modules a certified person must revisit. */
  updateModules: string[] | null;
  dueChanged: boolean;
  state: TrainingState;
  /** Plain words for the state: "Passed", "Not yet", "Overdue", "Not assigned". */
  label: string;
  dueOn: string | null;
  dueText: string | null;
  certificateEndsOn: string | null;
  /** HR only. */
  attempts: number | null;
  lastScore: number | null;
};

export type TrainingCounts = { people: number; passed: number; open: number; overdue: number; none: number };

/** Records that need an HR decision; this query never changes training data. */
export type TrainingRemediationReview = {
  essentialsAssignments: { assignmentId: string; name: string; dueOn: string; status: string }[];
  orphanedCertificates: { certificateId: string; sourceUserId: string; reference: string; holderName: string; course: string; endsOn: string; sourceEmail: string }[];
  canRepair: boolean;
  repairTargets: { employeeId: string; name: string }[];
};

const LABEL: Record<TrainingState, string> = { none: "Not assigned", open: "Not yet", overdue: "Overdue", passed: "Passed", expired: "Expired", cancelled: "Closed", no_account: "Not signed in yet", queued: "Queued" };

type Raw = {
  employee_id: string;
  user_id: string | null;
  queued: boolean;
  name: string;
  team_name: string | null;
  assignment_id: string | null;
  track: string | null;
  reason: string | null;
  update_modules: string[] | null;
  due_changed: boolean;
  status: string | null;
  due_on: string | null;
  cert_ends: string | null;
  attempts: number | null;
  last_score: number | null;
};

/**
 * Everyone in the viewer's reach with their HIPAA training state. HR (and Super Admin) see everyone; a Team Lead sees people below
 * them in the reporting chain, with no scores. Filtered, counted and paged here (the lists are a few hundred people at most).
 */
export async function listTrainingStatus(rawFilters: unknown, paging: { page: number; pageSize: number }): Promise<{ rows: TrainingRow[]; counts: TrainingCounts; info: PageInfo; canSeeResults: boolean; canManage: boolean; course: string; courseLabel: string; courses: LearnCourseInfo[]; fixedTrack: boolean; published: boolean }> {
  const user = await requireUser();
  // Team scope needs the resource's reporting chain, so a list checks the scope itself and narrows the rows to the viewer's downline.
  const scope = scopeFor(user, "learn.view_status");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("learn.view_status");
  const canSeeResults = scopeFor(user, "learn.view_results") === "all";
  const canManage = scopeFor(user, "learn.assign") === "all";
  const f = trainingFilterSchema.safeParse(rawFilters ?? {});
  const filters = f.success ? f.data : {};
  const courses = await listLearnCourses(db);
  const picked = pickCourse(courses, filters.course);
  const course = picked.slug;
  const extra = { courseLabel: picked.label, courses, fixedTrack: picked.fixedTrack !== null };
  const publishedRows = (await db.execute(sql`select 1 from learn.course_versions v join learn.courses c on c.id = v.course_id where c.slug = ${course} and v.status = 'published' limit 1`)) as unknown as unknown[];
  const published = publishedRows.length > 0;
  const today = todayInZone();

  const team = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (team && team.length === 0) return { rows: [], counts: { people: 0, passed: 0, open: 0, overdue: 0, none: 0 }, info: pageInfo(0, paging.page, paging.pageSize), canSeeResults, canManage, course, ...extra, published };

  const raw = (await db.execute(sql`
    with latest as (
      select distinct on (a.user_id) a.* from learn.assignments a join learn.courses c on c.id = a.course_id
      where c.slug = ${course} order by a.user_id, a.assigned_at desc
    )
    select e.id as employee_id, u.id as user_id,
           exists (select 1 from learn.pending_assignments pa join learn.courses pc on pc.id = pa.course_id where pa.employee_id = e.id and pc.slug = ${course}) as queued,
           coalesce(nullif(btrim(coalesce(e.preferred_name, e.legal_first_name) || ' ' || e.legal_last_name), ''), e.work_email) as name,
           tm.name as team_name, l.id as assignment_id, l.track, l.reason, l.status, l.due_on::text as due_on,
           us.module_keys as update_modules,
           exists (select 1 from learn.assignment_due_changes dc where dc.assignment_id = l.id) as due_changed,
           (select max(c.ends_on)::text from learn.certificates c join learn.assignments ca on ca.id = c.assignment_id join learn.courses cc on cc.id = ca.course_id
              where c.user_id = u.id and cc.slug = ${course}
              and not exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id)) as cert_ends,
           ${canSeeResults ? sql`(select count(*)::int from learn.exam_attempts x where x.assignment_id = l.id and x.status = 'submitted')` : sql`null::int`} as attempts,
           ${canSeeResults ? sql`(select x.score_percent::float from learn.exam_attempts x where x.assignment_id = l.id and x.status = 'submitted' order by x.attempt_no desc limit 1)` : sql`null::float`} as last_score
    from core.employees e
    left join core.users u on u.id = e.user_id
    left join core.teams tm on tm.id = e.team_id
    left join latest l on l.user_id = u.id
    left join learn.update_scopes us on us.assignment_id = l.id
    where e.archived_at is null and (u.id is null or u.archived_at is null) and e.status in ('onboarding', 'active', 'probation', 'on_leave')
      ${picked.kind === "client_addon" && picked.clientId
        ? sql`and (l.id is not null or exists (select 1 from core.client_assignments cx where cx.employee_id = e.id and cx.client_id = ${picked.clientId}::uuid and cx.end_date is null))`
        : sql``}
      ${team ? sql`and e.id = any(${uuidArray(team)}::uuid[])` : sql``}
    order by name`)) as unknown as Raw[];

  const all: TrainingRow[] = raw.map((r) => {
    const open = r.status === "assigned" || r.status === "in_progress";
    const state: TrainingState = r.user_id === null ? (r.queued ? "queued" : "no_account") : r.assignment_id === null ? "none" : open ? (r.due_on !== null && r.due_on < today ? "overdue" : "open") : r.status === "passed" ? "passed" : r.status === "expired" ? "expired" : "cancelled";
    return {
      employeeId: r.employee_id,
      userId: r.user_id,
      name: r.name,
      team: r.team_name,
      assignmentId: r.assignment_id,
      track: r.track,
      assignmentReason: r.reason,
      updateModules: r.update_modules,
      dueChanged: r.due_changed,
      state,
      label: LABEL[state],
      dueOn: r.due_on,
      dueText: open && r.due_on ? describeDue(r.due_on, today) : null,
      certificateEndsOn: r.cert_ends,
      attempts: r.attempts,
      lastScore: r.last_score,
    };
  });

  const counts: TrainingCounts = {
    people: all.length,
    passed: all.filter((r) => r.state === "passed").length,
    open: all.filter((r) => r.state === "open" || r.state === "queued").length,
    overdue: all.filter((r) => r.state === "overdue").length,
    none: all.filter((r) => r.state === "none" || r.state === "expired" || r.state === "cancelled" || r.state === "no_account").length,
  };

  const q = filters.q?.toLowerCase();
  const filtered = all.filter((r) => {
    if (filters.state === "none" ? !["none", "expired", "cancelled", "no_account"].includes(r.state) : filters.state === "open" ? !["open", "overdue", "queued"].includes(r.state) : filters.state && r.state !== filters.state) return false;
    if (q && !r.name.toLowerCase().includes(q) && !(r.team ?? "").toLowerCase().includes(q)) return false;
    return true;
  });
  // The people who most need a nudge first: overdue, then not yet, then not assigned, then passed.
  const rank: Record<TrainingState, number> = { overdue: 0, open: 1, queued: 1, none: 2, no_account: 2, expired: 2, cancelled: 3, passed: 4 };
  filtered.sort((a, b) => rank[a.state] - rank[b.state] || (a.dueOn ?? "").localeCompare(b.dueOn ?? "") || a.name.localeCompare(b.name));

  const info = pageInfo(filtered.length, paging.page, paging.pageSize);
  return { rows: filtered.slice(info.offset, info.offset + info.pageSize), counts, info, canSeeResults, canManage, course, ...extra, published };
}

export type AutoAssign = { mode: "all" | "teams" | "paused"; teamIds: string[]; updatedAt: string | null; configured: boolean };

/** How a course is assigned automatically, and the teams to choose from (HR and Super Admin). */
export async function getAutoAssign(courseSlug: string): Promise<{ rule: AutoAssign; teams: { id: string; name: string }[] }> {
  const user = await requireUser();
  await authorize(user, "learn.assign");
  const slug = pickCourse(await listLearnCourses(db), courseSlug).slug;
  const rule = (await db.execute(sql`
    select r.mode, r.team_ids::text[] as team_ids, r.updated_at::text as updated_at
    from learn.assignment_rules r join learn.courses c on c.id = r.course_id where c.slug = ${slug}`)) as unknown as { mode: AutoAssign["mode"]; team_ids: string[]; updated_at: string }[];
  const teams = (await db.execute(sql`select id, name from core.teams where archived_at is null order by name`)) as unknown as { id: string; name: string }[];
  return {
    rule: rule[0] ? { mode: rule[0].mode, teamIds: rule[0].team_ids, updatedAt: rule[0].updated_at, configured: true } : { mode: "all", teamIds: [], updatedAt: null, configured: false },
    teams,
  };
}

/**
 * Read-only reconciliation queue for HR. Essentials assignments were created
 * under the retired policy, while an orphaned valid certificate belongs to an
 * account that is no longer linked to a current employee record. Neither is
 * changed here: each needs an accountable HR decision.
 */
export async function getTrainingRemediationReview(): Promise<TrainingRemediationReview> {
  const user = await requireUser();
  await authorize(user, "learn.assign");
  const today = todayInZone();
  const canRepair = can(user, "people.merge");
  const [essentialsAssignments, orphanedCertificates, repairTargets] = await Promise.all([
    db.execute(sql`
      select a.id as assignment_id,
             coalesce(nullif(btrim(coalesce(e.preferred_name, e.legal_first_name) || ' ' || e.legal_last_name), ''), u.email) as name,
             a.due_on::text as due_on, a.status
      from learn.assignments a
      join learn.courses c on c.id = a.course_id
      join core.users u on u.id = a.user_id
      left join core.employees e on e.user_id = u.id and e.archived_at is null
      where c.slug = 'hipaa' and a.track = 'essentials'
        and (a.status in ('assigned', 'in_progress')
          or (a.status = 'passed' and not exists (select 1 from learn.certificates cert where cert.assignment_id = a.id)))
      order by a.due_on asc, name asc
      limit 50`),
    db.execute(sql`
      select certificate.id as certificate_id, certificate.user_id as source_user_id, certificate.reference, certificate.holder_name,
             course.title as course, certificate.ends_on::text as ends_on, source.email as source_email
      from learn.certificates certificate
      join learn.assignments assignment on assignment.id = certificate.assignment_id
      join learn.courses course on course.id = assignment.course_id
      join core.users source on source.id = certificate.user_id
      where certificate.ends_on >= ${today}::date
        and source.archived_at is null
        and not exists (select 1 from learn.certificate_revocations revoked where revoked.certificate_id = certificate.id)
        and not exists (select 1 from core.employees employee where employee.user_id = certificate.user_id and employee.archived_at is null)
      order by certificate.ends_on desc, certificate.holder_name asc
      limit 50`),
    canRepair
      ? db.execute(sql`
          select e.id as employee_id,
                 coalesce(nullif(btrim(coalesce(e.preferred_name, e.legal_first_name) || ' ' || e.legal_last_name), ''), u.email) as name
          from core.employees e join core.users u on u.id = e.user_id
          where e.archived_at is null and u.archived_at is null
          order by name asc`)
      : Promise.resolve([]),
  ]);
  // The database returns snake_case columns; the page and the forms use these camelCase names.
  type Row = Record<string, string>;
  return {
    essentialsAssignments: (essentialsAssignments as unknown as Row[]).map((r) => ({ assignmentId: r.assignment_id, name: r.name, dueOn: r.due_on, status: r.status })),
    orphanedCertificates: (orphanedCertificates as unknown as Row[]).map((r) => ({
      certificateId: r.certificate_id,
      sourceUserId: r.source_user_id,
      reference: r.reference,
      holderName: r.holder_name,
      course: r.course,
      endsOn: r.ends_on,
      sourceEmail: r.source_email,
    })),
    canRepair,
    repairTargets: (repairTargets as unknown as Row[]).map((r) => ({ employeeId: r.employee_id, name: r.name })),
  };
}

export type TrainingCountsByCourse = { course: string; label: string; overdue: number; expiring: number }[];

/**
 * Counts for the dashboard's needs-attention list: people with overdue training, and certificates ending in the next 30 days that
 * have no renewal yet. HR sees everyone, a lead their downline; nobody else gets anything. Counts only, never names.
 */
export async function getTrainingCounts(): Promise<TrainingCountsByCourse> {
  const user = await requireUser();
  const scope = scopeFor(user, "learn.view_status");
  if (scope !== "all" && scope !== "team") return [];
  const team = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (team && team.length === 0) return [];
  const today = todayInZone();
  const later = new Date(`${today}T00:00:00Z`);
  later.setUTCDate(later.getUTCDate() + 30);
  const limit = later.toISOString().slice(0, 10);
  const people = team ? sql`and u.id in (select e.user_id from core.employees e where e.id = any(${uuidArray(team)}::uuid[]) and e.user_id is not null)` : sql``;

  const out: TrainingCountsByCourse = [];
  for (const c of await listLearnCourses(db)) {
    const rows = (await db.execute(sql`
      select
        (select count(distinct a.user_id)::int from learn.assignments a join learn.courses co on co.id = a.course_id join core.users u on u.id = a.user_id
          where co.slug = ${c.slug} and a.status in ('assigned', 'in_progress') and a.due_on < ${today}::date and u.archived_at is null ${people}) as overdue,
        (select count(*)::int from (
           select distinct on (cc.user_id) cc.user_id, cc.ends_on
           from learn.certificates cc join learn.assignments a on a.id = cc.assignment_id join learn.courses co on co.id = a.course_id join core.users u on u.id = cc.user_id
           where co.slug = ${c.slug} and u.archived_at is null ${people}
             and not exists (select 1 from learn.certificate_revocations r where r.certificate_id = cc.id)
           order by cc.user_id, cc.ends_on desc) latest
         where latest.ends_on between ${today}::date and ${limit}::date) as expiring`)) as unknown as { overdue: number; expiring: number }[];
    out.push({ course: c.slug, label: c.label, overdue: rows[0]?.overdue ?? 0, expiring: rows[0]?.expiring ?? 0 });
  }
  return out;
}

/** Clients to choose from for the evidence report (active, by name). HR and Super Admin. */
export async function listEvidenceClients(): Promise<{ id: string; name: string; handlesPhi: boolean }[]> {
  const user = await requireUser();
  await authorize(user, "learn.export_evidence");
  const rows = (await db.execute(sql`select id, name, handles_phi from core.clients where archived_at is null and is_active order by name`)) as unknown as { id: string; name: string; handles_phi: boolean }[];
  return rows.map((r) => ({ id: r.id, name: r.name, handlesPhi: r.handles_phi }));
}

/**
 * The facts behind the "instructions for learners" message of one course: how long it takes, the exam rules and how long a
 * certificate lasts, read from the live version. Null when the course has no live version yet. Needs `learn.view_status`.
 */
export async function getInstructionFacts(courseSlug: string): Promise<InstructionFacts | null> {
  const user = await requireUser();
  const scope = scopeFor(user, "learn.view_status");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("learn.view_status");
  const courses = await listLearnCourses(db);
  const info = pickCourse(courses, courseSlug);
  const [row] = (await db.execute(sql`
    select v.exam_config, c.requires_exam, cl.name as client_name,
      (select max(t.total) from (select sum(m.estimated_minutes) as total from learn.version_modules m, unnest(m.tracks) tr where m.version_id = v.id group by tr) t)::int as minutes
    from learn.course_versions v
    join learn.courses c on c.id = v.course_id
    left join core.clients cl on cl.id = c.client_id
    where c.slug = ${info.slug} and v.status = 'published' limit 1`)) as unknown as {
    exam_config: { passPercent?: number; maxTries?: number; waitMinutesAfterFail?: number; renewalMonths?: number; tracks?: Record<string, { questions?: number }> };
    requires_exam: boolean;
    client_name: string | null;
    minutes: number | null;
  }[];
  if (!row) return null;
  const questions = Math.max(0, ...Object.values(row.exam_config.tracks ?? {}).map((t) => t.questions ?? 0));
  return {
    slug: info.slug,
    kind: info.kind,
    label: info.label,
    noun: info.noun,
    clientName: row.client_name,
    minutes: row.minutes,
    exam: row.requires_exam && questions > 0 ? { questions, passPercent: row.exam_config.passPercent ?? 85, maxTries: row.exam_config.maxTries ?? 3, waitMinutes: row.exam_config.waitMinutesAfterFail ?? 60 } : null,
    renewalMonths: row.exam_config.renewalMonths ?? null,
  };
}
