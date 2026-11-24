import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";

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
