import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { replayClock, type ClockType } from "@/modules/attendance/clock";
import { assignedClients } from "@/modules/attendance/extra-hours-service";
import { rebuildAttendanceDays } from "@/modules/attendance/jobs";
import { clockEventVoids, clockEvents } from "@/modules/attendance/schema";
import { lockEmployeeClock } from "@/modules/attendance/service";
import { getJibbleClient, sendsAllowed } from "./client";
import { JibbleError, type JibbleClient } from "./http-client";
import { desiredEvents, planImport, type ClientMapping, type ImportedEvent, type JibbleTimeEntry, type Unmapped } from "./import-rules";
import { alertHr, jibblePaused } from "./jobs";

// Hours of people who clock in Jibble (time.clock_source = 'jibble'): their Jibble time entries become ELEVATE clock events (source 'jibble').
// ELEVATE stays the one ledger that hours review, approval and the export read. Only entry times and project and activity ids are read;
// never screenshots, location or activity. Runs every 30 minutes and re-reads the last few days, so an entry edited or deleted in Jibble is
// followed (the old event is voided, never edited). It never runs while HR's pause switch is on, and outside production only for the
// Jibble people named in JIBBLE_TEST_PERSON_IDS.

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 3;
export const MAX_IMPORT_DAYS = 14;
/** Voids made by the import have no signed-in person: this stands for "the system". */
const SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
const PARALLEL = 3;

export type ImportRun = { people: number; imported: number; voided: number; failed: number; keptBecauseEmpty: number; skipped: "not_configured" | "paused" | null };

type Person = { employee_id: string; jibble_person_id: string };

async function loadMapping(): Promise<{ activity: Map<string, string>; project: Map<string, string> }> {
  const rows = (await db.execute(sql`select kind, jibble_id, client_id from time.jibble_client_map`)) as unknown as { kind: string; jibble_id: string; client_id: string }[];
  const activity = new Map<string, string>();
  const project = new Map<string, string>();
  for (const r of rows) (r.kind === "activity" ? activity : project).set(r.jibble_id, r.client_id);
  return { activity, project };
}

/** Where the person was just before the window: replays what came before it (an open session carries its client over). */
async function stateBefore(executor: Pick<typeof db, "execute">, employeeId: string, fromMs: number) {
  const rows = (await executor.execute(sql`
    select id, type, (extract(epoch from occurred_at) * 1000)::float8 as at, (extract(epoch from created_at) * 1000)::float8 as created_ms, planned_break_minutes as planned, client_id
    from time.v_clock_events where employee_id = ${employeeId} and occurred_at < to_timestamp(${fromMs / 1000}) order by occurred_at desc, created_at desc limit 300`)) as unknown as {
    id: string; type: ClockType; at: number; created_ms: number; planned: number | null; client_id: string | null;
  }[];
  const replay = replayClock(rows.reverse().map((r) => ({ id: r.id, type: r.type, at: Number(r.at), createdAtMs: Number(r.created_ms), plannedBreakMinutes: r.planned, clientId: r.client_id })));
  const open = replay.sessions[replay.sessions.length - 1];
  const live = replay.state !== "out" && open && open.endAt === null ? open : null;
  return { state: replay.state, clientId: live ? (live.switches[live.switches.length - 1]?.clientId ?? live.clientId) : null };
}

