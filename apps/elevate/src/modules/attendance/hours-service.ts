import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";

// Server-only helpers for hours approval and export (not server actions). Callers authorize first.

type Executor = Pick<typeof db, "execute">;

/** A day's worked and break minutes for one client (client null: time with no client). */
export type ClientSplit = { clientId: string | null; workedMinutes: number; breakMinutes: number };
export type DayNumbers = {
  scheduledMinutes: number | null;
  workedMinutes: number;
  breakMinutes: number;
  extraMinutes: number;
  approvedExtraMinutes: number;
  /** The day by client. Left out where it is not known (then it is not compared). */
  clientSplit?: ClientSplit[];
};
/** `clientSplit` is null on approvals from before hours were split by client: those are not compared by client. */
export type Approval = Omit<DayNumbers, "clientSplit"> & { clientSplit: ClientSplit[] | null; approvedBy: string; approvedAt: Date; note: string | null };

/** The split in one fixed order, as text, so two splits can be compared. */
const splitKey = (split: readonly ClientSplit[]) => JSON.stringify([...split].sort((a, b) => (a.clientId ?? "").localeCompare(b.clientId ?? "")).map((c) => [c.clientId, c.workedMinutes, c.breakMinutes]));

export { BLOCKING_FLAGS, CLEAN_FLAGS, HARD_STOP_FLAGS } from "./flag-severity";

export const approvalKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

/** The newest approval for each person and day in a range. A day whose newest approval was taken back (a newer reopen) has none. */
export async function latestApprovals(executor: Executor, employeeIds: string[] | null, from: string, to: string): Promise<Map<string, Approval>> {
  const filter = employeeIds ? sql`and employee_id in (${sql.join(employeeIds.map((id) => sql`${id}`), sql`, `)})` : sql``;
  if (employeeIds && employeeIds.length === 0) return new Map();
  const rows = (await executor.execute(sql`
    select * from (
      select distinct on (employee_id, date) employee_id, date::text as date, scheduled_minutes, worked_minutes, break_minutes, extra_minutes, approved_extra_minutes, client_split, approved_by, approved_at, note
      from time.hours_approvals where date between ${from}::date and ${to}::date ${filter}
      order by employee_id, date, approved_at desc, id desc
    ) a where not exists (select 1 from time.hours_reopens r where r.employee_id = a.employee_id and r.date = a.date::date and r.reopened_at > a.approved_at)`)) as unknown as {
    employee_id: string; date: string; scheduled_minutes: number | null; worked_minutes: number; break_minutes: number; extra_minutes: number; approved_extra_minutes: number; client_split: ClientSplit[] | null; approved_by: string; approved_at: Date; note: string | null;
  }[];
  return new Map(
    rows.map((r) => [
      approvalKey(r.employee_id, r.date),
      { scheduledMinutes: r.scheduled_minutes, workedMinutes: r.worked_minutes, breakMinutes: r.break_minutes, extraMinutes: r.extra_minutes, approvedExtraMinutes: r.approved_extra_minutes, clientSplit: r.client_split, approvedBy: r.approved_by, approvedAt: new Date(r.approved_at), note: r.note },
    ]),
  );
}

export type DayState = "approved" | "changed" | "none";

/** Whether a day's current numbers are what was approved, differ from it (changed after approval), or were never approved. */
export function dayState(current: DayNumbers, approval: Approval | undefined): DayState {
  if (!approval) return "none";
  const same =
    approval.workedMinutes === current.workedMinutes &&
    approval.breakMinutes === current.breakMinutes &&
    approval.extraMinutes === current.extraMinutes &&
    approval.approvedExtraMinutes === current.approvedExtraMinutes &&
    (approval.scheduledMinutes ?? null) === (current.scheduledMinutes ?? null) &&
    // Compared by client only when both sides know it (an approval from before clients has no split).
    (approval.clientSplit === null || current.clientSplit === undefined || splitKey(approval.clientSplit) === splitKey(current.clientSplit));
  return same ? "approved" : "changed";
}

export type AttendanceRow = DayNumbers & { clientSplit: ClientSplit[];  employeeId: string; date: string; sessions: number; flags: string[]; lateMinutes: number; earlyLeaveMinutes: number; firstIn: Date | null; lastOut: Date | null };

