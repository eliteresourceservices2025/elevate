import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { formatInZone } from "@/lib/time";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { managerChainUserIds, reportName } from "@/modules/org/service";
import { MAX_OPEN_SESSION_MS, QUIET_AFTER_MS, buildDays } from "./clock";
import { attendanceDays, clockSelfies, correctionEvidence, missedClockoutNotices, quietNotices } from "./schema";
import { OVERBREAK_GRACE_MS, MINUTE } from "./clock";
import { EXTRA_THRESHOLD_MINUTES, addDays, earlyLeaveMinutes, extraMinutes, hasScheduleAround, lateMinutes, shiftOn } from "./schedule";
import { loadSchedules, loadSchedulesFor } from "./schedule-service";
import { holidaysInRange } from "@/modules/timeoff/request-service";
import { EVIDENCE_KEEP_DAYS, SELFIE_KEEP_DAYS, loadEventsBetween, notifyOverbreak, onFullDayLeave, prefsFor, rulesFor } from "./service";

// Background work (no signed-in person). src/inngest wraps these in scheduled functions.

const DAY_MS = 86_400_000;

export type RebuildRun = { people: number; days: number };

/**
 * A scheduled day that has ended with no clocking, no approved leave and no holiday is "absent". The day gets a row with no
 * sessions so the lead sees it; when something changes later (a correction, approved leave) the flag is taken off again.
 */
async function flagAbsences(now: Date, daysBack: number): Promise<number> {
  const earliestMs = now.getTime() - (daysBack + 2) * DAY_MS;
  const ids = (await db.execute(sql`
    select distinct s.employee_id from time.schedules s join core.employees e on e.id = s.employee_id
    where e.archived_at is null and e.status <> 'separated' and s.effective_from <= ((${now.toISOString()}::timestamptz at time zone 'UTC')::date + 1)
      and (s.effective_to is null or s.effective_to >= ((${new Date(earliestMs).toISOString()}::timestamptz at time zone 'UTC')::date - 1))`)) as unknown as { employee_id: string }[];
  const byPerson = await loadSchedulesFor(db, ids.map((r) => r.employee_id));
  let written = 0;

  for (const [employeeId, schedules] of byPerson) {
    const prefs = await prefsFor(db, employeeId);
    const today = formatInZone(now, prefs.zone, "yyyy-MM-dd");
    const earliest = formatInZone(now.getTime() - daysBack * DAY_MS, prefs.zone, "yyyy-MM-dd");
    const holidays = new Set((await holidaysInRange(db, employeeId, addDays(earliest, -1), addDays(today, 1))).map((h) => h.date));
    for (let date = earliest; date < today; date = addDays(date, 1)) {
      const shift = shiftOn(schedules, prefs.zone, date);
      if (!shift) continue;
      const [worked] = (await db.execute(sql`select 1 as ok from time.attendance_days where employee_id = ${employeeId} and date = ${date}::date and sessions > 0`)) as unknown as { ok: number }[];
      const [leave] = (await db.execute(sql`select 1 as ok from time.leave_requests where employee_id = ${employeeId} and status = 'approved' and start_date <= ${date}::date and end_date >= ${date}::date limit 1`)) as unknown as { ok: number }[];
      const absent = !worked && !leave && !holidays.has(date) && shift.endMs <= now.getTime();
      if (absent) {
        await db.execute(sql`
          insert into time.attendance_days (employee_id, date, sessions, scheduled_minutes, flags) values (${employeeId}, ${date}::date, 0, ${shift.scheduledMinutes}, array['absent'])
          on conflict (employee_id, date) do update set scheduled_minutes = excluded.scheduled_minutes,
            flags = case when 'absent' = any(time.attendance_days.flags) then time.attendance_days.flags else array_append(time.attendance_days.flags, 'absent') end`);
        written += 1;
      } else {
        await db.execute(sql`update time.attendance_days set flags = array_remove(flags, 'absent') where employee_id = ${employeeId} and date = ${date}::date`);
      }
    }
  }
  return written;
}

