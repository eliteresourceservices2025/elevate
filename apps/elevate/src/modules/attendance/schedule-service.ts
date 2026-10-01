import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { prefsFor } from "./service";
import { scheduleFor, workingWeekdaysInZone, type ScheduleLite } from "./schedule";

// Server-only helpers for schedules (not server actions, so they may take a transaction). Callers authorize first.

type Executor = Pick<typeof db, "execute" | "insert" | "select" | "update" | "delete">;

type Row = { effective_from: string; effective_to: string | null; start_time: string; end_time: string; weekdays: number[]; break_minutes: number; zone: string; id: string };
const toLite = (r: Row): ScheduleLite & { id: string } => ({ id: r.id, effectiveFrom: r.effective_from, effectiveTo: r.effective_to, startTime: r.start_time, endTime: r.end_time, weekdays: r.weekdays.map(Number), breakMinutes: Number(r.break_minutes), zone: r.zone });

/** Every schedule a person has had, oldest first. */
export async function loadSchedules(executor: Executor, employeeId: string): Promise<(ScheduleLite & { id: string })[]> {
  const rows = (await executor.execute(sql`
    select id, effective_from::text, effective_to::text, start_time, end_time, weekdays, break_minutes, zone
    from time.schedules where employee_id = ${employeeId} order by effective_from`)) as unknown as Row[];
  return rows.map(toLite);
}

/** Schedules of many people at once (people with none are simply missing). */
export async function loadSchedulesFor(executor: Executor, employeeIds: string[]): Promise<Map<string, (ScheduleLite & { id: string })[]>> {
  const out = new Map<string, (ScheduleLite & { id: string })[]>();
  if (employeeIds.length === 0) return out;
  const rows = (await executor.execute(sql`
    select employee_id, id, effective_from::text, effective_to::text, start_time, end_time, weekdays, break_minutes, zone
    from time.schedules where employee_id in (${sql.join(employeeIds.map((id) => sql`${id}`), sql`, `)}) order by effective_from`)) as unknown as (Row & { employee_id: string })[];
  for (const r of rows) out.set(r.employee_id, [...(out.get(r.employee_id) ?? []), toLite(r)]);
  return out;
}

/** The time zone a new schedule starts with: the person's current client's zone, or the company zone. */
export async function defaultScheduleZone(executor: Executor, employeeId: string): Promise<string> {
  const [row] = (await executor.execute(sql`
    select c.time_zone from core.client_assignments a join core.clients c on c.id = a.client_id
    where a.employee_id = ${employeeId} and a.end_date is null and c.archived_at is null order by a.start_date desc limit 1`)) as unknown as { time_zone: string }[];
  return row?.time_zone ?? DEFAULT_TIMEZONE;
}

/**
 * The weekdays (JavaScript 0 = Sunday) the person works in their own zone on a date, from their schedule; undefined when they
 * have no schedule then, so leave counting falls back to Monday to Friday.
 */
export async function workingWeekdaysFor(executor: Executor, employeeId: string, onDate: string): Promise<ReadonlySet<number> | undefined> {
  const schedules = await loadSchedules(executor, employeeId);
  const current = scheduleFor(schedules, onDate);
  if (!current) return undefined;
  return workingWeekdaysInZone(current, (await prefsFor(executor, employeeId)).zone);
}
