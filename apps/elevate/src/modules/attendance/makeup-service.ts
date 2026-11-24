import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { holidaysInRange } from "@/modules/timeoff/request-service";
import { expectedMinutesOn } from "./makeup";
import { addDays, hasScheduleAround, isoWeekday, shiftOn, type ScheduleLite } from "./schedule";
import { rulesFor } from "./service";

// Server-only helpers for make-up hours (not server actions, so they may take a transaction). Callers authorize first.

type Executor = Pick<typeof db, "execute">;

export type MakeupWindow = { id: string; startMs: number; endMs: number; minutes: number; missedMinutes: number; absenceDate: string };

/** The approved make-up windows that overlap a stretch of time, oldest first. */
export async function approvedMakeupWindows(executor: Executor, employeeId: string, fromMs: number, toMs: number): Promise<MakeupWindow[]> {
  const rows = (await executor.execute(sql`
    select id, (extract(epoch from window_start) * 1000)::float8 as s, (extract(epoch from window_end) * 1000)::float8 as e, minutes, missed_minutes, absence_date::text as absence_date
    from time.makeup_requests
    where employee_id = ${employeeId} and status = 'approved' and window_end > to_timestamp(${fromMs / 1000}) and window_start < to_timestamp(${toMs / 1000})
    order by window_start`)) as unknown as { id: string; s: number; e: number; minutes: number; missed_minutes: number; absence_date: string }[];
  return rows.map((r) => ({ id: r.id, startMs: Number(r.s), endMs: Number(r.e), minutes: Number(r.minutes), missedMinutes: Number(r.missed_minutes), absenceDate: r.absence_date }));
}

/**
 * What each day from `from` to `to` (inclusive, yyyy-MM-dd in the person's zone) expected of the person, in minutes, or null for a day that expected
 * nothing: no shift and no weekday expectation (see `expectedMinutesOn`), a public holiday or a day of approved full-day leave. Callers authorize first.
 */
export async function expectedMinutesByDay(executor: Executor, employeeId: string, zone: string, from: string, to: string, schedules: readonly ScheduleLite[]): Promise<Map<string, number | null>> {
  const [person] = (await executor.execute(sql`select daily_cap_minutes as cap from core.employees where id = ${employeeId}`)) as unknown as { cap: number | null }[];
  const cap = person?.cap ?? (await rulesFor(executor as never, employeeId)).defaultDailyCapMinutes;
  const holidays = new Set((await holidaysInRange(executor as never, employeeId, from, to)).map((h) => h.date));
  const leave = (await executor.execute(sql`
    select start_date::text as s, end_date::text as e from time.leave_requests
    where employee_id = ${employeeId} and status = 'approved' and not half_day and start_date <= ${to}::date and end_date >= ${from}::date`)) as unknown as { s: string; e: string }[];
  const overrides = new Map(((await executor.execute(sql`select date::text as date, minutes from time.daily_hours where employee_id = ${employeeId} and date between ${from}::date and ${to}::date`)) as unknown as { date: string; minutes: number }[]).map((o) => [o.date, Number(o.minutes)]));
  const out = new Map<string, number | null>();
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const off = holidays.has(date) || leave.some((l) => l.s <= date && date <= l.e);
    const shift = shiftOn(schedules, zone, date);
    out.set(date, off ? null : expectedMinutesOn({ scheduledMinutes: shift?.scheduledMinutes ?? null, hasSchedule: hasScheduleAround(schedules, date), isoWeekday: isoWeekday(date), capMinutes: overrides.get(date) ?? cap }));
  }
  return out;
}
