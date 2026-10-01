import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgSchema, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { teams } from "@/modules/org/schema";
import { clients } from "@/modules/people/schema";

// Applicant tracking (C1). Candidates are kept apart from employees until they are hired, so applicant data can follow its own
// retention schedule. Stage history and scorecards are append-only (database triggers).

export const talent = pgSchema("talent");

export const jobOpenings = talent
  .table(
    "job_openings",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      title: text("title").notNull(),
      description: text("description").notNull(),
      location: text("location").notNull().default("Remote"),
      /** Free text shown on the public page, optional. No promises of salary or benefits (1099 contractors). */
      payNote: text("pay_note"),
      teamId: uuid("team_id").references(() => teams.id),
      clientId: uuid("client_id").references(() => clients.id),
      status: text("status").notNull().default("draft"),
      sendAck: boolean("send_ack").notNull().default(true),
      sendRejection: boolean("send_rejection").notNull().default(true),
      createdBy: uuid("created_by").references(() => users.id),
      openedAt: timestamp("opened_at", { withTimezone: true }),
      closedAt: timestamp("closed_at", { withTimezone: true }),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("job_openings_status_idx").on(t.status), check("job_openings_status_chk", sql`${t.status} in ('draft','open','closed')`)],
  )
  .enableRLS();

/** Who is on the hiring team of an opening: team leads here may see it, its candidates and fill scorecards. */
export const openingHiringTeam = talent
  .table(
    "opening_hiring_team",
    {
      openingId: uuid("opening_id")
        .notNull()
        .references(() => jobOpenings.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
    },
    (t) => [primaryKey({ columns: [t.openingId, t.userId] })],
  )
  .enableRLS();

export const candidates = talent
  .table(
    "candidates",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      email: text("email").notNull(),
      fullName: text("full_name").notNull(),
      phone: text("phone"),
      country: text("country"),
      /** The version of the privacy notice shown when they applied, and when they agreed. */
      consentNoticeVersion: text("consent_notice_version"),
      consentAt: timestamp("consent_at", { withTimezone: true }).notNull().defaultNow(),
      resumePath: text("resume_path"),
      resumeName: text("resume_name"),
      resumeKind: text("resume_kind"),
      resumeSha256: text("resume_sha256"),
      /** Set when the retention job removed the personal data. The row stays so counts and history still add up. */
      anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("candidates_email_idx").on(sql`lower(${t.email})`).where(sql`${t.anonymizedAt} is null`)],
  )
  .enableRLS();

export const applications = talent
  .table(
    "applications",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      openingId: uuid("opening_id")
        .notNull()
        .references(() => jobOpenings.id),
      candidateId: uuid("candidate_id")
        .notNull()
        .references(() => candidates.id),
      stage: text("stage").notNull().default("applied"),
      /** Set with stage = rejected: rejected (we said no) or withdrawn (they did). Different retention. */
      closeKind: text("close_kind"),
      closeReason: text("close_reason"),
      /** What the applicant wrote on the form. */
      note: text("note"),
      appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
      stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }).notNull().defaultNow(),
      /** When the application was closed or hired: retention counts from here. */
      closedAt: timestamp("closed_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("applications_opening_candidate_idx").on(t.openingId, t.candidateId),
      index("applications_opening_stage_idx").on(t.openingId, t.stage),
      check("applications_stage_chk", sql`${t.stage} in ('applied','screening','interview','assessment','offer','hired','rejected')`),
      check("applications_close_chk", sql`(${t.stage} = 'rejected') = (${t.closeKind} is not null) and (${t.closeKind} is null or ${t.closeKind} in ('rejected','withdrawn'))`),
    ],
  )
  .enableRLS();

/** Every move between stages. Append-only. */
export const applicationStageHistory = talent
  .table(
    "application_stage_history",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => applications.id),
      fromStage: text("from_stage"),
      toStage: text("to_stage").notNull(),
      /** Empty for the application itself (the applicant). */
      byUserId: uuid("by_user_id").references(() => users.id),
      note: text("note"),
      at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("application_stage_history_app_idx").on(t.applicationId, t.at)],
  )
  .enableRLS();

export const candidateNotes = talent
  .table(
    "candidate_notes",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => applications.id),
      authorId: uuid("author_id")
        .notNull()
        .references(() => users.id),
      body: text("body").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("candidate_notes_app_idx").on(t.applicationId, t.createdAt)],
  )
  .enableRLS();

export const interviews = talent
  .table(
    "interviews",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => applications.id),
      kind: text("kind").notNull().default("interview"),
      startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
      minutes: smallint("minutes").notNull(),
      /** A meeting link or a place. */
      location: text("location").notNull(),
      note: text("note"),
      status: text("status").notNull().default("scheduled"),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("interviews_app_idx").on(t.applicationId, t.startsAt), check("interviews_status_chk", sql`${t.status} in ('scheduled','cancelled')`)],
  )
  .enableRLS();

export const interviewers = talent
  .table(
    "interviewers",
    {
      interviewId: uuid("interview_id")
        .notNull()
        .references(() => interviews.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
    },
    (t) => [primaryKey({ columns: [t.interviewId, t.userId] })],
  )
  .enableRLS();

/** One per interviewer per interview, submitted once. Append-only. */
export const scorecards = talent
  .table(
    "scorecards",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      interviewId: uuid("interview_id")
        .notNull()
        .references(() => interviews.id),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => applications.id),
      interviewerId: uuid("interviewer_id")
        .notNull()
        .references(() => users.id),
      ratings: jsonb("ratings").$type<Record<string, number>>().notNull(),
      recommendation: text("recommendation").notNull(),
      comments: text("comments").notNull(),
      submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("scorecards_interview_interviewer_idx").on(t.interviewId, t.interviewerId),
      index("scorecards_app_idx").on(t.applicationId),
      check("scorecards_recommendation_chk", sql`${t.recommendation} in ('strong_yes','yes','no','strong_no')`),
    ],
  )
  .enableRLS();

/** Emails to applicants (they have no account, so they cannot use the in-app email queue). Sent by a job under its own daily cap. */
export const candidateEmails = talent
  .table(
    "candidate_emails",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id").references(() => applications.id),
      toEmail: text("to_email").notNull(),
      kind: text("kind").notNull(),
      subject: text("subject").notNull(),
      body: text("body").notNull(),
      attachment: jsonb("attachment").$type<{ fileName: string; mimeType: string; content: string }>(),
      dedupeKey: text("dedupe_key").notNull(),
      status: text("status").notNull().default("queued"),
      attempts: integer("attempts").notNull().default(0),
      lastError: text("last_error"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      sentAt: timestamp("sent_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("candidate_emails_dedupe_idx").on(t.dedupeKey),
      index("candidate_emails_pending_idx").on(t.createdAt).where(sql`${t.status} = 'queued'`),
      check("candidate_emails_kind_chk", sql`${t.kind} in ('received','rejection','interview')`),
      check("candidate_emails_status_chk", sql`${t.status} in ('queued','sent','failed','skipped')`),
    ],
  )
  .enableRLS();

/** One row. The retention job does nothing until HR turns it on (periods are for counsel to confirm). */
export const recruitingSettings = talent
  .table(
    "recruiting_settings",
    {
      id: smallint("id").primaryKey().default(1),
      retentionEnabled: boolean("retention_enabled").notNull().default(false),
      rejectedMonths: smallint("rejected_months").notNull().default(12),
      withdrawnMonths: smallint("withdrawn_months").notNull().default(6),
      updatedBy: uuid("updated_by").references(() => users.id),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("recruiting_settings_one_row", sql`${t.id} = 1`)],
  )
  .enableRLS();
