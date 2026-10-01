import "server-only";
import { sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { monitoringPolicyPublished } from "@/modules/attendance/service";
import { reportName } from "@/modules/org/service";
import { breakMode, getJibbleClient, mirrorSendsEnabled, mismatchToleranceMinutes } from "./client";
import type { BreakMode } from "./mirror-rules";

export type JibblePersonRow = { employeeId: string; name: string; email: string | null; team: string | null; jibblePersonId: string | null; matchedBy: string | null };
export type LogRow = { id: string; name: string; action: string; status: string; attempts: number; lastError: string | null; createdAt: string; sentAt: string | null; source: string; fallback: boolean };

export type JibbleOverview = {
  configured: boolean;
  /** mirror = ELEVATE tells Jibble when to run; fallback = people clock into both and ELEVATE only compares. */
  mode: "mirror" | "fallback";
  breakMode: BreakMode;
  toleranceMinutes: number;
  monitoringPublished: boolean;
  teamsOn: number;
  /** HR's pause switch is on: nothing is being sent. */
  paused: boolean;
  /** Minutes the oldest waiting call has waited, or null when nothing waits. */
  oldestQueuedMinutes: number | null;
  counts: { queued: number; failed: number; sent24h: number };
  people: JibblePersonRow[];
  log: LogRow[];
};

/** The Jibble page: connection state, who is matched, and the latest calls. HR only. */
export async function getJibbleOverview(): Promise<JibbleOverview> {
  const user = await requireUser();
  await authorize(user, "jibble.manage");

  const people = (await db.execute(sql`
    select e.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, e.work_email as email, t.name as team, p.jibble_person_id, p.matched_by
    from core.employees e left join core.teams t on t.id = e.team_id left join time.jibble_people p on p.employee_id = e.id
    where e.archived_at is null and e.status <> 'separated' order by (p.jibble_person_id is not null), e.legal_last_name, e.legal_first_name limit 1000`)) as unknown as { id: string; first: string; last: string; preferred: string | null; email: string | null; team: string | null; jibble_person_id: string | null; matched_by: string | null }[];

  const log = (await db.execute(sql`
    select l.id, l.action, l.status, l.attempts, l.last_error, l.created_at, l.sent_at, l.source, l.fallback, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.jibble_link_log l join core.employees e on e.id = l.employee_id order by l.created_at desc limit 100`)) as unknown as { id: string; action: string; status: string; attempts: number; last_error: string | null; created_at: string | Date; sent_at: string | Date | null; source: string; fallback: boolean; first: string; last: string; preferred: string | null }[];

  const [counts] = (await db.execute(sql`
    select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'failed')::int as failed,
           count(*) filter (where status = 'sent' and sent_at > now() - interval '24 hours')::int as sent24h from time.jibble_link_log`)) as unknown as { queued: number; failed: number; sent24h: number }[];
  const [teams] = (await db.execute(sql`select count(*)::int as n from time.clock_rules where jibble_mirror`)) as unknown as { n: number }[];
  const [state] = (await db.execute(sql`select (select paused from time.jibble_settings where id = 1) as paused, (select extract(epoch from now() - min(created_at)) / 60 from time.jibble_link_log where status = 'queued')::float8 as oldest`)) as unknown as { paused: boolean | null; oldest: number | null }[];

  return {
    configured: getJibbleClient() !== null,
    mode: mirrorSendsEnabled() ? "mirror" : "fallback",
    breakMode: breakMode(),
    toleranceMinutes: mismatchToleranceMinutes(),
    monitoringPublished: await monitoringPolicyPublished(db),
    teamsOn: teams.n,
    paused: Boolean(state?.paused),
    oldestQueuedMinutes: state?.oldest === null || state?.oldest === undefined ? null : Math.round(Number(state.oldest)),
    counts,
    people: people.map((p) => ({ employeeId: p.id, name: reportName({ first: p.first, last: p.last, preferred: p.preferred }), email: p.email, team: p.team, jibblePersonId: p.jibble_person_id, matchedBy: p.matched_by })),
    log: log.map((l) => ({ id: l.id, name: reportName({ first: l.first, last: l.last, preferred: l.preferred }), action: l.action, status: l.status, attempts: l.attempts, lastError: l.last_error, createdAt: new Date(l.created_at).toISOString(), sentAt: l.sent_at ? new Date(l.sent_at).toISOString() : null, source: l.source, fallback: l.fallback })),
  };
}