/**
 * Rebuilds attendance_days for the last few days from the clock events. Safe to run any time and as often as needed:
 * it replaces the rows from the events and nothing else, so the table is never edited by hand.
 * Flags: open_session, outside_range, corrected, idle_unanswered, overbreak, on_leave, and against the person's schedule: late,
 * left_early, extra_hours, rest_day_work, holiday_work and absent. People with no schedule get none of those.
 */
export async function rebuildAttendanceDays(now = new Date(), daysBack = 3): Promise<RebuildRun> {
  const fromMs = now.getTime() - (daysBack + 2) * DAY_MS;
  const people = (await db.execute(sql`select distinct employee_id from time.clock_events where occurred_at >= to_timestamp(${fromMs / 1000})`)) as unknown as { employee_id: string }[];
  let written = 0;

  for (const { employee_id: employeeId } of people) {
    const prefs = await prefsFor(db, employeeId);
    const rules = await rulesFor(db, employeeId);
    const today = formatInZone(now, prefs.zone, "yyyy-MM-dd");
    const earliest = formatInZone(now.getTime() - daysBack * DAY_MS, prefs.zone, "yyyy-MM-dd");
    const events = await loadEventsBetween(db, employeeId, fromMs - DAY_MS, now.getTime());
    const days = buildDays(events, prefs.zone).filter((d) => d.date >= earliest && d.date <= today);
    const schedules = await loadSchedules(db, employeeId);
    const holidays = new Set((await holidaysInRange(db, employeeId, addDays(earliest, -1), addDays(today, 1))).map((h) => h.date));

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

      // A team that expects end-of-day reports: a finished session with no note is flagged (cleared on the next rebuild once written).
      const endedIds = d.sessionList.filter((s) => s.endAt !== null && s.eventId).map((s) => s.eventId as string);
      let missingEod = false;
      if (rules.eodExpected && endedIds.length > 0) {
        const [have] = (await db.execute(sql`select count(*)::int as n from time.shift_notes where session_event_id in (${sql.join(endedIds.map((id) => sql`${id}`), sql`, `)})`)) as unknown as { n: number }[];
        missingEod = have.n < endedIds.length;
      }

      const [jibbleFlag] = (await db.execute(sql`select 1 as ok from time.jibble_daily where employee_id = ${employeeId} and date = ${d.date}::date and flagged`)) as unknown as { ok: number }[];

      // Against the person's schedule: late, left early, extra hours (a rest day or holiday counts in full).
      const shift = shiftOn(schedules, prefs.zone, d.date);
      const hasSchedule = hasScheduleAround(schedules, d.date);
      const holiday = holidays.has(d.date);
      const late = shift && !holiday ? lateMinutes(d.firstIn, shift, rules.lateGraceMinutes) : 0;
      const early = shift && !holiday && d.lastOut !== null && !d.open ? earlyLeaveMinutes(d.lastOut, shift, rules.lateGraceMinutes) : 0;
      const extra = extraMinutes({ workedMinutes: d.workedMinutes, shift, hasSchedule, holiday });

      const flags = [
        d.open ? "open_session" : null,
        late > 0 ? "late" : null,
        early > 0 ? "left_early" : null,
        extra > 0 ? "extra_hours" : null,
        hasSchedule && !shift && !holiday && d.workedMinutes >= EXTRA_THRESHOLD_MINUTES ? "rest_day_work" : null,
        holiday && d.workedMinutes >= EXTRA_THRESHOLD_MINUTES ? "holiday_work" : null,
        flagRows[0]?.outside ? "outside_range" : null,
        flagRows[0]?.corrected ? "corrected" : null,
        idle.n > 0 ? "idle_unanswered" : null,
        d.overbreakMinutes > 0 ? "overbreak" : null,
        missingEod ? "no_eod" : null,
        jibbleFlag ? "jibble_mismatch" : null,
        (await onFullDayLeave(db, employeeId, d.date)) ? "on_leave" : null,
      ].filter((f): f is string => f !== null);

      const values = {
        sessions: d.sessions,
        workedMinutes: d.workedMinutes,
        breakMinutes: d.breakMinutes,
        overbreakMinutes: d.overbreakMinutes,
        scheduledMinutes: shift?.scheduledMinutes ?? null,
        lateMinutes: late,
        earlyLeaveMinutes: early,
        extraMinutes: extra,
        firstIn: new Date(d.firstIn),
        lastOut: d.lastOut ? new Date(d.lastOut) : null,
        flags,
        builtAt: new Date(),
      };
      await db.insert(attendanceDays).values({ employeeId, date: d.date, ...values }).onConflictDoUpdate({ target: [attendanceDays.employeeId, attendanceDays.date], set: values });
      written += 1;
    }
  }
  written += await flagAbsences(now, daysBack);
  return { people: people.length, days: written };
}

