import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, date, index, integer, smallint, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ops } from "@/modules/audit/schema";
import { SAFEVOICE_CATEGORIES, SAFEVOICE_OUTCOMES, SAFEVOICE_STATUSES } from "./constants";

// Safe Voice (D2). These tables hold NOTHING that identifies a reporter: no user id, no address, no device data, no file names, no
// exact times (only the UTC day). The reporter-facing Safe Voice app (apps/safe-voice) writes them through its own database role
// (`safevoice_app`); ELEVATE's handlers read and answer through another (`safevoice_handler`). Both roles, their grants and their
// row-level-security policies are in migration 0037. The case code is stored only as a keyed hash (HMAC with the pepper), and the
// passphrase as a salted scrypt hash wrapped in the same pepper, so a database dump cannot reveal either.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));
const utcDay = sql`(now() at time zone 'utc')::date`;

export const safevoiceReports = ops
  .table(
    "safevoice_reports",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** HMAC-SHA256(pepper, normalised case code): how a report is found, without storing the code. */
      codeHash: bytea("code_hash").notNull(),
      passSalt: bytea("pass_salt").notNull(),
      passHash: bytea("pass_hash").notNull(),
      category: text("category").notNull(),
      description: text("description").notNull(),
      status: text("status").notNull().default("new"),
      outcome: text("outcome"),
      /** The UTC day only: no time of day is stored anywhere, so a report cannot be matched to a moment. */
      createdDay: date("created_day", { mode: "string" }).notNull().default(utcDay),
      closedDay: date("closed_day", { mode: "string" }),
      /** Set by the handlers' job once handlers have been told (in-app, no content). */
      handlerNotified: boolean("handler_notified").notNull().default(false),
    },
    (t) => [
      uniqueIndex("safevoice_reports_code_hash_idx").on(t.codeHash),
      index("safevoice_reports_status_idx").on(t.status, t.createdDay),
      check("safevoice_reports_category_chk", sql`${t.category} in (${list(SAFEVOICE_CATEGORIES)})`),
      check("safevoice_reports_status_chk", sql`${t.status} in (${list(SAFEVOICE_STATUSES)})`),
      check("safevoice_reports_outcome_chk", sql`${t.outcome} is null or ${t.outcome} in (${list(SAFEVOICE_OUTCOMES)})`),
      check("safevoice_reports_closed_chk", sql`(${t.status} = 'closed') = (${t.outcome} is not null)`),
      check("safevoice_reports_description_chk", sql`char_length(${t.description}) between 1 and 8000`),
    ],
  )
  .enableRLS();

export const safevoiceMessages = ops
  .table(
    "safevoice_messages",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      reportId: uuid("report_id")
        .notNull()
        .references(() => safevoiceReports.id),
      /** Order inside a case (no timestamps to sort by). */
      seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
      author: text("author").notNull(),
      body: text("body").notNull(),
      sentDay: date("sent_day", { mode: "string" }).notNull().default(utcDay),
      /** Reporter messages only: handlers have been told. */
      handlerNotified: boolean("handler_notified").notNull().default(false),
    },
    (t) => [
      index("safevoice_messages_report_idx").on(t.reportId, t.seq),
      check("safevoice_messages_author_chk", sql`${t.author} in ('reporter','handler')`),
      check("safevoice_messages_body_chk", sql`char_length(${t.body}) between 1 and 8000`),
    ],
  )
  .enableRLS();

/** Files are re-encoded or rebuilt by the Safe Voice app first, and are kept here (not in storage) so no file name, upload time or storage metadata exists. */
export const safevoiceAttachments = ops
  .table(
    "safevoice_attachments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      reportId: uuid("report_id")
        .notNull()
        .references(() => safevoiceReports.id),
      messageId: uuid("message_id").references(() => safevoiceMessages.id),
      position: smallint("position").notNull(),
      contentType: text("content_type").notNull(),
      sizeBytes: integer("size_bytes").notNull(),
      data: bytea("data").notNull(),
    },
    (t) => [
      index("safevoice_attachments_report_idx").on(t.reportId),
      check("safevoice_attachments_type_chk", sql`${t.contentType} in ('image/jpeg','image/png','application/pdf')`),
    ],
  )
  .enableRLS();
