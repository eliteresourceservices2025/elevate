import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ops } from "@/modules/audit/schema";
import { users } from "@/modules/core/schema";
import { clients, employees } from "@/modules/people/schema";

// Attendance-sheet uploads for the schedules and clients import (phase 1: preview only). The sheet's rows hold names, so they are kept
// as ONE encrypted payload (context "schedule_import:<batch id>"), removed when the batch is discarded and after 14 days. What stays is
// counts and the file's name, never a value. Nothing reads this table except the import pages (HR and Super Admin).
export const scheduleImportBatches = ops
  .table(
    "schedule_import_batches",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      fileName: text("file_name").notNull(),
      layout: text("layout").notNull(),
      /** For a plain table: which column is the name, client, schedule, date and clock-in (indexes). Null for day blocks. */
      columns: jsonb("columns").$type<Record<string, number | null>>(),
      sourceSha256: text("source_sha256").notNull(),
      observationCount: integer("observation_count").notNull(),
      pairCount: integer("pair_count").notNull(),
      /** The observations read from the sheet, encrypted. Null once discarded or purged. */
      payloadEnc: text("payload_enc"),
      status: text("status").notNull().default("preview"),
      createdBy: uuid("created_by").references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      discardedAt: timestamp("discarded_at", { withTimezone: true }),
      appliedAt: timestamp("applied_at", { withTimezone: true }),
      appliedBy: uuid("applied_by").references(() => users.id),
      /** Counts of what the apply did (never names). */
      result: jsonb("result").$type<Record<string, number>>(),
    },
    (t) => [
      index("schedule_import_batches_created_idx").on(t.createdAt),
      check("schedule_import_batches_status_chk", sql`${t.status} in ('preview','discarded','applied')`),
      check("schedule_import_batches_layout_chk", sql`${t.layout} in ('day_blocks','table')`),
    ],
  )
  .enableRLS();

// Matches HR confirmed once, so the next sheet does not ask again: a sheet's spelling of a person or a client, mapped to the real record.
// The key is the normalized spelling (name words sorted, or the client name without case and punctuation), not the raw cell.
export const scheduleImportAliases = ops
  .table(
    "schedule_import_aliases",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      kind: text("kind").notNull(),
      sheetKey: text("sheet_key").notNull(),
      employeeId: uuid("employee_id").references(() => employees.id),
      clientId: uuid("client_id").references(() => clients.id),
      createdBy: uuid("created_by").references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("schedule_import_aliases_key_idx").on(t.kind, t.sheetKey),
      check("schedule_import_aliases_kind_chk", sql`${t.kind} in ('person','client')`),
      check(
        "schedule_import_aliases_target_chk",
        sql`(${t.kind} = 'person' and ${t.employeeId} is not null and ${t.clientId} is null) or (${t.kind} = 'client' and ${t.clientId} is not null and ${t.employeeId} is null)`,
      ),
    ],
  )
  .enableRLS();

// Which column is which, remembered per sheet layout (by its header row), so a repeat upload of the same table needs no choices.
export const scheduleImportLayouts = ops
  .table(
    "schedule_import_layouts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** SHA-256 of the normalized header row. */
      headerKey: text("header_key").notNull(),
      columns: jsonb("columns").$type<Record<string, number | null>>().notNull(),
      createdBy: uuid("created_by").references(() => users.id),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("schedule_import_layouts_header_idx").on(t.headerKey)],
  )
  .enableRLS();