/**
 * Hourly: someone still clocked in once their shift has ended plus the team's grace period probably forgot to clock out; so does
 * a session open for more than 12 hours (the backstop for people with no schedule). The person and their lead are told once per session.
 */
export async function runMissedClockouts(now = new Date()): Promise<{ noticed: number }> {
  const atShiftEnd = await missedAtShiftEnd(now);
  const backstop = await missedAfterTwelveHours(now);
  return { noticed: atShiftEnd + backstop.noticed };
}

/** Open sessions of people with a schedule whose shift ended more than the team's grace ago. */
async function missedAtShiftEnd(now: Date): Promise<number> {
  const open = (await db.execute(sql`
    select s.employee_id, s.event_id, s.last_in_ms, e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from (
      select employee_id,
             (array_agg(id order by occurred_at desc, created_at desc) filter (where type = 'clock_in'))[1] as event_id,
             (array_agg(type order by occurred_at desc, created_at desc))[1] as last_type,
             (extract(epoch from max(occurred_at) filter (where type = 'clock_in')) * 1000)::float8 as last_in_ms
      from time.clock_events where occurred_at > now() - interval '3 days' group by employee_id
    ) s
    join core.employees e on e.id = s.employee_id
    where s.last_type <> 'clock_out' and s.event_id is not null
      and not exists (select 1 from time.missed_clockout_notices n where n.event_id = s.event_id)`)) as unknown as {
    employee_id: string; event_id: string; last_in_ms: number; user_id: string | null; first: string; last: string; preferred: string | null;
  }[];
  if (open.length === 0) return 0;

  const schedules = await loadSchedulesFor(db, open.map((o) => o.employee_id));
  const hr = await hrUserIds();
  let noticed = 0;
  for (const o of open) {
    const list = schedules.get(o.employee_id);
    if (!list) continue;
    const prefs = await prefsFor(db, o.employee_id);
    const shift = shiftOn(list, prefs.zone, formatInZone(Number(o.last_in_ms), prefs.zone, "yyyy-MM-dd"));
    if (!shift) continue;
    const rules = await rulesFor(db, o.employee_id);
    if (now.getTime() <= shift.endMs + rules.graceMinutes * MINUTE) continue;

    await db.transaction(async (tx) => {
      const claimed = await tx.insert(missedClockoutNotices).values({ eventId: o.event_id }).onConflictDoNothing().returning({ id: missedClockoutNotices.eventId });
      if (claimed.length === 0) return;
      noticed += 1;
      const name = reportName({ first: o.first, last: o.last, preferred: o.preferred });
      const ended = formatInZone(shift.endMs, prefs.zone, "h:mm a");
      if (o.user_id) await notify(tx, { userId: o.user_id, kind: "attendance.missed_clockout", title: "Your shift has ended and you are still clocked in", body: `Your shift ended at ${ended}. Clock out, or ask for extra hours if you are working past it.`, link: "/attendance" });
      const chain = await managerChainUserIds(tx, o.employee_id);
      const targets = (chain.length > 0 ? chain.slice(0, 1) : hr).filter((id) => id !== o.user_id);
      await notify(tx, targets.map((userId) => ({ userId, kind: "attendance.missed_clockout_lead", title: `${name} is still clocked in after their shift`, body: `Their shift ended at ${ended}. They may have forgotten to clock out.`, link: "/attendance?tab=team" })));
    });
  }
  return noticed;
}

