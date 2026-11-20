import "server-only";
import { sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { reportName } from "@/modules/org/service";

// What HR sees about hours that come from Jibble: who clocks there, and which Jibble projects and activities mean which client.

export type ClockSourceOverview = {
  /** People matched to a Jibble account (only they can use Jibble as their clock), with where their hours come from. */
  people: { employeeId: string; name: string; team: string | null; source: "elevate" | "jibble" }[];
  maps: { id: string; kind: "project" | "activity"; jibbleId: string; clientId: string; clientName: string }[];
  /** Project and activity ids seen on entries that no client is mapped to yet. */
  unmapped: { kind: "project" | "activity"; jibbleId: string; lastSeenAt: string; example: string | null }[];
  clients: { id: string; name: string }[];
  /** Matched people on the ELEVATE clock who have not used it for 14 days and are clocked out: the likely "Jibble alone" contractors. */
  jibbleAlone: { employeeId: string; name: string; team: string | null; lastElevate: string | null }[];
};

export async function getClockSourceOverview(): Promise<ClockSourceOverview> {
  const user = await requireUser();
  await authorize(user, "jibble.manage");

  const people = (await db.execute(sql`
    select e.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, t.name as team,
      coalesce((select s.source from time.clock_source s where s.employee_id = e.id order by s.set_at desc, s.id desc limit 1), 'elevate') as source
    from core.employees e join time.jibble_people p on p.employee_id = e.id left join core.teams t on t.id = e.team_id
    where e.archived_at is null and e.status <> 'separated' order by e.legal_last_name, e.legal_first_name limit 1000`)) as unknown as { id: string; first: string; last: string; preferred: string | null; team: string | null; source: string }[];
  const maps = (await db.execute(sql`
    select m.id, m.kind, m.jibble_id, m.client_id, c.name as client_name from time.jibble_client_map m join core.clients c on c.id = m.client_id order by m.kind, c.name, m.jibble_id`)) as unknown as { id: string; kind: "project" | "activity"; jibble_id: string; client_id: string; client_name: string }[];
  const unmapped = (await db.execute(sql`
    select u.kind, u.jibble_id, u.last_seen_at, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from time.jibble_unmapped_ids u left join core.employees e on e.id = u.example_employee_id order by u.last_seen_at desc limit 200`)) as unknown as { kind: "project" | "activity"; jibble_id: string; last_seen_at: Date; first: string | null; last: string | null; preferred: string | null }[];
  const clients = (await db.execute(sql`select id, name from core.clients where archived_at is null order by name`)) as unknown as { id: string; name: string }[];
  const alone = (await db.execute(sql`
    select e.id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred, t.name as team,
      (select max(c.occurred_at) from time.v_clock_events c where c.employee_id = e.id and c.source <> 'jibble') as last_elevate
    from core.employees e join time.jibble_people p on p.employee_id = e.id left join core.teams t on t.id = e.team_id
    where e.archived_at is null and e.status <> 'separated'
      and coalesce((select s.source from time.clock_source s where s.employee_id = e.id order by s.set_at desc, s.id desc limit 1), 'elevate') = 'elevate'
      and not exists (select 1 from time.v_clock_events c where c.employee_id = e.id and c.source <> 'jibble' and c.occurred_at > now() - interval '14 days')
      and coalesce((select c.type from time.v_clock_events c where c.employee_id = e.id order by c.occurred_at desc, c.created_at desc limit 1), 'clock_out') = 'clock_out'
    order by e.legal_last_name, e.legal_first_name limit 500`)) as unknown as { id: string; first: string; last: string; preferred: string | null; team: string | null; last_elevate: Date | null }[];

  return {
    people: people.map((p) => ({ employeeId: p.id, name: reportName({ first: p.first, last: p.last, preferred: p.preferred }), team: p.team, source: p.source === "jibble" ? "jibble" : "elevate" })),
    maps: maps.map((m) => ({ id: m.id, kind: m.kind, jibbleId: m.jibble_id, clientId: m.client_id, clientName: m.client_name })),
    unmapped: unmapped.map((u) => ({ kind: u.kind, jibbleId: u.jibble_id, lastSeenAt: new Date(u.last_seen_at).toISOString(), example: u.first && u.last ? reportName({ first: u.first, last: u.last, preferred: u.preferred }) : null })),
    clients,
    jibbleAlone: alone.map((a) => ({ employeeId: a.id, name: reportName({ first: a.first, last: a.last, preferred: a.preferred }), team: a.team, lastElevate: a.last_elevate ? new Date(a.last_elevate).toISOString() : null })),
  };
}
