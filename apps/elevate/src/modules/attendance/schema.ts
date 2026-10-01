import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, numeric, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { teams } from "@/modules/org/schema";
import { clients, employees } from "@/modules/people/schema";
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
      /** Break starts only: the length the person chose (15, 30 or 60 minutes), or null for an open-ended break. */
      plannedBreakMinutes: smallint("planned_break_minutes"),
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
      check("clock_events_planned_chk", sql`${t.plannedBreakMinutes} is null or (${t.type} = 'break_start' and ${t.plannedBreakMinutes} in (15, 30, 60))`),
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
    /** Whether the team is expected to write an end-of-day report. Only flags a missing one; never blocks clocking out. */
    eodExpected: boolean("eod_expected").notNull().default(false),
    /** Use Jibble screenshots for this team: ELEVATE tells Jibble when each person clocks in and out, and compares totals nightly. Needs the monitoring policy. */
    jibbleMirror: boolean("jibble_mirror").notNull().default(false),
    /** Minutes after the shift start (or before its end) before a late arrival or early leave is flagged. */
    lateGraceMinutes: integer("late_grace_minutes").notNull().default(10),
    /** Most extra hours one person may be approved for in a day, and the total hours in a day past which a request shows a warning. */
    maxExtraMinutesPerDay: integer("max_extra_minutes_per_day").notNull().default(240),
    maxDayMinutes: integer("max_day_minutes").notNull().default(720),
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

export const CLAIM_KINDS = ["forgot", "connection_problem", "device_problem", "other"] as const;
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
      /** Why it is needed: forgot, connection_problem, device_problem or other. */
      kind: text("kind").notNull().default("other"),
      /** Set when the reviewer changed the times before approving: what the person first asked for. */
      originalProposed: jsonb("original_proposed").$type<{ type: string; at: string }[]>(),
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
      check("clock_corrections_kind_chk", sql`${t.kind} in ('forgot','connection_problem','device_problem','other')`),
    ],
  )
  .enableRLS();

/**
 * A person's shift pattern, in the schedule's (client's) time zone. Changes are new rows: setting a new schedule closes the
 * previous one the day before. Two schedules for one person can never overlap (exclusion constraint in the migration).
 */
