import { sql } from "drizzle-orm";
import { check, date, index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { core } from "@/modules/core/schema";
import { employees } from "@/modules/people/schema";

// Organization (A2): departments contain teams; positions are a catalog; who reports to whom and
// which team someone is in are dated, so history shows the state on any day.
// employees.manager_id / team_id / position_id hold the CURRENT values (see people/schema.ts).

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const departments = core
  .table(
    "departments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      name: text("name").notNull(),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [uniqueIndex("departments_name_idx").on(sql`lower(${t.name})`)],
  )
  .enableRLS();

export const teams = core
  .table(
    "teams",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      departmentId: uuid("department_id")
        .notNull()
        .references(() => departments.id),
      name: text("name").notNull(),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [uniqueIndex("teams_name_idx").on(sql`lower(${t.name})`), index("teams_department_idx").on(t.departmentId)],
  )
  .enableRLS();

export const positions = core
  .table(
    "positions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      title: text("title").notNull(),
      departmentId: uuid("department_id").references(() => departments.id),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [uniqueIndex("positions_title_idx").on(sql`lower(${t.title})`)],
  )
  .enableRLS();

// One open row per person (effective_to is null). A change closes it on the day the next one starts.
export const reportingLines = core
  .table(
    "reporting_lines",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      managerId: uuid("manager_id").references(() => employees.id), // null = reports to no one
      effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
      effectiveTo: date("effective_to", { mode: "string" }),
      createdBy: uuid("created_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("reporting_lines_employee_idx").on(t.employeeId, t.effectiveFrom),
      index("reporting_lines_manager_idx").on(t.managerId),
      uniqueIndex("reporting_lines_open_idx").on(t.employeeId).where(sql`${t.effectiveTo} is null`),
      check("reporting_lines_dates_chk", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
      check("reporting_lines_not_self_chk", sql`${t.managerId} is null or ${t.managerId} <> ${t.employeeId}`),
    ],
  )
  .enableRLS();

export const teamMemberships = core
  .table(
    "team_memberships",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      teamId: uuid("team_id").references(() => teams.id), // null = in no team
      effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
      effectiveTo: date("effective_to", { mode: "string" }),
      createdBy: uuid("created_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("team_memberships_employee_idx").on(t.employeeId, t.effectiveFrom),
      index("team_memberships_team_idx").on(t.teamId),
      uniqueIndex("team_memberships_open_idx").on(t.employeeId).where(sql`${t.effectiveTo} is null`),
      check("team_memberships_dates_chk", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
    ],
  )
  .enableRLS();
