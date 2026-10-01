import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { formatInZone } from "@/lib/time";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { managerChainUserIds, reportName } from "@/modules/org/service";
import { MAX_OPEN_SESSION_MS, buildDays } from "./clock";
import { attendanceDays, clockSelfies, missedClockoutNotices } from "./schema";
import { OVERBREAK_GRACE_MS, MINUTE } from "./clock";
import { SELFIE_KEEP_DAYS, loadEventsBetween, notifyOverbreak, onFullDayLeave, prefsFor } from "./service";

// Background work (no signed-in person). src/inngest wraps these in scheduled functions.

const DAY_MS = 86_400_000;

export type RebuildRun = { people: number; days: number };

/**
 * Rebuilds attendance_days for the last few days from the clock events. Safe to run any time and as often as needed:
 * it replaces the rows from the events and nothing else, so the table is never edited by hand.
 * Flags: open_session, outside_range, corrected, idle_unanswered, overbreak, on_leave. (Late, overtime and absence need schedules, Phase 2.5.)
 */
export async function rebuildAttendanceDays(now = new Date(), daysBack = 3): Promise<RebuildRun> {
  const fromMs = now.getTime() - (daysBack + 2) * DAY_MS;
  const people = (await db.execute(sql`select distinct employee_id from time.clock_events where occurred_at >= to_timestamp(${fromMs / 1000})`)) as unknown as { employee_id: string }[];
  let written = 0;

  for (const { employee_id: employeeId } of people) {
    const prefs = await prefsFor(db, employeeId);
    const today = formatInZone(now, prefs.zone, "yyyy-MM-dd");
    const earliest = formatInZone(now.getTime() - daysBack * DAY_MS, prefs.zone, "yyyy-MM-dd");
    const events = await loadEventsBetween(db, employeeId, fromMs - DAY_MS, now.getTime());
    const days = buildDays(events, prefs.zone).filter((d) => d.date >= earliest && d.date <= today);

    for (const d of days) {
      const end = d.lastOut ?? now.getTime();
      const flagRows = (await db.execute(sql`
        select
          bool_or(outside_allowed_range) as outside,
          bool_or(source = 'admin_correction') as corrected
        from time.clock_events
        where employee_id = ${employeeId} and occurred_at between to_timestamp(${d.firstIn / 1000}) and to_timestamp(${end / 1000})`)) as unknown as { outside: boolean | null; corrected: boolean | null }[];
      const [idle] = (await db.execute(sql`
        select count(*)::int as n from time.idle_prompts
        where employee_id = ${employeeId} and answered_at is null and prompted_at <= to_timestamp(${(now.getTime() - 10 * 60_000) / 1000})
          and prompted_at between to_timestamp(${d.firstIn / 1000}) and to_timestamp(${end / 1000})`)) as unknown as { n: number }[];

      const flags = [
        d.open ? "open_session" : null,
        flagRows[0]?.outside ? "outside_range" : null,
        flagRows[0]?.corrected ? "corrected" : null,
        idle.n > 0 ? "idle_unanswered" : null,
        d.overbreakMinutes > 0 ? "overbreak" : null,
        (await onFullDayLeave(db, employeeId, d.date)) ? "on_leave" : null,
      ].filter((f): f is string => f !== null);

      const values = {
        sessions: d.sessions,
        workedMinutes: d.workedMinutes,
        breakMinutes: d.breakMinutes,
        overbreakMinutes: d.overbreakMinutes,
        firstIn: new Date(d.firstIn),
        lastOut: d.lastOut ? new Date(d.lastOut) : null,
        flags,
        builtAt: new Date(),
      };
      await db.insert(attendanceDays).values({ employeeId, date: d.date, ...values }).onConflictDoUpdate({ target: [attendanceDays.employeeId, attendanceDays.date], set: values });
      written += 1;
    }
  }
  return { people: people.length, days: written };
}

/**
 * Hourly: a session open for more than 12 hours probably means a forgotten clock-out. The person and their lead are told once.
 * (When schedules exist in Phase 2.5 this switches to "shift end plus the team's grace period".)
 */
