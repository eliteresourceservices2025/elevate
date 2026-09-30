import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { documents, docs } from "@/modules/documents/schema";
import { employees } from "@/modules/people/schema";
import { teams } from "@/modules/org/schema";

// Announcements, versioned policies and acknowledgments (A4). Bodies are Markdown, rendered by
// src/lib/markdown.ts (no HTML). An acknowledgment records who, what and when, nothing else.

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const announcements = docs
  .table(
    "announcements",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      title: text("title").notNull(),
      body: text("body").notNull(),
      /** "all" = every active person; "teams" = the people in the selected teams when it was posted. */
      audience: text("audience").notNull().default("all"),
      pinned: boolean("pinned").notNull().default(false),
      requiresAck: boolean("requires_ack").notNull().default(false),
      dueOn: date("due_on", { mode: "string" }),
      /** Optional company document (all-staff only) shown as a download on the post. */
      attachmentDocumentId: uuid("attachment_document_id").references(() => documents.id),
      publishedBy: uuid("published_by").notNull(),
      publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [
      index("announcements_feed_idx").on(t.archivedAt, t.pinned, t.publishedAt),
      check("announcements_audience_chk", sql`${t.audience} in ('all','teams')`),
      check("announcements_due_chk", sql`${t.dueOn} is null or ${t.requiresAck}`),
    ],
  )
  .enableRLS();

export const announcementTeams = docs
  .table(
    "announcement_teams",
    {
      announcementId: uuid("announcement_id")
        .notNull()
        .references(() => announcements.id),
      teamId: uuid("team_id")
        .notNull()
        .references(() => teams.id),
    },
    (t) => [primaryKey({ columns: [t.announcementId, t.teamId] })],
  )
  .enableRLS();

/** Who the post was addressed to when it was published. Later hires are not retroactively added. */
export const announcementRecipients = docs
  .table(
    "announcement_recipients",
    {
      announcementId: uuid("announcement_id")
        .notNull()
        .references(() => announcements.id),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
    },
    (t) => [primaryKey({ columns: [t.announcementId, t.employeeId] }), index("announcement_recipients_employee_idx").on(t.employeeId)],
  )
  .enableRLS();

export const policies = docs
  .table(
    "policies",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** Stable key used by code, e.g. "privacy_notice". */
      slug: text("slug").notNull(),
      title: text("title").notNull(),
      /** "privacy_notice" feeds the first-login screen (1.5); "monitoring" gates the Jibble mirror. */
      kind: text("kind").notNull().default("general"),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [
      uniqueIndex("policies_slug_idx").on(t.slug),
      uniqueIndex("policies_special_kind_idx").on(t.kind).where(sql`${t.kind} <> 'general'`),
      check("policies_kind_chk", sql`${t.kind} in ('general','privacy_notice','monitoring')`),
    ],
  )
  .enableRLS();

export const policyVersions = docs
  .table(
    "policy_versions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      policyId: uuid("policy_id")
        .notNull()
        .references(() => policies.id),
      version: integer("version").notNull(),
      body: text("body").notNull(),
      /** What changed since the previous version, shown to readers. */
      changeNote: text("change_note"),
      /** draft = editable, nobody sees it; published = frozen forever. */
      status: text("status").notNull().default("draft"),
      requiresAck: boolean("requires_ack").notNull().default(true),
      dueOn: date("due_on", { mode: "string" }),
      publishedBy: uuid("published_by"),
      publishedAt: timestamp("published_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [
      uniqueIndex("policy_versions_number_idx").on(t.policyId, t.version),
      uniqueIndex("policy_versions_one_draft_idx").on(t.policyId).where(sql`${t.status} = 'draft'`),
      check("policy_versions_status_chk", sql`${t.status} in ('draft','published')`),
      check("policy_versions_published_chk", sql`${t.status} = 'draft' or (${t.publishedAt} is not null and ${t.publishedBy} is not null)`),
    ],
  )
  .enableRLS();

/** Insert-only (database trigger). Exactly one of announcement_id / policy_version_id is set. */
export const acknowledgments = docs
  .table(
    "acknowledgments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id").notNull(),
      announcementId: uuid("announcement_id").references(() => announcements.id),
      policyVersionId: uuid("policy_version_id").references(() => policyVersions.id),
      acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("acknowledgments_announcement_idx").on(t.userId, t.announcementId).where(sql`${t.announcementId} is not null`),
      uniqueIndex("acknowledgments_policy_idx").on(t.userId, t.policyVersionId).where(sql`${t.policyVersionId} is not null`),
      index("acknowledgments_announcement_lookup_idx").on(t.announcementId),
      index("acknowledgments_policy_lookup_idx").on(t.policyVersionId),
      check("acknowledgments_subject_chk", sql`(${t.announcementId} is null) <> (${t.policyVersionId} is null)`),
    ],
  )
  .enableRLS();

/** One row per item and day, so a reminder claims its slot once (scheduled) and HR's button works once a day (manual). */
export const acknowledgmentReminders = docs
  .table(
    "acknowledgment_reminders",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      announcementId: uuid("announcement_id").references(() => announcements.id),
      policyVersionId: uuid("policy_version_id").references(() => policyVersions.id),
      reminderDate: date("reminder_date", { mode: "string" }).notNull(),
      kind: text("kind").notNull(),
      sentBy: uuid("sent_by"),
      recipients: integer("recipients").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("ack_reminders_announcement_idx").on(t.announcementId, t.reminderDate, t.kind).where(sql`${t.announcementId} is not null`),
      uniqueIndex("ack_reminders_policy_idx").on(t.policyVersionId, t.reminderDate, t.kind).where(sql`${t.policyVersionId} is not null`),
      check("ack_reminders_kind_chk", sql`${t.kind} in ('scheduled','manual')`),
      check("ack_reminders_subject_chk", sql`(${t.announcementId} is null) <> (${t.policyVersionId} is null)`),
    ],
  )
  .enableRLS();
