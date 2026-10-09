import { sql } from "drizzle-orm";
import { check, date, index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { employees } from "@/modules/people/schema";
import { talent } from "@/modules/recruiting/schema";

// Certificates and training that expire (for example a HIPAA awareness certificate): who holds it and when it ends, so ELEVATE can
// remind the person and HR. Only a name and dates are kept: no certificate file, no price, no ID number. Records are archived, never
// deleted. A renewed certificate is a new row with a later end date; the older row stays as history.

export const credentials = talent
  .table(
    "credentials",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      name: text("name").notNull(),
      issuedOn: date("issued_on", { mode: "string" }),
      expiresOn: date("expires_on", { mode: "string" }).notNull(),
      /** manual = typed in by HR; talenthr = loaded from the TalentHR assets file. */
      source: text("source").notNull().default("manual"),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      createdBy: uuid("created_by").references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      // The same certificate (person, name, end date) is recorded once, so a repeated import adds nothing.
      uniqueIndex("credentials_unique_idx").on(t.employeeId, sql`lower(${t.name})`, t.expiresOn).where(sql`${t.archivedAt} is null`),
      index("credentials_expiry_idx").on(t.expiresOn),
      index("credentials_employee_idx").on(t.employeeId),
      check("credentials_source_chk", sql`${t.source} in ('manual','talenthr')`),
      check("credentials_name_chk", sql`char_length(${t.name}) between 2 and 120`),
      check("credentials_dates_chk", sql`${t.issuedOn} is null or ${t.issuedOn} <= ${t.expiresOn}`),
    ],
  )
  .enableRLS();

// One row per certificate and threshold (30 days, 7 days, the day itself), so a reminder is never sent twice.
export const credentialReminders = talent
  .table(
    "credential_reminders",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      credentialId: uuid("credential_id")
        .notNull()
        .references(() => credentials.id),
      daysBefore: integer("days_before").notNull(),
      sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("credential_reminders_unique_idx").on(t.credentialId, t.daysBefore),
      check("credential_reminders_days_chk", sql`${t.daysBefore} in (30, 7, 0)`),
    ],
  )
  .enableRLS();