/** Imports one person's entries from the last `days` days. Returns what changed. */
async function importPerson(client: JibbleClient, person: Person, days: number, mapping: { activity: Map<string, string>; project: Map<string, string> }, now: Date) {
  const fromMs = now.getTime() - days * DAY_MS;
  const rows = await client.listTimeEntries!(person.jibble_person_id, new Date(fromMs).toISOString(), new Date(now.getTime() + 5 * 60_000).toISOString());
  const entries: JibbleTimeEntry[] = rows.map((r) => ({ id: r.id, type: r.type, timeMs: Date.parse(r.time), projectId: r.projectId, activityId: r.activityId }));
  const assigned = await assignedClients(db, person.employee_id);
  const clientMapping: ClientMapping = { activity: mapping.activity, project: mapping.project, only: assigned.length === 1 ? assigned[0].id : null };

  let imported = 0;
  let voided = 0;
  let keptBecauseEmpty = 0;
  let unmapped: Unmapped[] = [];
  await db.transaction(async (tx) => {
    await lockEmployeeClock(tx, person.employee_id);
    const start = await stateBefore(tx, person.employee_id, fromMs);
    const existing = ((await tx.execute(sql`
      select e.id, e.jibble_entry_id as entry_id, e.type, (extract(epoch from e.occurred_at) * 1000)::float8 as at, e.client_id,
        exists (select 1 from time.clock_event_voids v where v.event_id = e.id) as voided
      from time.clock_events e where e.employee_id = ${person.employee_id} and e.source = 'jibble' and e.occurred_at >= to_timestamp(${fromMs / 1000})`)) as unknown as {
      id: string; entry_id: string; type: string; at: number; client_id: string | null; voided: boolean;
    }[]).map((r): ImportedEvent => ({ id: r.id, entryId: r.entry_id, type: r.type, atMs: Number(r.at), clientId: r.client_id, voided: r.voided }));

    const desired = desiredEvents(entries, start, clientMapping);
    unmapped = desired.unmapped;
    const plan = planImport(desired.events, existing);

    // Safety: an empty answer while hours were already imported is more likely a Jibble hiccup than every entry being deleted.
    // Keep what we have, and tell HR once.
    const live = existing.filter((e) => !e.voided);
    if (entries.length === 0 && live.length > 0) {
      keptBecauseEmpty = live.length;
      plan.toVoid = [];
    }

    for (const id of plan.toVoid) await tx.insert(clockEventVoids).values({ eventId: id, reason: "Removed or changed in Jibble", voidedBy: SYSTEM_USER });
    voided = plan.toVoid.length;
    for (const e of plan.toInsert) {
      await tx.insert(clockEvents).values({
        employeeId: person.employee_id,
        type: e.type,
        occurredAt: new Date(e.atMs),
        source: "jibble",
        jibbleEntryId: e.entryId,
        clientId: e.clientId,
        createdAt: sql`clock_timestamp()` as unknown as Date, // distinct moments, so two events of one entry (end of break, then clock-out) stay in order
      });
    }
    imported = plan.toInsert.length;

    for (const u of unmapped) {
      await tx.execute(sql`insert into time.jibble_unmapped_ids (kind, jibble_id, last_seen_at, example_employee_id) values (${u.kind}, ${u.id}, now(), ${person.employee_id})
        on conflict (kind, jibble_id) do update set last_seen_at = now(), example_employee_id = excluded.example_employee_id`);
    }
    if (imported > 0 || voided > 0) {
      await writeAudit({ action: "jibble.import", targetType: "employee", targetId: person.employee_id, after: { imported, voided, days } }, tx);
    }
  });
  if (imported > 0 || voided > 0) {
    // The saved events stand even if the refresh fails: the nightly rebuild and approving the week rebuild again.
    await rebuildAttendanceDays(now, days + 2, person.employee_id).catch(() => undefined);
  }
  return { imported, voided, keptBecauseEmpty };
}

/**
 * Imports Jibble hours for everyone whose source is Jibble (or for one person, for the last `days` days). Nothing happens when Jibble is not
 * configured or HR paused the link. Per person: a Jibble failure is counted and the others carry on.
 */
export async function runJibbleImport(options: { days?: number; employeeId?: string; now?: Date; client?: JibbleClient | null } = {}): Promise<ImportRun> {
  const run: ImportRun = { people: 0, imported: 0, voided: 0, failed: 0, keptBecauseEmpty: 0, skipped: null };
  const client = options.client === undefined ? getJibbleClient() : options.client;
  if (!client?.listTimeEntries) return { ...run, skipped: "not_configured" };
  if (await jibblePaused()) return { ...run, skipped: "paused" };
  const days = Math.min(MAX_IMPORT_DAYS, Math.max(1, options.days ?? DEFAULT_DAYS));
  const now = options.now ?? new Date();

  const filter = options.employeeId ? sql`and e.id = ${options.employeeId}` : sql``;
  const people = ((await db.execute(sql`
    select e.id as employee_id, p.jibble_person_id from core.employees e join time.jibble_people p on p.employee_id = e.id
    where e.archived_at is null and e.status <> 'separated' ${filter}
      and (select s.source from time.clock_source s where s.employee_id = e.id order by s.set_at desc, s.id desc limit 1) = 'jibble'`)) as unknown as Person[]).filter((p) => sendsAllowed(p.jibble_person_id));
  if (people.length === 0) return run;

  const mapping = await loadMapping();
  let refused = false;
  for (let i = 0; i < people.length; i += PARALLEL) {
    await Promise.all(
      people.slice(i, i + PARALLEL).map(async (person) => {
        try {
          const r = await importPerson(client, person, days, mapping, now);
          run.people += 1;
          run.imported += r.imported;
          run.voided += r.voided;
          run.keptBecauseEmpty += r.keptBecauseEmpty;
        } catch (error) {
          run.failed += 1;
          if (error instanceof JibbleError && (error.status === 401 || error.status === 403)) refused = true;
          console.error("jibble import failed:", error instanceof Error ? error.name : "unknown error");
        }
      }),
    );
  }
  if (refused) await alertHr("jibble.import_refused", "Jibble refused the hours import", "Jibble did not accept the access token, so hours of people who clock in Jibble are not being imported. Check the connection on the Jibble page.", 12);
  if (run.keptBecauseEmpty > 0) await alertHr("jibble.import_empty", "Jibble returned no entries for someone who had hours", "Their imported hours were kept. If entries were really deleted in Jibble, fix their hours with a correction.", 24);
  return run;
}