async function missedAfterTwelveHours(now: Date): Promise<{ noticed: number }> {
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

/**
 * Every 15 minutes: someone who is clocked in and working but has not been seen for 2 hours (the page closed, the device
 * restarted or the connection dropped) is reported to their lead (HR when nobody is above) once per session. Nobody is clocked out.
 */
export async function runQuietSessionAlerts(now = new Date()): Promise<{ noticed: number }> {
  const cutoff = new Date(now.getTime() - QUIET_AFTER_MS);
  const quiet = (await db.execute(sql`
    select s.employee_id, s.event_id, e.user_id, e.legal_first_name as first, e.legal_last_name as last, e.preferred_name as preferred
    from (
      select employee_id,
             (array_agg(id order by occurred_at desc, created_at desc) filter (where type = 'clock_in'))[1] as event_id,
             (array_agg(type order by occurred_at desc, created_at desc))[1] as last_type,
             max(occurred_at) as last_event
      from time.clock_events where occurred_at > now() - interval '3 days' group by employee_id
    ) s
    join core.employees e on e.id = s.employee_id
    left join time.clock_presence p on p.employee_id = s.employee_id
    where s.last_type in ('clock_in', 'break_end') and s.event_id is not null
      and greatest(s.last_event, coalesce(p.last_seen_at, s.last_event)) < ${cutoff.toISOString()}::timestamptz
      and not exists (select 1 from time.quiet_notices n where n.event_id = s.event_id)`)) as unknown as {
    employee_id: string; event_id: string; user_id: string | null; first: string; last: string; preferred: string | null;
  }[];

  let noticed = 0;
  const hr = await hrUserIds();
  for (const o of quiet) {
    await db.transaction(async (tx) => {
      const claimed = await tx.insert(quietNotices).values({ eventId: o.event_id }).onConflictDoNothing().returning({ id: quietNotices.eventId });
      if (claimed.length === 0) return;
      noticed += 1;
      const name = reportName({ first: o.first, last: o.last, preferred: o.preferred });
      const chain = await managerChainUserIds(tx, o.employee_id);
      const targets = (chain.length > 0 ? chain.slice(0, 1) : hr).filter((id) => id !== o.user_id);
      await notify(tx, targets.map((userId) => ({ userId, kind: "attendance.quiet_lead", title: `${name} has not been seen for 2 hours`, body: "They are still clocked in. Their page may be closed, their device off or their connection down.", link: "/attendance?tab=team" })));
    });
  }
  return { noticed };
}

/** Daily: delete screenshots that were never attached (after a day) and attached ones 90 days after the decision. The rows stay. */
export async function purgeEvidence(now = new Date()): Promise<{ purged: number }> {
  const orphanCutoff = new Date(now.getTime() - DAY_MS);
  const keepCutoff = new Date(now.getTime() - EVIDENCE_KEEP_DAYS * DAY_MS);
  const orphans = await db.select({ id: correctionEvidence.id, path: correctionEvidence.storagePath }).from(correctionEvidence).where(sql`${correctionEvidence.correctionId} is null and ${correctionEvidence.createdAt} < ${orphanCutoff.toISOString()}::timestamptz`).limit(500);
  if (orphans.length > 0) {
    await getDocumentStorage().remove(BUCKETS.employee, orphans.map((o) => o.path));
    for (const o of orphans) await db.delete(correctionEvidence).where(eq(correctionEvidence.id, o.id));
  }
  const old = (await db.execute(sql`
    select ev.id, ev.storage_path as path from time.correction_evidence ev join time.clock_corrections c on c.id = ev.correction_id
    where ev.purged_at is null and c.status <> 'pending' and c.decided_at < ${keepCutoff.toISOString()}::timestamptz limit 500`)) as unknown as { id: string; path: string }[];
  if (old.length > 0) {
    await getDocumentStorage().remove(BUCKETS.employee, old.map((o) => o.path));
    for (const o of old) await db.update(correctionEvidence).set({ purgedAt: now }).where(eq(correctionEvidence.id, o.id));
  }
  return { purged: orphans.length + old.length };
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
