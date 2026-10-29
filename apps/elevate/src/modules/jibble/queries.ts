import "server-only";
import { sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveTimeZone } from "@/lib/time";
import { pageInfo } from "@/lib/pagination";
import { monitoringPolicyPublished } from "@/modules/attendance/service";
import { reportName } from "@/modules/org/service";
import { breakMode, getJibbleClient, mirrorSendsEnabled, mismatchToleranceMinutes, selfTestEmails } from "./client";
import { SLOW_SEND_MINUTES } from "./mirror-rules";
import type { BreakMode } from "./mirror-rules";

export type JibblePersonRow = { employeeId: string; name: string; email: string | null; team: string | null; jibblePersonId: string | null; matchedBy: string | null };
export type LogRow = { id: string; name: string; action: string; status: string; attempts: number; lastError: string | null; createdAt: string; sentAt: string | null; source: string; fallback: boolean; reviewed: boolean };
export type ShiftRow = { id: string; name: string; clockIn: string; clockOut: string | null };
export type ExceptionRow = { id: string; name: string; category: "operation" | "mismatch"; detail: string; at: string; recoverable: boolean };

export type JibbleOverview = {
  /** The viewer's attendance preference, falling back to the company timezone. */
  viewerTimeZone: string;
  reviewEnabled: boolean;
  exceptions: { rows: ExceptionRow[]; total: number; page: number; pages: number; from: number; to: number };
  configured: boolean;
  /** mirror = ELEVATE tells Jibble when to run; fallback = people clock into both and ELEVATE only compares. */
  mode: "mirror" | "fallback";
  breakMode: BreakMode;
  toleranceMinutes: number;
  monitoringPublished: boolean;
  /** How many people are listed in JIBBLE_SELF_TEST_EMAILS (testing on their own account, without the policy). Normally 0. */
  selfTestPeople: number;
  /** Calls from the last 6 hours that went through on the first try, and how many of them waited over 3 minutes. */
  sendDelay: { slow: number; total: number };
  teamsOn: number;
  /** HR's pause switch is on: nothing is being sent. */
  paused: boolean;
  /** Minutes the oldest waiting call has waited, or null when nothing waits. */
  oldestQueuedMinutes: number | null;
  counts: { queued: number; failed: number; sent24h: number };
  people: JibblePersonRow[];
  log: LogRow[];
  callHistory: { search: string; status: string; page: number; pages: number; total: number; from: number; to: number };
  shifts: ShiftRow[];
};