/**
 * The rebuilt attendance days of some people in a range. Days marked "test only" are left out (hours review, the export, the
 * unapproved counts and the reminders all read days through here), unless `includeTest` asks for them.
 */
export async function attendanceRows(executor: Executor, employeeIds: string[] | null, from: string, to: string, options: { includeTest?: boolean } = {}): Promise<AttendanceRow[]> {
  if (employeeIds && employeeIds.length === 0) return [];
  const filter = employeeIds ? sql`and d.employee_id in (${sql.join(employeeIds.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const testFilter = options.includeTest
    ? sql``
    : sql`and not coalesce((select m.test_only from time.hours_marks m where m.employee_id = d.employee_id and m.date = d.date order by m.set_at desc, m.id desc limit 1), false)`;
  const rows = (await executor.execute(sql`
    select d.employee_id, d.date::text as date, d.sessions, d.scheduled_minutes, d.worked_minutes, d.break_minutes, d.extra_minutes, d.approved_extra_minutes, d.late_minutes, d.early_leave_minutes, d.flags, d.first_in, d.last_out,
      coalesce((select jsonb_agg(jsonb_build_object('clientId', c.client_id, 'workedMinutes', c.worked_minutes, 'breakMinutes', c.break_minutes) order by c.client_id) from time.attendance_day_clients c where c.employee_id = d.employee_id and c.date = d.date), '[]'::jsonb) as client_split
    from time.attendance_days d where d.date between ${from}::date and ${to}::date ${filter} ${testFilter} order by d.date`)) as unknown as {
    employee_id: string; date: string; sessions: number; scheduled_minutes: number | null; worked_minutes: number; break_minutes: number; extra_minutes: number; approved_extra_minutes: number; late_minutes: number; early_leave_minutes: number; flags: string[]; first_in: Date | null; last_out: Date | null; client_split: ClientSplit[];
  }[];
  return rows.map((r) => ({
    employeeId: r.employee_id,
    date: r.date,
    sessions: r.sessions,
    scheduledMinutes: r.scheduled_minutes,
    workedMinutes: r.worked_minutes,
    breakMinutes: r.break_minutes,
    extraMinutes: r.extra_minutes,
    approvedExtraMinutes: r.approved_extra_minutes,
    lateMinutes: r.late_minutes,
    earlyLeaveMinutes: r.early_leave_minutes,
    flags: r.flags,
    clientSplit: r.client_split,
    firstIn: r.first_in ? new Date(r.first_in) : null,
    lastOut: r.last_out ? new Date(r.last_out) : null,
  }));
}

export type TestMark = { employeeId: string; date: string; note: string; setBy: string; setAt: Date };

/** The days currently marked "test only" in a range (the newest row per person and day says test_only = true). */
export async function testMarks(executor: Executor, employeeIds: string[] | null, from: string, to: string): Promise<TestMark[]> {
  if (employeeIds && employeeIds.length === 0) return [];
  const filter = employeeIds ? sql`and employee_id in (${sql.join(employeeIds.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const rows = (await executor.execute(sql`
    select * from (
      select distinct on (employee_id, date) employee_id, date::text as date, test_only, note, set_by, set_at
      from time.hours_marks where date between ${from}::date and ${to}::date ${filter}
      order by employee_id, date, set_at desc, id desc
    ) latest where test_only`)) as unknown as { employee_id: string; date: string; note: string; set_by: string; set_at: Date }[];
  return rows.map((r) => ({ employeeId: r.employee_id, date: r.date, note: r.note, setBy: r.set_by, setAt: new Date(r.set_at) }));
}

/** Each person's own time zone (their clock setting), defaulting to the company zone elsewhere. */
export async function zonesFor(executor: Executor, employeeIds: string[]): Promise<Map<string, string | null>> {
  if (employeeIds.length === 0) return new Map();
  const rows = (await executor.execute(sql`select employee_id, time_zone from time.clock_prefs where employee_id in (${sql.join(employeeIds.map((id) => sql`${id}`), sql`, `)})`)) as unknown as { employee_id: string; time_zone: string | null }[];
  return new Map(rows.map((r) => [r.employee_id, r.time_zone]));
}
