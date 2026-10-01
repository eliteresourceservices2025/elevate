import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { formatInZone } from "@/lib/time";
import { grantedByDate, type Window } from "./extra-hours";

// Server-only helpers for extra hours requests (not server actions, so they may take a transaction). Callers authorize first.

type Executor = Pick<typeof db, "execute">;

export const LIVE_STATUSES = ["pending_lead", "pending_confirm", "approved"] as const;
const DAY_MS = 86_400_000;

/** The approved windows that overlap a stretch of time, oldest first. */
export async function approvedWindows(executor: Executor, employeeId: string, fromMs: number, toMs: number): Promise<(Window & { minutes: number; clientId: string })[]> {
  const rows = (await executor.execute(sql`
    select (extract(epoch from window_start) * 1000)::float8 as s, (extract(epoch from window_end) * 1000)::float8 as e, minutes, client_id
    from time.extra_hours_requests
    where employee_id = ${employeeId} and status = 'approved' and window_end > to_timestamp(${fromMs / 1000}) and window_start < to_timestamp(${toMs / 1000})
    order by window_start`)) as unknown as { s: number; e: number; minutes: number; client_id: string }[];
  return rows.map((r) => ({ startMs: Number(r.s), endMs: Number(r.e), minutes: Number(r.minutes), clientId: r.client_id }));
}

/** Minutes the person already has asked for or approved on the day (their own zone) a window starts, not counting one request. */
export async function liveMinutesOnDay(executor: Executor, employeeId: string, startMs: number, zone: string, exceptId?: string): Promise<number> {
  const rows = (await executor.execute(sql`
    select id, (extract(epoch from window_start) * 1000)::float8 as s, minutes from time.extra_hours_requests
    where employee_id = ${employeeId} and status in ('pending_lead', 'pending_confirm', 'approved')
      and window_start > to_timestamp(${(startMs - 2 * DAY_MS) / 1000}) and window_start < to_timestamp(${(startMs + 2 * DAY_MS) / 1000})`)) as unknown as { id: string; s: number; minutes: number }[];
  const date = formatInZone(startMs, zone, "yyyy-MM-dd");
  return grantedByDate(rows.filter((r) => r.id !== exceptId).map((r) => ({ startMs: Number(r.s), minutes: Number(r.minutes) })), zone).get(date) ?? 0;
}

/** Whether the person is assigned to this client on a date. */
export async function assignedToClient(executor: Executor, employeeId: string, clientId: string, onDate: string): Promise<boolean> {
  const [row] = (await executor.execute(sql`
    select 1 as ok from core.client_assignments a join core.clients c on c.id = a.client_id
    where a.employee_id = ${employeeId} and a.client_id = ${clientId} and c.archived_at is null
      and a.start_date <= ${onDate}::date and (a.end_date is null or a.end_date >= ${onDate}::date) limit 1`)) as unknown as { ok: number }[];
  return Boolean(row);
}

/** Clients a person is assigned to today. */
export async function assignedClients(executor: Executor, employeeId: string): Promise<{ id: string; name: string; zone: string }[]> {
  const rows = (await executor.execute(sql`
    select c.id, c.name, c.time_zone as zone from core.client_assignments a join core.clients c on c.id = a.client_id
    where a.employee_id = ${employeeId} and c.archived_at is null and a.start_date <= current_date and (a.end_date is null or a.end_date >= current_date)
    order by c.name`)) as unknown as { id: string; name: string; zone: string }[];
  return rows;
}