/** The Jibble page: connection state, who is matched, and the latest calls. HR only. */
export async function getJibbleOverview(filters: { search?: string; status?: string; page?: string; exceptionPage?: string } = {}): Promise<JibbleOverview> {
  const user = await requireUser();
  await authorize(user, "jibble.manage");

  const [viewer] = (await db.execute(sql`
    select p.time_zone from core.employees e left join time.clock_prefs p on p.employee_id = e.id
    where e.user_id = ${user.id} and e.archived_at is null and e.status <> 'separated' limit 1`)) as unknown as { time_zone: string | null }[];

  const people = (await db.execute(sql`
    select e.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, e.work_email as email, t.name as team, p.jibble_person_id, p.matched_by
    from core.employees e left join core.teams t on t.id = e.team_id left join time.jibble_people p on p.employee_id = e.id
    where e.archived_at is null and e.status <> 'separated' order by (p.jibble_person_id is not null), e.legal_last_name, e.legal_first_name limit 1000`)) as unknown as { id: string; first: string; last: string; preferred: string | null; email: string | null; team: string | null; jibble_person_id: string | null; matched_by: string | null }[];

  const search = typeof filters.search === "string" ? filters.search.trim().slice(0, 100) : "";
  const status = ["queued", "sent", "failed", "skipped"].includes(filters.status ?? "") ? filters.status! : "all";
  const pageNumber = Number(filters.page);
  const requestedPage = Number.isSafeInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
  const searchPattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
  const filter = sql`${status === "all" ? sql`true` : sql`l.status = ${status}`} and ${search ? sql`(concat_ws(' ', coalesce(nullif(trim(e.preferred_name), ''), e.legal_first_name), e.legal_last_name) ilike ${searchPattern} escape '\\' or concat_ws(' ', e.legal_first_name, e.legal_last_name) ilike ${searchPattern} escape '\\')` : sql`true`}`;
  const [logCount] = (await db.execute(sql`select count(*)::int as total from time.jibble_link_log l join core.employees e on e.id = l.employee_id where ${filter}`)) as unknown as { total: number }[];
  const callPage = pageInfo(logCount?.total ?? 0, requestedPage, 25);
  const reviewEnabled = process.env.JIBBLE_COORDINATION_ENABLED === "true";
  const exceptionNumber = Number(filters.exceptionPage);
  const exceptionRequested = Number.isSafeInteger(exceptionNumber) && exceptionNumber > 0 ? exceptionNumber : 1;
  let exceptionTotal = 0;
  let exceptionRows: ExceptionRow[] = [];
  if (reviewEnabled) {
    const [count] = (await db.execute(sql`select ((select count(*) from time.jibble_operation_guard) + (select count(*) from time.jibble_mismatches where resolved_at is null))::int as total`)) as unknown as { total: number }[];
    exceptionTotal = count?.total ?? 0;
    const page = pageInfo(exceptionTotal, exceptionRequested, 25);
    const items = (await db.execute(sql`
      select x.id, x.category, x.detail, x.at, x.recoverable, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
      from (
        select employee_id as id, employee_id, 'operation'::text as category, phase as detail, updated_at as at,
          coalesce(phase = 'uncertain' and request_id is not null and log_id is not null and jibble_person_id is not null and action in ('In','Out'), false) as recoverable from time.jibble_operation_guard
        union all
        select id, employee_id, 'mismatch'::text as category, kind as detail, last_seen_at as at, false as recoverable from time.jibble_mismatches where resolved_at is null
      ) x join core.employees e on e.id = x.employee_id
      order by x.at desc, x.category, x.id limit ${page.pageSize} offset ${page.offset}`)) as unknown as { id: string; category: "operation" | "mismatch"; detail: string; at: string | Date; recoverable: boolean; first: string; last: string; preferred: string | null }[];
    exceptionRows = items.map((item) => ({ id: item.id, category: item.category, detail: item.detail, at: new Date(item.at).toISOString(), name: reportName(item), recoverable: item.recoverable }));
  }
  const exceptionPage = pageInfo(exceptionTotal, exceptionRequested, 25);
  const log = (await db.execute(sql`
    select l.id, l.action, l.status, l.attempts, l.last_error, l.created_at, l.sent_at, l.source, l.fallback, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred,
      ${reviewEnabled ? sql`exists(select 1 from time.jibble_call_reviews r where r.log_id = l.id)` : sql`false`} as reviewed
    from time.jibble_link_log l join core.employees e on e.id = l.employee_id where ${filter}
    order by l.created_at desc, l.id desc limit ${callPage.pageSize} offset ${callPage.offset}`)) as unknown as { id: string; action: string; status: string; attempts: number; last_error: string | null; created_at: string | Date; sent_at: string | Date | null; source: string; fallback: boolean; reviewed: boolean; first: string; last: string; preferred: string | null }[];

  // Pair actual ELEVATE shift events, not Jibble calls (which can also represent breaks or repairs).
  const shifts = (await db.execute(sql`
    with events as (
      select c.id, c.employee_id, c.type, c.occurred_at,
        lead(c.type) over (partition by c.employee_id order by c.occurred_at, c.created_at, c.id) as next_type,
        lead(c.occurred_at) over (partition by c.employee_id order by c.occurred_at, c.created_at, c.id) as next_at,
        lead(c.id) over (partition by c.employee_id order by c.occurred_at, c.created_at, c.id) as next_id
      from time.v_clock_events c where c.type in ('clock_in', 'clock_out')
    )
    select ev.id, ev.occurred_at as clock_in, case when ev.next_type = 'clock_out' then ev.next_at end as clock_out,
      e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from events ev join core.employees e on e.id = ev.employee_id
    where ev.type = 'clock_in' and exists (select 1 from time.jibble_link_log l where l.event_id = ev.id or (ev.next_type = 'clock_out' and l.event_id = ev.next_id))
    order by ev.occurred_at desc limit 100`)) as unknown as { id: string; clock_in: string | Date; clock_out: string | Date | null; first: string; last: string; preferred: string | null }[];

  const [counts] = (await db.execute(sql`
    select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'failed')::int as failed,
           count(*) filter (where status = 'sent' and sent_at > now() - interval '24 hours')::int as sent24h from time.jibble_link_log`)) as unknown as { queued: number; failed: number; sent24h: number }[];
  const [delay] = (await db.execute(sql`
    select count(*) filter (where sent_at - created_at > interval '${sql.raw(String(SLOW_SEND_MINUTES))} minutes')::int as slow, count(*)::int as total
    from time.jibble_link_log where status = 'sent' and attempts <= 1 and source <> 'repair' and sent_at > now() - interval '6 hours'`)) as unknown as { slow: number; total: number }[];
  const [teams] = (await db.execute(sql`select count(*)::int as n from time.clock_rules where jibble_mirror`)) as unknown as { n: number }[];
  const [state] = (await db.execute(sql`select (select paused from time.jibble_settings where id = 1) as paused, (select extract(epoch from now() - min(created_at)) / 60 from time.jibble_link_log where status = 'queued')::float8 as oldest`)) as unknown as { paused: boolean | null; oldest: number | null }[];

  return {
    viewerTimeZone: resolveTimeZone(viewer?.time_zone),
    reviewEnabled,
    exceptions: { rows: exceptionRows, total: exceptionTotal, page: exceptionPage.page, pages: exceptionPage.pages, from: exceptionPage.from, to: exceptionPage.to },
    configured: getJibbleClient() !== null,
    mode: mirrorSendsEnabled() ? "mirror" : "fallback",
    breakMode: breakMode(),
    toleranceMinutes: mismatchToleranceMinutes(),
    monitoringPublished: await monitoringPolicyPublished(db),
    selfTestPeople: selfTestEmails().length,
    sendDelay: { slow: delay?.slow ?? 0, total: delay?.total ?? 0 },
    teamsOn: teams.n,
    paused: Boolean(state?.paused),
    oldestQueuedMinutes: state?.oldest === null || state?.oldest === undefined ? null : Math.round(Number(state.oldest)),
    counts,
    callHistory: { search, status, page: callPage.page, pages: callPage.pages, total: callPage.total, from: callPage.from, to: callPage.to },
    people: people.map((p) => ({ employeeId: p.id, name: reportName({ first: p.first, last: p.last, preferred: p.preferred }), email: p.email, team: p.team, jibblePersonId: p.jibble_person_id, matchedBy: p.matched_by })),
    log: log.map((l) => ({ id: l.id, name: reportName({ first: l.first, last: l.last, preferred: l.preferred }), action: l.action, status: l.status, attempts: l.attempts, lastError: l.last_error, createdAt: new Date(l.created_at).toISOString(), sentAt: l.sent_at ? new Date(l.sent_at).toISOString() : null, source: l.source, fallback: l.fallback, reviewed: l.reviewed })),
    shifts: shifts.map((s) => ({ id: s.id, name: reportName({ first: s.first, last: s.last, preferred: s.preferred }), clockIn: new Date(s.clock_in).toISOString(), clockOut: s.clock_out ? new Date(s.clock_out).toISOString() : null })),
  };
}
