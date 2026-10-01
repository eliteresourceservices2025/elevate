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
