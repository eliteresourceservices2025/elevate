import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgSchema, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { clients, employees } from "@/modules/people/schema";

// Payroll: figures prepared and checked here, paid elsewhere. Nothing here computes tax or sends money.
// Every amount, reason, hash and reference is encrypted (AES-256-GCM, `fieldCrypto()`); the context string is
// "<table>:<row id>", so ids are generated in the app and the context is known before insert.
// Append-only tables are enforced by database triggers (see the payroll triggers migration); a run's rows freeze once it leaves draft.

export const payroll = pgSchema("payroll");

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Append-only: a change is a new row with a later `effective_from`; the newest row at or before a date applies. */
export const paySettings = payroll
  .table(
    "pay_settings",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      effectiveFrom: date("effective_from").notNull(),
      cutoffDivisor: smallint("cutoff_divisor").notNull(),
      /** Overtime (OT) rates in basis points: 12500 = 1.25x. Null until counsel/owner supplies the rate. Holiday pay is always 1 to 1 and is not a setting. */
      extraRegularBp: integer("extra_regular_bp"),
      extraRestDayBp: integer("extra_rest_day_bp"),
      extraRestDayOver8Bp: integer("extra_rest_day_over_8_bp"),
      changeWarnBp: integer("change_warn_bp").notNull(),
      createdBy: uuid("created_by").references(() => users.id),
      createdAt: createdAt(),
    },
    (t) => [check("pay_settings_divisor_chk", sql`${t.cutoffDivisor} > 0`)],
  )
  .enableRLS();

/** Append-only. A new version of a line shares the `line_key`; `amounts_enc` holds { monthlyCentavos } as a string (pesos only). */
export const payLines = payroll
  .table(
    "pay_lines",
    {
      id: uuid("id").primaryKey(),
      lineKey: uuid("line_key").notNull(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      clientId: uuid("client_id").references(() => clients.id),
      alias: text("alias"),
      hoursPerDay: smallint("hours_per_day").notNull(),
      paymentMethod: text("payment_method").notNull().default("remitly"),
      endsOn: date("ends_on"),
      effectiveFrom: date("effective_from").notNull(),
      amountsEnc: text("amounts_enc").notNull(),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      // clock_timestamp(), not now(): ordering of versions on the same date follows the order the advisory lock let them in.
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    },
    (t) => [
      index("pay_lines_employee_idx").on(t.employeeId, t.effectiveFrom),
      index("pay_lines_key_idx").on(t.lineKey, t.effectiveFrom),
      check("pay_lines_hours_chk", sql`${t.hoursPerDay} between 1 and 12`),
      check("pay_lines_ends_chk", sql`${t.endsOn} is null or ${t.endsOn} >= ${t.effectiveFrom}`),
    ],
  )
  .enableRLS();

/** Status moves only draft -> in_review -> (draft | approved) -> paid, or draft -> cancelled (a cancelled run is frozen, never deleted), by trigger. The rate and snapshot change only in draft. */
export const payRuns = payroll
  .table(
    "pay_runs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      periodStart: date("period_start").notNull(),
      periodEnd: date("period_end").notNull(),
      status: text("status").notNull().default("draft"),
      settingsSnapshot: jsonb("settings_snapshot").notNull(),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      submittedBy: uuid("submitted_by").references(() => users.id),
      decidedBy: uuid("decided_by").references(() => users.id),
      /** A practice run: it does not take the period of a real run, never reaches a person's statements, and can be archived once approved. */
      isTest: boolean("is_test").notNull().default(false),
      /** Set only on a test run (a trigger refuses it on a real one). An archived run is hidden from the lists but stays on record. */
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      archivedBy: uuid("archived_by").references(() => users.id),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("pay_runs_period_idx").on(t.periodStart, t.periodEnd).where(sql`${t.status} <> 'cancelled' and not ${t.isTest}`),
      check("pay_runs_status_chk", sql`${t.status} in ('draft','in_review','approved','paid','cancelled')`),
      check("pay_runs_period_chk", sql`${t.periodEnd} >= ${t.periodStart}`),
    ],
  )
  .enableRLS();

