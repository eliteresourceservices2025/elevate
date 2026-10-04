import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ops } from "@/modules/audit/schema";
import { users } from "@/modules/core/schema";
import { employees } from "@/modules/people/schema";

// Imports from TalentHR (Phase 5). A file is staged into a batch first (the quarantine: nothing else in the app reads it), checked, and
// only then committed. Raw rows hold personal data, so each is encrypted (context "import_row:<batch>:<row>") and wiped as soon as the
// batch is committed or discarded. What stays is counts, outcomes and field names, never values.

export const importBatches = ops
  .table(
    "import_batches",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      kind: text("kind").notNull().default("talenthr_csv"),
      /** The file's name as shown to HR (no path). */
      fileName: text("file_name").notNull(),
      status: text("status").notNull().default("preview"),
      dateFormat: text("date_format").notNull().default("mdy"),
      /** column header -> destination. Saved so the next dry run starts from the same choices. */
      mapping: jsonb("mapping").$type<Record<string, string>>().notNull(),
      rowCount: integer("row_count").notNull(),
      summary: jsonb("summary").$type<Record<string, number>>().notNull().default({}),
      createdBy: uuid("created_by").references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      committedBy: uuid("committed_by").references(() => users.id),
      committedAt: timestamp("committed_at", { withTimezone: true }),
      rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
      /** HR's sign-off of the reconciliation for this batch. */
      signedOffBy: uuid("signed_off_by").references(() => users.id),
      signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
    },
    (t) => [
      index("import_batches_created_idx").on(t.createdAt),
      check("import_batches_status_chk", sql`${t.status} in ('preview','committed','rolled_back','discarded')`),
      check("import_batches_date_format_chk", sql`${t.dateFormat} in ('mdy','dmy','iso')`),
    ],
  )
  .enableRLS();

export const importRows = ops
  .table(
    "import_rows",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      batchId: uuid("batch_id")
        .notNull()
        .references(() => importBatches.id),
      rowNo: integer("row_no").notNull(),
      outcome: text("outcome").notNull(),
      /** Names of fields that differ from the existing person (never values). */
      changedFields: text("changed_fields").array().notNull().default(sql`'{}'::text[]`),
      /** { level, field, message } without personal data. */
      issues: jsonb("issues").$type<{ level: string; field: string; message: string }[]>().notNull().default([]),
      /** The normalized row, encrypted. Null once the batch is committed or discarded. */
      payloadEnc: text("payload_enc"),
      employeeId: uuid("employee_id").references(() => employees.id),
      /** True when this batch created the person (so a rollback may archive them). */
      created: text("created").notNull().default("no"),
      state: text("state").notNull().default("staged"),
    },
    (t) => [
      uniqueIndex("import_rows_batch_row_idx").on(t.batchId, t.rowNo),
      index("import_rows_employee_idx").on(t.employeeId),
      check("import_rows_outcome_chk", sql`${t.outcome} in ('new','changed','unchanged','error')`),
      check("import_rows_created_chk", sql`${t.created} in ('yes','no')`),
      check("import_rows_state_chk", sql`${t.state} in ('staged','committed','skipped','rolled_back','kept')`),
    ],
  )
  .enableRLS();

// A pull from TalentHR's API (Phase 5, part 2): what the CSV export lacks. Documents become real documents of the person; leave history
// and applicants are archived as encrypted files (they are not loaded into leave or recruiting). One row per source item, so a second run
// skips what was already imported.
export const importPulls = ops
  .table(
    "import_pulls",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      status: text("status").notNull().default("running"),
      dryRun: text("dry_run").notNull().default("no"),
      startedBy: uuid("started_by").references(() => users.id),
      startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
      finishedAt: timestamp("finished_at", { withTimezone: true }),
      summary: jsonb("summary").$type<Record<string, number>>().notNull().default({}),
    },
    (t) => [check("import_pulls_status_chk", sql`${t.status} in ('running','done','failed')`), check("import_pulls_dry_chk", sql`${t.dryRun} in ('yes','no')`)],
  )
  .enableRLS();

export const importPullItems = ops
  .table(
    "import_pull_items",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      pullId: uuid("pull_id")
        .notNull()
        .references(() => importPulls.id),
      /** document, leave_history or applicants */
      kind: text("kind").notNull(),
      /** The id in TalentHR (a document id, an employee id, or "all"). */
      sourceId: text("source_id").notNull(),
      employeeId: uuid("employee_id").references(() => employees.id),
      /** imported, archived, duplicate, skipped or failed */
      outcome: text("outcome").notNull(),
      /** A short code such as too_large, type_not_allowed, download_failed. Never a file name or a value. */
      reason: text("reason"),
      sha256: text("sha256"),
      /** The archived JSON, encrypted (context "import_pull:<kind>:<source>"). Only for leave_history and applicants. */
      payloadEnc: text("payload_enc"),
    },
    (t) => [
      index("import_pull_items_pull_idx").on(t.pullId),
      index("import_pull_items_employee_idx").on(t.employeeId),
      uniqueIndex("import_pull_items_done_idx").on(t.kind, t.sourceId).where(sql`${t.outcome} in ('imported','archived')`),
      check("import_pull_items_kind_chk", sql`${t.kind} in ('document','leave_history','applicants')`),
      check("import_pull_items_outcome_chk", sql`${t.outcome} in ('imported','archived','duplicate','skipped','failed')`),
    ],
  )
  .enableRLS();

// Go-live checklist: the manual steps HR ticks off (the automatic ones are computed). One row per item key.
export const goLiveItems = ops
  .table("golive_items", {
    key: text("key").primaryKey(),
    doneBy: uuid("done_by").references(() => users.id),
    doneAt: timestamp("done_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  })
  .enableRLS();
