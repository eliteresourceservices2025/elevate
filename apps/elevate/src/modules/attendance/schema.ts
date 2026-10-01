import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { teams } from "@/modules/org/schema";
import { employees } from "@/modules/people/schema";
import { time } from "@/modules/timeoff/schema";

// The ELEVATE time clock (B2). ELEVATE is the only source of hours. Clock events are append-only; a correction is
// a new, approved row, never an edit. Timestamps come from the database clock, the IP from the request.

export const CLOCK_TYPES = ["clock_in", "break_start", "break_end", "clock_out"] as const;

export const clockEvents = time
  .table(
    "clock_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      type: text("type").notNull(),
      /** The database clock for web events; the approved time for a correction row. */
      occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
      /** web = the person used the clock; admin_correction = an approved correction. */
      source: text("source").notNull().default("web"),
      /** From the request headers, never from the browser's own claim. */
      ip: text("ip"),
      /** True when the team has allowed ranges and the IP was outside them. */
      outsideAllowedRange: boolean("outside_allowed_range").notNull().default(false),
      /** Rounded to two decimals (about 1 km) before it is stored. Optional, only with the person's permission. */
      approxLat: numeric("approx_lat", { precision: 5, scale: 2 }),
      approxLng: numeric("approx_lng", { precision: 5, scale: 2 }),
      correctionId: uuid("correction_id"),
      correctionReason: text("correction_reason"),
      createdBy: uuid("created_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("clock_events_employee_idx").on(t.employeeId, t.occurredAt),
      check("clock_events_type_chk", sql`${t.type} in ('clock_in','break_start','break_end','clock_out')`),
      check("clock_events_source_chk", sql`${t.source} in ('web','admin_correction')`),
      check("clock_events_correction_chk", sql`(${t.source} = 'web') or (${t.correctionId} is not null and coalesce(length(trim(${t.correctionReason})), 0) > 0)`),
      check("clock_events_location_chk", sql`(${t.approxLat} is null) = (${t.approxLng} is null)`),
    ],
  )
  .enableRLS();

/** Per-team rules. A team without a row has no IP restriction and the default idle prompt. */
export const clockRules = time
  .table("clock_rules", {
    teamId: uuid("team_id")
      .primaryKey()
      .references(() => teams.id),
    /** IPv4 addresses or CIDR ranges. Empty = no restriction. */
    allowedCidrs: text("allowed_cidrs").array().notNull().default(sql`'{}'::text[]`),
    selfieRequired: boolean("selfie_required").notNull().default(false),
    /** Minutes without activity before "Are you still working?"; null turns the prompt off. */
    idleMinutes: integer("idle_minutes").default(30),
    /** Minutes after a shift ends before a missed clock-out is raised (used with schedules, Phase 2.5). */
    graceMinutes: integer("grace_minutes").notNull().default(60),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();

/** Each person's own clock settings. */
export const clockPrefs = time
  .table("clock_prefs", {
    employeeId: uuid("employee_id")
      .primaryKey()
      .references(() => employees.id),
    /** Whether the person lets the clock record an approximate location. Off by default. */
    shareLocation: boolean("share_location").notNull().default(false),
    /** The person's own time zone; empty = the company zone. Decides which calendar day a clock-in belongs to. */
    timeZone: text("time_zone"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();

/** A selfie taken at clock-in (only where the team requires it). The file is deleted after 30 days; the row stays. */
export const clockSelfies = time
  .table(
    "clock_selfies",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      eventId: uuid("event_id")
        .notNull()
        .references(() => clockEvents.id),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      storagePath: text("storage_path").notNull(),
      takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
      purgedAt: timestamp("purged_at", { withTimezone: true }),
    },
    (t) => [uniqueIndex("clock_selfies_event_idx").on(t.eventId), uniqueIndex("clock_selfies_path_idx").on(t.storagePath), index("clock_selfies_purge_idx").on(t.takenAt).where(sql`${t.purgedAt} is null`)],
  )
  .enableRLS();

/** "Are you still working?" prompts. An unanswered one is a flag for the lead; it never clocks anyone out. */
export const idlePrompts = time
  .table(
    "idle_prompts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      promptedAt: timestamp("prompted_at", { withTimezone: true }).notNull().defaultNow(),
      answeredAt: timestamp("answered_at", { withTimezone: true }),
      /** idle_api = the browser's Idle Detection; fallback = no activity inside ELEVATE. */
      source: text("source").notNull(),
    },
    (t) => [index("idle_prompts_employee_idx").on(t.employeeId, t.promptedAt), check("idle_prompts_source_chk", sql`${t.source} in ('idle_api','fallback')`)],
  )
  .enableRLS();

export const CORRECTION_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;

/** A request to add missing clock events. Approval writes new admin_correction rows. */
export const clockCorrections = time
  .table(
    "clock_corrections",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      requestedBy: uuid("requested_by").notNull(),
      reason: text("reason").notNull(),
      /** The events to add: [{ type, at (ISO instant) }]. */
      proposed: jsonb("proposed").$type<{ type: string; at: string }[]>().notNull(),
      status: text("status").notNull().default("pending"),
      decidedBy: uuid("decided_by"),
      decidedAt: timestamp("decided_at", { withTimezone: true }),
      decisionNote: text("decision_note"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("clock_corrections_status_idx").on(t.status, t.createdAt),
      index("clock_corrections_employee_idx").on(t.employeeId, t.createdAt),
      check("clock_corrections_status_chk", sql`${t.status} in ('pending','approved','rejected','cancelled')`),
    ],
  )
  .enableRLS();

/** Rebuilt from the clock events every night (never edited by hand). One row per person and day. */
export const attendanceDays = time
  .table(
    "attendance_days",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      /** The calendar day of the clock-in in the person's own time zone. */
      date: date("date", { mode: "string" }).notNull(),
      sessions: integer("sessions").notNull().default(0),
      workedMinutes: integer("worked_minutes").notNull().default(0),
      breakMinutes: integer("break_minutes").notNull().default(0),
      firstIn: timestamp("first_in", { withTimezone: true }),
      lastOut: timestamp("last_out", { withTimezone: true }),
      /** Flags: open_session, outside_range, corrected, idle_unanswered, on_leave. Late, overtime and absence arrive with schedules. */
      flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
      builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("attendance_days_unique_idx").on(t.employeeId, t.date), index("attendance_days_date_idx").on(t.date)],
  )
  .enableRLS();

/** One row per open session already reported as a missed clock-out, so the notice goes out once. */
export const missedClockoutNotices = time
  .table("missed_clockout_notices", {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => clockEvents.id),
    noticedAt: timestamp("noticed_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();