export const schedules = time
  .table(
    "schedules",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
      effectiveTo: date("effective_to", { mode: "string" }),
      startTime: text("start_time").notNull(),
      endTime: text("end_time").notNull(),
      /** ISO weekdays worked: 1 = Monday ... 7 = Sunday. The others are rest days. */
      weekdays: smallint("weekdays").array().notNull(),
      breakMinutes: smallint("break_minutes").notNull().default(0),
      zone: text("zone").notNull(),
      createdBy: uuid("created_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("schedules_employee_idx").on(t.employeeId, t.effectiveFrom),
      check("schedules_dates_chk", sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`),
      check("schedules_times_chk", sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${t.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
      check("schedules_weekdays_chk", sql`cardinality(${t.weekdays}) between 1 and 7 and ${t.weekdays} <@ array[1,2,3,4,5,6,7]::smallint[]`),
      check("schedules_break_chk", sql`${t.breakMinutes} between 0 and 240`),
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
      /** Minutes spent past the chosen length on timed breaks. */
      overbreakMinutes: integer("overbreak_minutes").notNull().default(0),
      /** From the person's schedule (null when they have none): the shift's hours minus its planned break, and what the day did against it. */
      scheduledMinutes: integer("scheduled_minutes"),
      lateMinutes: integer("late_minutes").notNull().default(0),
      earlyLeaveMinutes: integer("early_leave_minutes").notNull().default(0),
      /** Worked time beyond the scheduled hours (a rest day or holiday counts in full). */
      extraMinutes: integer("extra_minutes").notNull().default(0),
      /** The part of the extra time covered by approved extra hours requests; the rest is unapproved. */
      approvedExtraMinutes: integer("approved_extra_minutes").notNull().default(0),
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

/** One row per break that went over its chosen length and was reported to the lead, so it is reported once. */
export const overbreakNotices = time
  .table("overbreak_notices", {
    /** The break_start event. */
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => clockEvents.id),
    minutesOver: integer("minutes_over").notNull(),
    noticedAt: timestamp("noticed_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();

/** The last moment a clocked-in person's page reported "still here". One row per person, no history. */
export const clockPresence = time
  .table("clock_presence", {
    employeeId: uuid("employee_id")
      .primaryKey()
      .references(() => employees.id),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();

/** One row per open session already reported as "not seen for a while", so the lead hears once. */
export const quietNotices = time
  .table("quiet_notices", {
    eventId: uuid("event_id")
      .primaryKey()
      .references(() => clockEvents.id),
    noticedAt: timestamp("noticed_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();

export const EXTRA_STATUSES = ["pending_lead", "pending_confirm", "approved", "declined", "cancelled"] as const;

/**
 * A request to work extra hours for a client. The VA asks (client approval shown as proof, then the lead decides), or the lead
 * or HR files it because the client asked (the VA then confirms or declines). Two live requests for one person cannot overlap
 * (exclusion constraint in the migration).
 */
export const extraHoursRequests = time
  .table(
    "extra_hours_requests",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id),
      /** va = the VA asked; client = the client asked and a lead or HR filed it. */
      source: text("source").notNull(),
      status: text("status").notNull().default("pending_lead"),
      windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
      windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
      /** Set when the reviewer changed the window before approving: what was first asked for. */
      originalWindowStart: timestamp("original_window_start", { withTimezone: true }),
      originalWindowEnd: timestamp("original_window_end", { withTimezone: true }),
      minutes: integer("minutes").notNull(),
      /** Who at the client approved or asked (free text; ELEVATE holds no client contacts). */
      contactName: text("contact_name").notNull(),
      reason: text("reason").notNull(),
      /** The window had already started when it was asked for. */
      afterTheFact: boolean("after_the_fact").notNull().default(false),
      /** A lead or HR vouches for the client's request without a screenshot. */
      confirmedByPhone: boolean("confirmed_by_phone").notNull().default(false),
      filedBy: uuid("filed_by").notNull(),
      decidedBy: uuid("decided_by"),
      decidedAt: timestamp("decided_at", { withTimezone: true }),
      decisionNote: text("decision_note"),
      remindedAt: timestamp("reminded_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("extra_hours_employee_idx").on(t.employeeId, t.windowStart),
      index("extra_hours_status_idx").on(t.status, t.createdAt),
      check("extra_hours_source_chk", sql`${t.source} in ('va','client')`),
      check("extra_hours_status_chk", sql`${t.status} in ('pending_lead','pending_confirm','approved','declined','cancelled')`),
      check("extra_hours_window_chk", sql`${t.windowEnd} > ${t.windowStart} and ${t.minutes} between 15 and 1440`),
      check("extra_hours_text_chk", sql`coalesce(length(trim(${t.reason})), 0) > 0 and coalesce(length(trim(${t.contactName})), 0) > 0`),
    ],
  )
  .enableRLS();

/** Screenshots a person attaches to a time claim. The file is deleted 90 days after the decision; the row stays. */
export const correctionEvidence = time
  .table(
    "correction_evidence",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      /** Null until the claim is submitted; an upload never attached is cleaned up after a day. */
      correctionId: uuid("correction_id").references(() => clockCorrections.id),
      /** Or to an extra hours request. At most one of the two. */
      extraRequestId: uuid("extra_request_id").references(() => extraHoursRequests.id),
      /** The sign-in account that uploaded it (a lead or HR uploads for someone else); null for older rows. */
      uploadedBy: uuid("uploaded_by"),
      storagePath: text("storage_path").notNull(),
      mime: text("mime").notNull(),
      sizeBytes: integer("size_bytes"),
      sha256: text("sha256"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      purgedAt: timestamp("purged_at", { withTimezone: true }),
    },
    (t) => [uniqueIndex("correction_evidence_path_idx").on(t.storagePath), index("correction_evidence_claim_idx").on(t.correctionId), check("correction_evidence_mime_chk", sql`${t.mime} in ('image/jpeg','image/png')`), check("correction_evidence_one_parent_chk", sql`not (${t.correctionId} is not null and ${t.extraRequestId} is not null)`), index("correction_evidence_extra_idx").on(t.extraRequestId)],
  )
  .enableRLS();

/** An end-of-day note on one session. Editable by its author for 24 hours after clock-out. */
export const shiftNotes = time
  .table(
    "shift_notes",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      /** The clock_in event that started the session. */
      sessionEventId: uuid("session_event_id")
        .notNull()
        .references(() => clockEvents.id),
      body: text("body").notNull(),
      edited: boolean("edited").notNull().default(false),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("shift_notes_session_idx").on(t.sessionEventId),
      index("shift_notes_employee_idx").on(t.employeeId, t.createdAt),
      check("shift_notes_body_chk", sql`char_length(trim(${t.body})) between 1 and 5000`),
    ],
  )
  .enableRLS();

/**
 * A lead's (or HR's) approval of one person's day. Append-only (trigger): it stores the numbers that were approved, so a later
 * correction shows as "changed after approval" and needs approving again. The latest row for a person and day is the current one.
 */
export const hoursApprovals = time
  .table(
    "hours_approvals",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      /** The calendar day in the person's own zone (the day the session started). */
      date: date("date", { mode: "string" }).notNull(),
      scheduledMinutes: integer("scheduled_minutes"),
      workedMinutes: integer("worked_minutes").notNull(),
      breakMinutes: integer("break_minutes").notNull(),
      extraMinutes: integer("extra_minutes").notNull(),
      approvedExtraMinutes: integer("approved_extra_minutes").notNull(),
      approvedBy: uuid("approved_by").notNull(),
      note: text("note"),
      approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("hours_approvals_employee_idx").on(t.employeeId, t.date, t.approvedAt), index("hours_approvals_date_idx").on(t.date)],
  )
  .enableRLS();

export const PAY_PERIOD_KINDS = ["semi_monthly", "weekly", "biweekly", "monthly"] as const;

/** One row: how HR's pay periods are cut, for the hours export. */
export const hoursSettings = time
  .table(
    "hours_settings",
    {
      id: smallint("id").primaryKey().default(1),
      payPeriodKind: text("pay_period_kind").notNull().default("semi_monthly"),
      /** For every-two-weeks periods: the Monday a period starts on. */
      biweeklyAnchor: date("biweekly_anchor", { mode: "string" }).notNull().default("2026-01-05"),
      updatedBy: uuid("updated_by"),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("hours_settings_single_chk", sql`${t.id} = 1`), check("hours_settings_kind_chk", sql`${t.payPeriodKind} in ('semi_monthly','weekly','biweekly','monthly')`)],
  )
  .enableRLS();