/** Frozen with the run once it leaves draft. `payload_enc` is the computed pay for the line. */
export const payRunLines = payroll
  .table(
    "pay_run_lines",
    {
      id: uuid("id").primaryKey(),
      runId: uuid("run_id")
        .notNull()
        .references(() => payRuns.id),
      lineId: uuid("line_id")
        .notNull()
        .references(() => payLines.id),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      clientId: uuid("client_id").references(() => clients.id),
      alias: text("alias"),
      flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
      /** Taken off a draft run by a Preparer (or because the pay line is no longer in force). Items are append-only, so the line stays; every reader ignores it. */
      excluded: boolean("excluded").notNull().default(false),
      payloadEnc: text("payload_enc").notNull(),
      confirmedBy: uuid("confirmed_by").references(() => users.id),
      confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    },
    (t) => [index("pay_run_lines_run_idx").on(t.runId), uniqueIndex("pay_run_lines_run_line_idx").on(t.runId, t.lineId)],
  )
  .enableRLS();

/** Append-only: changing an item is a new row; the newest per line and type wins (a loan on one line never replaces another line's). `value_enc` includes the reason. */
export const payRunItems = payroll
  .table(
    "pay_run_items",
    {
      id: uuid("id").primaryKey(),
      runId: uuid("run_id")
        .notNull()
        .references(() => payRuns.id),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      runLineId: uuid("run_line_id").references(() => payRunLines.id),
      type: text("type").notNull(),
      /** Names one itemized line (an allowance, reimbursement, bonus or adjustment); null for every other type, which has one value per line. */
      itemKey: uuid("item_key"),
      state: text("state").notNull(),
      valueEnc: text("value_enc").notNull(),
      enteredBy: uuid("entered_by")
        .notNull()
        .references(() => users.id),
      createdAt: createdAt(),
    },
    (t) => [
      index("pay_run_items_run_idx").on(t.runId, t.employeeId, t.runLineId, t.type, t.createdAt),
      check("pay_run_items_state_chk", sql`${t.state} in ('suggested','confirmed','dismissed')`),
    ],
  )
  .enableRLS();

/** Append-only. `run_hash_enc` is encrypted on purpose: a plain hash of a small total can be guessed by anyone who can read the table. */
export const payApprovals = payroll
  .table(
    "pay_approvals",
    {
      id: uuid("id").primaryKey(),
      runId: uuid("run_id")
        .notNull()
        .references(() => payRuns.id),
      decision: text("decision").notNull(),
      runHashEnc: text("run_hash_enc").notNull(),
      noteEnc: text("note_enc"),
      decidedBy: uuid("decided_by")
        .notNull()
        .references(() => users.id),
      createdAt: createdAt(),
    },
    (t) => [index("pay_approvals_run_idx").on(t.runId, t.createdAt), check("pay_approvals_decision_chk", sql`${t.decision} in ('approved','sent_back')`)],
  )
  .enableRLS();

/** Append-only; the newest row per run and person wins. Records that someone was paid elsewhere; nothing here sends money. */
export const payPayments = payroll
  .table(
    "pay_payments",
    {
      id: uuid("id").primaryKey(),
      runId: uuid("run_id")
        .notNull()
        .references(() => payRuns.id),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      referenceEnc: text("reference_enc").notNull(),
      paidOn: date("paid_on").notNull(),
      markedBy: uuid("marked_by")
        .notNull()
        .references(() => users.id),
      createdAt: createdAt(),
    },
    (t) => [index("pay_payments_run_idx").on(t.runId, t.employeeId, t.createdAt)],
  )
  .enableRLS();

