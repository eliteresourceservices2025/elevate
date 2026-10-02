import { sql } from "drizzle-orm";
import { check, date, integer, numeric, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ops } from "@/modules/audit/schema";

// People analytics summary tables (Phase 4.3). Written only by the nightly job (build.ts), read only through queries.ts.
// Aggregates only: no row names a person. A "dimension" is a group the numbers are about: the company, a team, a client, or the
// whole downline of one manager (what a team lead sees). The company row uses the nil uuid because primary keys cannot be null.

const dim = {
  dimKind: text("dim_kind").notNull(),
  dimId: uuid("dim_id").notNull(),
};
const builtAt = timestamp("built_at", { withTimezone: true }).notNull().defaultNow();
const kindCheck = (name: string) => check(name, sql`dim_kind in ('company','team','client','downline')`);

/** People current on that date, per group (start and end dates; team, client and manager as they were that day). */
export const headcountDaily = ops
  .table(
    "analytics_headcount_daily",
    { date: date("date", { mode: "string" }).notNull(), ...dim, headcount: integer("headcount").notNull(), builtAt },
    (t) => [primaryKey({ columns: [t.date, t.dimKind, t.dimId] }), kindCheck("analytics_headcount_kind_chk")],
  )
  .enableRLS();

/** Joiners, leavers and average headcount per month (turnover = leavers / average headcount, computed when shown). */
export const movementMonthly = ops
  .table(
    "analytics_movement_monthly",
    {
      month: date("month", { mode: "string" }).notNull(),
      ...dim,
      joiners: integer("joiners").notNull(),
      leavers: integer("leavers").notNull(),
      avgHeadcount: numeric("avg_headcount", { precision: 9, scale: 2 }).notNull(),
      endHeadcount: integer("end_headcount").notNull(),
      builtAt,
    },
    (t) => [primaryKey({ columns: [t.month, t.dimKind, t.dimId] }), kindCheck("analytics_movement_kind_chk")],
  )
  .enableRLS();

/** Prize days used per month (usage minus reversals, from the leave ledger). Counts only. */
export const leaveMonthly = ops
  .table(
    "analytics_leave_monthly",
    {
      month: date("month", { mode: "string" }).notNull(),
      ...dim,
      daysUsed: numeric("days_used", { precision: 9, scale: 2 }).notNull(),
      /** The group's headcount at the end of the month: below 5, the number is not shown. */
      groupSize: integer("group_size").notNull(),
      builtAt,
    },
    (t) => [primaryKey({ columns: [t.month, t.dimKind, t.dimId] }), kindCheck("analytics_leave_kind_chk")],
  )
  .enableRLS();

/** Attendance flags per Monday-to-Sunday week: how many person-days carried each flag (never who). */
export const attendanceWeekly = ops
  .table(
    "analytics_attendance_weekly",
    {
      weekStart: date("week_start", { mode: "string" }).notNull(),
      ...dim,
      /** Person-days with an attendance record that week: the denominator of the rates. */
      dayCount: integer("day_count").notNull(),
      late: integer("late").notNull(),
      absent: integer("absent").notNull(),
      leftEarly: integer("left_early").notNull(),
      extraHours: integer("extra_hours").notNull(),
      unapprovedExtra: integer("unapproved_extra").notNull(),
      groupSize: integer("group_size").notNull(),
      builtAt,
    },
    (t) => [primaryKey({ columns: [t.weekStart, t.dimKind, t.dimId] }), kindCheck("analytics_attendance_kind_chk")],
  )
  .enableRLS();

/** Applications that reached each stage, by the month they applied, per job (nil uuid = all jobs). */
export const funnelMonthly = ops
  .table(
    "analytics_funnel_monthly",
    {
      month: date("month", { mode: "string" }).notNull(),
      openingId: uuid("opening_id").notNull(),
      stage: text("stage").notNull(),
      applications: integer("applications").notNull(),
      builtAt,
    },
    (t) => [primaryKey({ columns: [t.month, t.openingId, t.stage] })],
  )
  .enableRLS();

/** Days from applied to hired, by the month of the hire, per job (nil uuid = all jobs). */
export const timeToHireMonthly = ops
  .table(
    "analytics_time_to_hire_monthly",
    {
      month: date("month", { mode: "string" }).notNull(),
      openingId: uuid("opening_id").notNull(),
      hires: integer("hires").notNull(),
      totalDays: numeric("total_days", { precision: 10, scale: 2 }).notNull(),
      medianDays: numeric("median_days", { precision: 8, scale: 2 }).notNull(),
      builtAt,
    },
    (t) => [primaryKey({ columns: [t.month, t.openingId] })],
  )
  .enableRLS();