export async function runMissedClockouts(now = new Date()): Promise<{ noticed: number }> {
  const cutoff = new Date(now.getTime() - MAX_OPEN_SESSION_MS);
  const open = (await db.execute(sql`
    select s.employee_id, s.event_id, e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from (
      select employee_id,
             (array_agg(id order by occurred_at desc, created_at desc) filter (where type = 'clock_in'))[1] as event_id,
             (array_agg(type order by occurred_at desc, created_at desc))[1] as last_type,
             (max(occurred_at) filter (where type = 'clock_in')) as last_in
      from time.clock_events where occurred_at > now() - interval '7 days' group by employee_id
    ) s
    join core.employees e on e.id = s.employee_id
    where s.last_type <> 'clock_out' and s.last_in < ${cutoff.toISOString()}::timestamptz
      and not exists (select 1 from time.missed_clockout_notices n where n.event_id = s.event_id)`)) as unknown as {
    employee_id: string; event_id: string; user_id: string | null; first: string; last: string; preferred: string | null;
  }[];

  let noticed = 0;
  const hr = await hrUserIds();
  for (const o of open) {
    await db.transaction(async (tx) => {
      const claimed = await tx.insert(missedClockoutNotices).values({ eventId: o.event_id }).onConflictDoNothing().returning({ id: missedClockoutNotices.eventId });
      if (claimed.length === 0) return;
      noticed += 1;
      const name = reportName({ first: o.first, last: o.last, preferred: o.preferred });
      if (o.user_id) await notify(tx, { userId: o.user_id, kind: "attendance.missed_clockout", title: "You may have forgotten to clock out", body: "Your session has been open for over 12 hours. Clock out, or ask for a time correction.", link: "/attendance" });
      const chain = await managerChainUserIds(tx, o.employee_id);
      const targets = (chain.length > 0 ? chain.slice(0, 1) : hr).filter((id) => id !== o.user_id);
      await notify(tx, targets.map((userId) => ({ userId, kind: "attendance.missed_clockout_lead", title: `${name} has been clocked in for over 12 hours`, body: "They may have forgotten to clock out.", link: "/attendance?tab=team" })));
    });
  }
  return { noticed };
}

/** Daily: delete clock-in selfies older than 30 days (the file goes; the row stays, marked purged). */
export async function purgeSelfies(now = new Date()): Promise<{ purged: number }> {
  const cutoff = new Date(now.getTime() - SELFIE_KEEP_DAYS * DAY_MS);
  const stale = await db.select({ id: clockSelfies.id, path: clockSelfies.storagePath }).from(clockSelfies).where(sql`${clockSelfies.purgedAt} is null and ${clockSelfies.takenAt} < ${cutoff.toISOString()}::timestamptz`).limit(500);
  if (stale.length === 0) return { purged: 0 };
  await getDocumentStorage().remove(BUCKETS.employee, stale.map((s) => s.path));
  for (const s of stale) await db.update(clockSelfies).set({ purgedAt: now }).where(eq(clockSelfies.id, s.id));
  return { purged: stale.length };
}

/**
 * Every few minutes: a timed break that is STILL running past its length (plus the one-minute grace) is reported to the
 * lead now, instead of waiting for the person to come back. Each break is reported once (see notifyOverbreak).
 */
export async function runOverbreakAlerts(now = new Date()): Promise<{ noticed: number }> {
  const running = (await db.execute(sql`
    select last.employee_id, last.event_id, last.planned, (extract(epoch from last.occurred_at) * 1000)::float8 as started_ms
    from (
      select distinct on (employee_id) employee_id, id as event_id, type, planned_break_minutes as planned, occurred_at
      from time.clock_events where occurred_at > now() - interval '12 hours'
      order by employee_id, occurred_at desc, created_at desc
    ) last
    where last.type = 'break_start' and last.planned is not null
      and last.occurred_at < to_timestamp(${(now.getTime() - OVERBREAK_GRACE_MS) / 1000}) - (last.planned || ' minutes')::interval
      and not exists (select 1 from time.overbreak_notices n where n.event_id = last.event_id)`)) as unknown as {
    employee_id: string; event_id: string; planned: number; started_ms: number;
  }[];

  let noticed = 0;
  for (const r of running) {
    const over = now.getTime() - Number(r.started_ms) - r.planned * MINUTE;
    if (await db.transaction((tx) => notifyOverbreak(tx, r.employee_id, r.event_id, over, r.planned))) noticed += 1;
  }
  return { noticed };
}
