import { sql } from "drizzle-orm";
import { boolean, check, date, index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ops } from "@/modules/audit/schema";
import { users } from "@/modules/core/schema";
import { clients } from "@/modules/people/schema";

/**
 * A privacy incident report (a mistake or a worry about information, filed by staff). Free text, written by the person: the form
 * forbids patient details and says so. Read by the reporter, HR, Super Admin and the designated Privacy Officer only. Text is never
 * copied to the audit log or to a notification or email.
 */
export const privacyIncidents = ops
  .table(
    "privacy_incidents",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      reporterUserId: uuid("reporter_user_id")
        .notNull()
        .references(() => users.id),
      kind: text("kind").notNull(),
      happenedOn: date("happened_on").notNull(),
      ongoing: boolean("ongoing").notNull().default(false),
      howFound: text("how_found").notNull(),
      whatHappened: text("what_happened").notNull(),
      clientId: uuid("client_id").references(() => clients.id),
      whoElseKnows: text("who_else_knows"),
      actionsTaken: text("actions_taken"),
      status: text("status").notNull().default("new"),
      /** The handler's note on how it was resolved; the reporter sees the status only. */
      resolution: text("resolution"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
      closedAt: timestamp("closed_at", { withTimezone: true }),
      closedBy: uuid("closed_by").references(() => users.id),
    },
    (t) => [
      index("privacy_incidents_status_idx").on(t.status, t.createdAt),
      index("privacy_incidents_reporter_idx").on(t.reporterUserId, t.createdAt),
      check("privacy_incidents_status_chk", sql`${t.status} in ('new','in_review','closed')`),
      check(
        "privacy_incidents_kind_chk",
        sql`${t.kind} in ('wrong_recipient','lost_device','suspicious_link','exposed_password','unauthorized_access','left_visible','other')`,
      ),
      check("privacy_incidents_closed_chk", sql`(${t.status} = 'closed') = (${t.closedAt} is not null)`),
    ],
  )
  .enableRLS();

/** The follow-up thread on a report. Append-only (a trigger refuses changes and deletes). */
export const privacyIncidentMessages = ops
  .table(
    "privacy_incident_messages",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      incidentId: uuid("incident_id")
        .notNull()
        .references(() => privacyIncidents.id),
      authorUserId: uuid("author_user_id")
        .notNull()
        .references(() => users.id),
      /** 'reporter' (the person who filed it) or 'handler' (HR, Super Admin or the Privacy Officer). */
      authorKind: text("author_kind").notNull(),
      body: text("body").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("privacy_incident_messages_idx").on(t.incidentId, t.createdAt),
      check("privacy_incident_messages_kind_chk", sql`${t.authorKind} in ('reporter','handler')`),
    ],
  )
  .enableRLS();
