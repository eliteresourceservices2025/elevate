import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { clockEvents } from "@/modules/attendance/schema";
import { employees } from "@/modules/people/schema";
import { time } from "@/modules/timeoff/schema";

// The Jibble link (B2). Jibble only takes screenshots; ELEVATE is the time clock. Nothing from Jibble except
// daily tracked-minute totals (for the nightly comparison) is stored here: never screenshots, GPS or activity.

/** Which Jibble account is each person. Matched by work email or set by hand by HR. */
export const jibblePeople = time
  .table(
    "jibble_people",
    {
      employeeId: uuid("employee_id")
        .primaryKey()
        .references(() => employees.id),
      jibblePersonId: text("jibble_person_id").notNull(),
      matchedBy: text("matched_by").notNull(),
      matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("jibble_people_jibble_idx").on(t.jibblePersonId), check("jibble_people_matched_chk", sql`${t.matchedBy} in ('email','manual')`)],
  )
  .enableRLS();

export const LINK_STATUSES = ["queued", "sent", "failed", "skipped"] as const;

/** Durable per-person reservation for Jibble work. A stranded reservation is never automatically stolen. */
export const jibbleOperationGuard = time
  .table(
    "jibble_operation_guard",
    {
      employeeId: uuid("employee_id").primaryKey().references(() => employees.id),
      token: uuid("token").notNull(),
      kind: text("kind").notNull().default("send"),
      action: text("action"),
      logId: uuid("log_id"),
      requestId: uuid("request_id"),
      jibblePersonId: text("jibble_person_id"),
      phase: text("phase").notNull().default("claimed"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("jibble_operation_guard_phase_chk", sql`${t.phase} in ('claimed','in_flight','uncertain')`), check("jibble_operation_guard_kind_chk", sql`${t.kind} in ('send','repair','reconcile')`), check("jibble_operation_guard_action_chk", sql`${t.action} is null or ${t.action} in ('In','Out','StartBreak','EndBreak')`)],
  )
  .enableRLS();

/** An ongoing mismatch is separate from the delivery history and is retained after it closes. */
export const jibbleMismatch = time
  .table(
    "jibble_mismatches",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id").notNull().references(() => employees.id),
      kind: text("kind").notNull(),
      family: text("family").notNull().default("working"),
      jibbleEntryId: text("jibble_entry_id"),
      jibbleEntryTime: timestamp("jibble_entry_time", { withTimezone: true }),
      firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
      lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
      resolvedAt: timestamp("resolved_at", { withTimezone: true }),
      resolvedBy: uuid("resolved_by"),
      resolution: text("resolution"),
    },
    (t) => [
      uniqueIndex("jibble_mismatch_open_idx").on(t.employeeId, t.family).where(sql`${t.resolvedAt} is null`),
      check("jibble_mismatch_kind_chk", sql`${t.kind} in ('working_jibble_out','working_jibble_break','possible_jibble_only','elevate_out_jibble_in')`),
      check("jibble_mismatch_family_chk", sql`(${t.family} = 'working' and ${t.kind} in ('working_jibble_out','working_jibble_break')) or (${t.family} = 'out' and ${t.kind} in ('possible_jibble_only','elevate_out_jibble_in'))`),
    ],
  )
  .enableRLS();

/** Records who was notified for an incident so later changes to the reporting line can be handled without duplicates. */
export const jibbleMismatchNotice = time
  .table(
    "jibble_mismatch_notices",
    {
      mismatchId: uuid("mismatch_id").notNull().references(() => jibbleMismatch.id),
      userId: uuid("user_id").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("jibble_mismatch_notice_unique_idx").on(t.mismatchId, t.userId)],
  )
  .enableRLS();

/** Minimal cursor state used to rotate periodic checks across eligible people. */
export const jibbleCheckCursor = time
  .table("jibble_check_cursor", {
    employeeId: uuid("employee_id").primaryKey().references(() => employees.id, { onDelete: "cascade" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  })
  .enableRLS();

/** One row per call to Jibble: written in the same transaction as the clock event, sent later, retried, never lost. */
export const jibbleLinkLog = time
  .table(
    "jibble_link_log",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      /** The ELEVATE clock event this call mirrors; empty for a repair call that puts Jibble back in step with ELEVATE. */
      eventId: uuid("event_id").references(() => clockEvents.id),
      /** event = mirrors a clock click; repair = sent by the repair job because Jibble was out of step. */
      source: text("source").notNull().default("event"),
      /** A break start that could not use a Jibble break and clocked the person out instead (so its end clocks them back in). */
      fallback: boolean("fallback").notNull().default(false),
      /** In, Out, StartBreak or EndBreak. */
      action: text("action").notNull(),
      status: text("status").notNull().default("queued"),
      attempts: smallint("attempts").notNull().default(0),
      nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
      /** A short code and HTTP status only: never a response body, token or name. */
      lastError: text("last_error"),
      jibbleEntryId: text("jibble_entry_id"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      sentAt: timestamp("sent_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("jibble_link_log_event_idx").on(t.eventId),
      index("jibble_link_log_due_idx").on(t.status, t.nextAttemptAt),
      index("jibble_link_log_employee_idx").on(t.employeeId, t.createdAt),
      check("jibble_link_log_status_chk", sql`${t.status} in ('queued','sent','failed','skipped')`),
      check("jibble_link_log_action_chk", sql`${t.action} in ('In','Out','StartBreak','EndBreak')`),
      check("jibble_link_log_source_chk", sql`${t.source} in ('event','repair')`),
    ],
  )
  .enableRLS();

/** Review metadata is separate from the immutable historical delivery outcome. */
export const jibbleCallReviews = time
  .table(
    "jibble_call_reviews",
    {
      logId: uuid("log_id").primaryKey().references(() => jibbleLinkLog.id, { onDelete: "cascade" }),
      reviewedBy: uuid("reviewed_by").notNull(),
      reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
    },
  )
  .enableRLS();

/** Tracked minutes in Jibble next to ELEVATE's worked minutes for one day. Only totals; kept 35 days; never used for hours. */
export const jibbleDaily = time
  .table(
    "jibble_daily",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      date: date("date", { mode: "string" }).notNull(),
      jibbleMinutes: integer("jibble_minutes").notNull(),
      elevateMinutes: integer("elevate_minutes").notNull(),
      flagged: boolean("flagged").notNull().default(false),
      comparedAt: timestamp("compared_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("jibble_daily_unique_idx").on(t.employeeId, t.date), index("jibble_daily_date_idx").on(t.date)],
  )
  .enableRLS();

/** One row: HR's pause switch. While paused nothing is sent to Jibble (calls wait in the queue). */
export const jibbleSettings = time
  .table(
    "jibble_settings",
    {
      id: smallint("id").primaryKey().default(1),
      paused: boolean("paused").notNull().default(false),
      pausedBy: uuid("paused_by"),
      pausedAt: timestamp("paused_at", { withTimezone: true }),
    },
    (t) => [check("jibble_settings_single_chk", sql`${t.id} = 1`)],
  )
  .enableRLS();
