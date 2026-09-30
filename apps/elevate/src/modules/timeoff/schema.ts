import { sql } from "drizzle-orm";
import { boolean, check, date, index, numeric, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { employees } from "@/modules/people/schema";

// Time off (B1), shaped for 1099 contractors: no accrual. Days off exist as prizes HR awards, and every balance
// is the sum of the append-only ledger, so any number can be explained line by line.

export const time = pgSchema("time");

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const leaveTypes = time
  .table(
    "leave_types",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** Stable key used by code, e.g. "prize_day". */
      slug: text("slug").notNull(),
      name: text("name").notNull(),
      /** True: requests draw from a balance built from awards. False: tracked only (an unpaid day off). */
      tracksBalance: boolean("tracks_balance").notNull(),
      /** Phase 2.2: requests of this type skip HR's final approval. */
      skipHr: boolean("skip_hr").notNull().default(false),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [uniqueIndex("leave_types_slug_idx").on(t.slug), uniqueIndex("leave_types_name_idx").on(sql`lower(${t.name})`)],
  )
  .enableRLS();

export const LEDGER_ENTRY_TYPES = ["award", "usage", "reversal", "adjustment", "expiry", "opening_balance"] as const;

/**
 * Append-only (database trigger refuses UPDATE, DELETE and TRUNCATE). `days` is signed:
 * award +, usage -, reversal +, adjustment either way, expiry - (or 0 when nothing was left), opening_balance +.
 */
export const leaveLedger = time
  .table(
    "leave_ledger",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      leaveTypeId: uuid("leave_type_id")
        .notNull()
        .references(() => leaveTypes.id),
      entryType: text("entry_type").notNull(),
      days: numeric("days", { precision: 5, scale: 2 }).notNull(),
      /** Why: the game or event for an award, the reason for an adjustment. */
      reason: text("reason"),
      /** The company-calendar date the entry counts from. */
      effectiveOn: date("effective_on", { mode: "string" }).notNull(),
      /** Awards only: the last day the days can be used. */
      expiresOn: date("expires_on", { mode: "string" }),
      /** Expiry rows: the award they expire. */
      awardId: uuid("award_id"),
      /** Usage and reversal rows: the request (Phase 2.2). */
      requestId: uuid("request_id"),
      /** Null = the system (expiry job). */
      createdBy: uuid("created_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("leave_ledger_employee_idx").on(t.employeeId, t.leaveTypeId, t.effectiveOn),
      // An award expires at most once: the expiry job can run twice safely.
      uniqueIndex("leave_ledger_expiry_once_idx").on(t.awardId).where(sql`${t.entryType} = 'expiry'`),
      check("leave_ledger_type_chk", sql`${t.entryType} in ('award','usage','reversal','adjustment','expiry','opening_balance')`),
      check(
        "leave_ledger_sign_chk",
        sql`(${t.entryType} = 'award' and ${t.days} > 0)
         or (${t.entryType} = 'usage' and ${t.days} < 0)
         or (${t.entryType} = 'reversal' and ${t.days} > 0)
         or (${t.entryType} = 'adjustment' and ${t.days} <> 0)
         or (${t.entryType} = 'expiry' and ${t.days} <= 0)
         or (${t.entryType} = 'opening_balance' and ${t.days} >= 0)`,
      ),
      check("leave_ledger_expires_chk", sql`${t.expiresOn} is null or ${t.entryType} = 'award'`),
      check("leave_ledger_award_ref_chk", sql`(${t.entryType} = 'expiry') = (${t.awardId} is not null)`),
      check("leave_ledger_reason_chk", sql`${t.entryType} not in ('award','adjustment') or coalesce(length(trim(${t.reason})), 0) > 0`),
    ],
  )
  .enableRLS();

/** One row per award, so the 7-day "expiring soon" reminder goes out once. */
export const leaveExpiryReminders = time
  .table("leave_expiry_reminders", {
    awardId: uuid("award_id")
      .primaryKey()
      .references(() => leaveLedger.id),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();

export const HOLIDAY_CALENDARS = ["PH", "US"] as const;
export const HOLIDAY_KINDS = ["regular", "special_non_working", "special_working", "federal", "observed", "other"] as const;

export const holidays = time
  .table(
    "holidays",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      calendar: text("calendar").notNull(),
      date: date("date", { mode: "string" }).notNull(),
      name: text("name").notNull(),
      kind: text("kind").notNull().default("other"),
      /** False for dates entered from memory or a draft calendar: HR ticks it once checked against the official source. */
      verified: boolean("verified").notNull().default(false),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [
      uniqueIndex("holidays_unique_idx").on(t.calendar, t.date, sql`lower(${t.name})`),
      index("holidays_calendar_date_idx").on(t.calendar, t.date),
      check("holidays_calendar_chk", sql`${t.calendar} in ('PH','US')`),
      check("holidays_kind_chk", sql`${t.kind} in ('regular','special_non_working','special_working','federal','observed','other')`),
    ],
  )
  .enableRLS();

export const REQUEST_STATUSES = ["pending_lead", "pending_hr", "approved", "declined", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * A request for days off. pending_lead -> pending_hr -> approved, or declined / cancelled along the way.
 * Two live requests for the same person may not cover the same day (exclusion constraint in the migration).
 */
export const leaveRequests = time
  .table(
    "leave_requests",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      leaveTypeId: uuid("leave_type_id")
        .notNull()
        .references(() => leaveTypes.id),
      startDate: date("start_date", { mode: "string" }).notNull(),
      endDate: date("end_date", { mode: "string" }).notNull(),
      halfDay: boolean("half_day").notNull().default(false),
      /** Working days the request uses, counted when it was made (weekends and holidays excluded). */
      days: numeric("days", { precision: 5, scale: 2 }).notNull(),
      note: text("note"),
      status: text("status").notNull(),
      /** Who made the request: the person themselves, or HR filing for them. */
      filedBy: uuid("filed_by").notNull(),
      /** The company-calendar date the request entered its current pending step, for reminder timing. */
      stepStartedOn: date("step_started_on", { mode: "string" }).notNull(),
      remindedAt: timestamp("reminded_at", { withTimezone: true }),
      escalatedAt: timestamp("escalated_at", { withTimezone: true }),
      cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
      cancelledBy: uuid("cancelled_by"),
      cancelReason: text("cancel_reason"),
      ...stamps,
    },
    (t) => [
      index("leave_requests_employee_idx").on(t.employeeId, t.startDate),
      index("leave_requests_status_idx").on(t.status, t.stepStartedOn),
      check("leave_requests_status_chk", sql`${t.status} in ('pending_lead','pending_hr','approved','declined','cancelled')`),
      check("leave_requests_dates_chk", sql`${t.endDate} >= ${t.startDate}`),
      check("leave_requests_days_chk", sql`${t.days} > 0`),
      check("leave_requests_half_chk", sql`not ${t.halfDay} or (${t.startDate} = ${t.endDate} and ${t.days} = 0.5)`),
    ],
  )
  .enableRLS();

/** Insert-only (trigger): who decided what, at which level, and when. "escalated" is the system moving a stale request to HR. */
export const leaveApprovals = time
  .table(
    "leave_approvals",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      requestId: uuid("request_id")
        .notNull()
        .references(() => leaveRequests.id),
      level: text("level").notNull(),
      decision: text("decision").notNull(),
      /** Null when the system escalated. */
      decidedBy: uuid("decided_by"),
      note: text("note"),
      decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("leave_approvals_request_idx").on(t.requestId, t.decidedAt),
      check("leave_approvals_level_chk", sql`${t.level} in ('lead','hr')`),
      check("leave_approvals_decision_chk", sql`${t.decision} in ('approved','declined','escalated')`),
    ],
  )
  .enableRLS();