/** Append-only. Ids and an action name in the clear; anything else (amounts, reasons) only inside `detail_enc`. */
export const payChangeLog = payroll
  .table(
    "pay_change_log",
    {
      id: uuid("id").primaryKey(),
      actorId: uuid("actor_id")
        .notNull()
        .references(() => users.id),
      action: text("action").notNull(),
      runId: uuid("run_id").references(() => payRuns.id),
      employeeId: uuid("employee_id").references(() => employees.id),
      lineKey: uuid("line_key"),
      detailEnc: text("detail_enc").notNull(),
      /** Set only for run_viewed, so a person opening a run many times in a day leaves one row. */
      viewDay: date("view_day"),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("pay_change_log_view_idx").on(t.actorId, t.runId, t.viewDay).where(sql`${t.viewDay} is not null`),
      index("pay_change_log_run_idx").on(t.runId, t.createdAt),
    ],
  )
  .enableRLS();

/**
 * Who signs the payslips (the Human Resources Director): append-only versions, so a change is a new row and an old one never changes.
 * The signature is a small JPEG, kept as base64 inside `signature_enc` (context `pay_signatory:<id>`). Only a Super Admin writes it.
 */
export const paySignatory = payroll
  .table(
    "pay_signatory",
    {
      id: uuid("id").primaryKey(),
      name: text("name").notNull(),
      title: text("title").notNull(),
      signatureEnc: text("signature_enc"),
      createdBy: uuid("created_by").references(() => users.id),
      // clock_timestamp(), not now(): the newest version is picked by this, so it must follow the order the saves were made in.
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
    },
    (t) => [check("pay_signatory_text_chk", sql`char_length(${t.name}) between 1 and 120 and char_length(${t.title}) between 1 and 120`)],
  )
  .enableRLS();

/** Append-only. The signatory version in force when the run became paid, kept so a payslip never changes. No row: it was paid unsigned. */
export const payRunSignatures = payroll
  .table("pay_run_signatures", {
    runId: uuid("run_id")
      .primaryKey()
      .references(() => payRuns.id),
    signatoryId: uuid("signatory_id")
      .notNull()
      .references(() => paySignatory.id),
    signedOn: date("signed_on").notNull(),
    createdAt: createdAt(),
  })
  .enableRLS();

/**
 * Append-only. The moment an Approver released a run's contractor payment statements to the people on it (one row per run). A person sees
 * their statement only when the run is a real run with a row here; nothing else makes a statement visible to them.
 */
export const payRunReleases = payroll
  .table("pay_run_releases", {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .unique()
      .references(() => payRuns.id),
    releasedBy: uuid("released_by")
      .notNull()
      .references(() => users.id),
    peopleCount: integer("people_count").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  })
  .enableRLS();

/**
 * The Jibble timesheet a Preparer uploaded to fill a draft run: one encrypted payload (member names and codes, and daily totals, never clock
 * times), wiped when it is used or discarded and after 14 days. One per run (a new upload replaces the old one).
 */
export const timesheetImports = payroll
  .table(
    "timesheet_imports",
    {
      id: uuid("id").primaryKey(),
      runId: uuid("run_id")
        .notNull()
        .references(() => payRuns.id),
      payloadEnc: text("payload_enc").notNull(),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      createdAt: createdAt(),
    },
    (t) => [index("timesheet_imports_run_idx").on(t.runId)],
  )
  .enableRLS();

/** Which pay line a Jibble member (by member code, like "AVL-1") belongs to, remembered from earlier imports so the next sheet matches by itself. */
export const jibbleMatches = payroll
  .table(
    "jibble_matches",
    {
      memberCode: text("member_code").primaryKey(),
      lineKey: uuid("line_key").notNull(),
      updatedBy: uuid("updated_by")
        .notNull()
        .references(() => users.id),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("jibble_matches_code_chk", sql`char_length(${t.memberCode}) between 1 and 40`)],
  )
  .enableRLS();
