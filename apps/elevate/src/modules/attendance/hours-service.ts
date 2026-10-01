import "server-only";
import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";

// Server-only helpers for hours approval and export (not server actions). Callers authorize first.

type Executor = Pick<typeof db, "execute">;

export type DayNumbers = { scheduledMinutes: number | null; workedMinutes: number; breakMinutes: number; extraMinutes: number; approvedExtraMinutes: number };
export type Approval = DayNumbers & { approvedBy: string; approvedAt: Date; note: string | null };

/** Flags that do not stop "approve everything that looks fine": informational, or already explained. */
export const CLEAN_FLAGS: ReadonlySet<string> = new Set(["on_leave", "corrected", "extra_hours"]);

export const approvalKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

/** The newest approval for each person and day in a range. */
export async function latestApprovals(executor: Executor, employeeIds: string[] | null, from: string, to: string): Promise<Map<string, Approval>> {
  const filter = employeeIds ? sql`and employee_id in (${sql.join(employeeIds.map((id) => sql`${id}`), sql`, `)})` : sql``;
  if (employeeIds && employeeIds.length === 0) return new Map();
  const rows = (await executor.execute(sql`
    select distinct on (employee_id, date) employee_id, date::text as date, scheduled_minutes, worked_minutes, break_minutes, extra_minutes, approved_extra_minutes, approved_by, approved_at, note
    from time.hours_approvals where date between ${from}::date and ${to}::date ${filter}
    order by employee_id, date, approved_at desc, id desc`)) as unknown as {
    employee_id: string; date: string; scheduled_minutes: number | null; worked_minutes: number; break_minutes: number; extra_minutes: number; approved_extra_minutes: number; approved_by: string; approved_at: Date; note: string | null;
  }[];
  return new Map(
    rows.map((r) => [
      approvalKey(r.employee_id, r.date),
      { scheduledMinutes: r.scheduled_minutes, workedMinutes: r.worked_minutes, breakMinutes: r.break_minutes, extraMinutes: r.extra_minutes, approvedExtraMinutes: r.approved_extra_minutes, approvedBy: r.approved_by, approvedAt: new Date(r.approved_at), note: r.note },
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
    (approval.scheduledMinutes ?? null) === (current.scheduledMinutes ?? null);
  return same ? "approved" : "changed";
}

export type AttendanceRow = DayNumbers & { employeeId: string; date: string; sessions: number; flags: string[]; lateMinutes: number; earlyLeaveMinutes: number; firstIn: Date | null; lastOut: Date | null };

/** The rebuilt attendance days of some people in a range. */
export async function attendanceRows(executor: Executor, employeeIds: string[] | null, from: string, to: string): Promise<AttendanceRow[]> {
  if (employeeIds && employeeIds.length === 0) return [];
  const filter = employeeIds ? sql`and employee_id in (${sql.join(employeeIds.map((id) => sql`${id}`), sql`, `)})` : sql``;
  const rows = (await executor.execute(sql`
    select employee_id, date::text as date, sessions, scheduled_minutes, worked_minutes, break_minutes, extra_minutes, approved_extra_minutes, late_minutes, early_leave_minutes, flags, first_in, last_out
    from time.attendance_days where date between ${from}::date and ${to}::date ${filter} order by date`)) as unknown as {
    employee_id: string; date: string; sessions: number; scheduled_minutes: number | null; worked_minutes: number; break_minutes: number; extra_minutes: number; approved_extra_minutes: number; late_minutes: number; early_leave_minutes: number; flags: string[]; first_in: Date | null; last_out: Date | null;
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
    firstIn: r.first_in ? new Date(r.first_in) : null,
    lastOut: r.last_out ? new Date(r.last_out) : null,
  }));
}

/** Each person's own time zone (their clock setting), defaulting to the company zone elsewhere. */
export async function zonesFor(executor: Executor, employeeIds: string[]): Promise<Map<string, string | null>> {
  if (employeeIds.length === 0) return new Map();
  const rows = (await executor.execute(sql`select employee_id, time_zone from time.clock_prefs where employee_id in (${sql.join(employeeIds.map((id) => sql`${id}`), sql`, `)})`)) as unknown as { employee_id: string; time_zone: string | null }[];
  return new Map(rows.map((r) => [r.employee_id, r.time_zone]));
}
