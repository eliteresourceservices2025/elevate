import "server-only";
import { sql } from "drizzle-orm";
import { ForbiddenError, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pageInfo, type PageInfo } from "@/lib/pagination";
import { downlineEmployeeIds, todayInZone } from "@/modules/org/service";
import { uuidArray } from "./jobs";
import { describeDue } from "./rules";
import { trainingFilterSchema } from "./validators";

// Training status for HR and for leads. A lead sees status only (passed, not yet, overdue); scores and attempts are HR's. The
// course is the HIPAA course; each person's NEWEST assignment decides what is shown.

export type TrainingState = "none" | "open" | "overdue" | "passed" | "expired" | "cancelled";

export type TrainingRow = {
  employeeId: string;
  userId: string;
  name: string;
  team: string | null;
  assignmentId: string | null;
  track: string | null;
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

const LABEL: Record<TrainingState, string> = { none: "Not assigned", open: "Not yet", overdue: "Overdue", passed: "Passed", expired: "Expired", cancelled: "Closed" };

type Raw = {
  employee_id: string;
  user_id: string;
  name: string;
  team_name: string | null;
  assignment_id: string | null;
  track: string | null;
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
export async function listTrainingStatus(rawFilters: unknown, paging: { page: number; pageSize: number }): Promise<{ rows: TrainingRow[]; counts: TrainingCounts; info: PageInfo; canSeeResults: boolean; canManage: boolean }> {
  const user = await requireUser();
  // Team scope needs the resource's reporting chain, so a list checks the scope itself and narrows the rows to the viewer's downline.
  const scope = scopeFor(user, "learn.view_status");
  if (scope !== "all" && scope !== "team") throw new ForbiddenError("learn.view_status");
  const canSeeResults = scopeFor(user, "learn.view_results") === "all";
  const canManage = scopeFor(user, "learn.assign") === "all";
  const f = trainingFilterSchema.safeParse(rawFilters ?? {});
  const filters = f.success ? f.data : {};
  const today = todayInZone();

  const team = scope === "team" ? await downlineEmployeeIds(db, user.id) : null;
  if (team && team.length === 0) return { rows: [], counts: { people: 0, passed: 0, open: 0, overdue: 0, none: 0 }, info: pageInfo(0, paging.page, paging.pageSize), canSeeResults, canManage };

  const raw = (await db.execute(sql`
    with latest as (
      select distinct on (a.user_id) a.* from learn.assignments a join learn.courses c on c.id = a.course_id
      where c.slug = 'hipaa' order by a.user_id, a.assigned_at desc
    )
    select e.id as employee_id, u.id as user_id,
           coalesce(nullif(btrim(coalesce(e.preferred_name, e.legal_first_name) || ' ' || e.legal_last_name), ''), u.email) as name,
           tm.name as team_name, l.id as assignment_id, l.track, l.status, l.due_on::text as due_on,
           (select max(c.ends_on)::text from learn.certificates c where c.user_id = u.id
              and not exists (select 1 from learn.certificate_revocations r where r.certificate_id = c.id)) as cert_ends,
           ${canSeeResults ? sql`(select count(*)::int from learn.exam_attempts x where x.assignment_id = l.id and x.status = 'submitted')` : sql`null::int`} as attempts,
           ${canSeeResults ? sql`(select x.score_percent::float from learn.exam_attempts x where x.assignment_id = l.id and x.status = 'submitted' order by x.attempt_no desc limit 1)` : sql`null::float`} as last_score
    from core.employees e
    join core.users u on u.id = e.user_id
    left join core.teams tm on tm.id = e.team_id
    left join latest l on l.user_id = u.id
    where e.archived_at is null and u.archived_at is null and e.status in ('onboarding', 'active', 'probation', 'on_leave')
      ${team ? sql`and e.id = any(${uuidArray(team)}::uuid[])` : sql``}
    order by name`)) as unknown as Raw[];

  const all: TrainingRow[] = raw.map((r) => {
    const open = r.status === "assigned" || r.status === "in_progress";
    const state: TrainingState = r.assignment_id === null ? "none" : open ? (r.due_on !== null && r.due_on < today ? "overdue" : "open") : r.status === "passed" ? "passed" : r.status === "expired" ? "expired" : "cancelled";
    return {
      employeeId: r.employee_id,
      userId: r.user_id,
      name: r.name,
      team: r.team_name,
      assignmentId: r.assignment_id,
      track: r.track,
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
    open: all.filter((r) => r.state === "open").length,
    overdue: all.filter((r) => r.state === "overdue").length,
    none: all.filter((r) => r.state === "none" || r.state === "expired" || r.state === "cancelled").length,
  };

  const q = filters.q?.toLowerCase();
  const filtered = all.filter((r) => {
    if (filters.state === "none" ? !["none", "expired", "cancelled"].includes(r.state) : filters.state === "open" ? r.state !== "open" && r.state !== "overdue" : filters.state && r.state !== filters.state) return false;
    if (q && !r.name.toLowerCase().includes(q) && !(r.team ?? "").toLowerCase().includes(q)) return false;
    return true;
  });
  // The people who most need a nudge first: overdue, then not yet, then not assigned, then passed.
  const rank: Record<TrainingState, number> = { overdue: 0, open: 1, none: 2, expired: 2, cancelled: 3, passed: 4 };
  filtered.sort((a, b) => rank[a.state] - rank[b.state] || (a.dueOn ?? "").localeCompare(b.dueOn ?? "") || a.name.localeCompare(b.name));

  const info = pageInfo(filtered.length, paging.page, paging.pageSize);
  return { rows: filtered.slice(info.offset, info.offset + info.pageSize), counts, info, canSeeResults, canManage };
}
