import { sql } from "drizzle-orm";
import { boolean, check, customType, date, index, integer, jsonb, numeric, pgSchema, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { clients } from "@/modules/people/schema";

// ELEVATE Learn (HIPAA training), release 1. Everything here is the TRAINING RECORD, so most of it is append-only or frozen:
// a published course version cannot change, progress, answers, attestations, certificates and grants are insert-only, and an
// exam is graded by `learn.grade_attempt()` (a definer function), so the app's own database role never reads the answer key.
// The roles, grants, row-level-security policies, triggers, views and functions are in migration 0054; see docs/learn/03-data-and-security.md.

export const learn = pgSchema("learn");

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const stamp = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const COURSE_VERSION_STATUSES = ["draft", "published", "retired"] as const;
export const TRACKS = ["full", "essentials", "refresher"] as const;
export const ASSIGNMENT_REASONS = ["new_hire", "renewal", "update", "manual"] as const;
export const ASSIGNMENT_STATUSES = ["assigned", "in_progress", "passed", "expired", "cancelled"] as const;
export const ATTEMPT_STATUSES = ["in_progress", "submitted"] as const;
export const QUESTION_TYPES = ["single", "multiple", "true_false", "scenario"] as const;
export const GRANT_KINDS = ["tries", "time"] as const;

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(","));

export const courses = learn
  .table(
    "courses",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      slug: text("slug").notNull(),
      title: text("title").notNull(),
      /** Edited in the course studio from now on: the code files are no longer loaded over it (the publish command refuses). */
      studioManaged: boolean("studio_managed").notNull().default(false),
      /** `core` = a course for everyone (HIPAA, Cybersecurity; listed in code). `client_addon` = extra training for the people assigned to one client. */
      kind: text("kind").notNull().default("core"),
      /** The client an add-on belongs to (null for core courses). */
      clientId: uuid("client_id").references(() => clients.id),
      /** Add-ons only: short name for tabs, how notices name it, and a fixed track (core courses keep these in code). */
      label: text("label"),
      noun: text("noun"),
      fixedTrack: text("fixed_track"),
      createdAt: stamp("created_at"),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("courses_slug_idx").on(t.slug),
      check("courses_slug_chk", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
      check("courses_kind_chk", sql`${t.kind} in ('core', 'client_addon')`),
      check("courses_client_chk", sql`(${t.kind} = 'core' and ${t.clientId} is null) or (${t.kind} = 'client_addon' and ${t.clientId} is not null)`),
      check("courses_fixed_track_chk", sql`${t.fixedTrack} is null or ${t.fixedTrack} in ('full', 'essentials', 'refresher')`),
    ],
  )
  .enableRLS();

export const courseVersions = learn
  .table(
    "course_versions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      courseId: uuid("course_id")
        .notNull()
        .references(() => courses.id),
      version: integer("version").notNull(),
      status: text("status").notNull().default("draft"),
      /** The lesson content: validated JSON blocks (never HTML). Frozen once published. */
      content: jsonb("content").notNull().default(sql`'{}'::jsonb`),
      /** Exam rules for this version: pass percent, tries, minutes and question counts per track, wait after a fail. */
      examConfig: jsonb("exam_config").notNull(),
      /** A material change sends the people already trained an update module. */
      material: boolean("material").notNull().default(false),
      reviewedBy: uuid("reviewed_by").references(() => users.id),
      counselApprovedOn: date("counsel_approved_on", { mode: "string" }),
      publishedAt: timestamp("published_at", { withTimezone: true }),
      publishedBy: uuid("published_by").references(() => users.id),
      retiredAt: timestamp("retired_at", { withTimezone: true }),
      createdBy: uuid("created_by").references(() => users.id),
      createdAt: stamp("created_at"),
      /** Studio drafts: what this version changes, in the editor's own words (frozen once published). */
      changeNote: text("change_note"),
      /** Studio drafts: who saved last and when. Publishing needs someone else (a second pair of eyes). */
      updatedBy: uuid("updated_by").references(() => users.id),
      updatedAt: timestamp("updated_at", { withTimezone: true }),
      /** Goes up by one with every studio save; a save made on an older number is refused instead of overwriting. */
      editStamp: integer("edit_stamp").notNull().default(0),
    },
    (t) => [
      uniqueIndex("course_versions_number_idx").on(t.courseId, t.version),
      // One published version per course at a time.
      uniqueIndex("course_versions_published_idx").on(t.courseId).where(sql`${t.status} = 'published'`),
      check("course_versions_status_chk", sql`${t.status} in (${list(COURSE_VERSION_STATUSES)})`),
      check("course_versions_published_chk", sql`(${t.status} = 'draft') or (${t.publishedAt} is not null)`),
    ],
  )
  .enableRLS();

/** The modules of a version (and which tracks include each): what the time and order rules are checked against. Frozen with the version. */
export const versionModules = learn
  .table(
    "version_modules",
    {
      versionId: uuid("version_id")
        .notNull()
        .references(() => courseVersions.id),
      moduleKey: text("module_key").notNull(),
      position: smallint("position").notNull(),
      title: text("title").notNull(),
      estimatedMinutes: smallint("estimated_minutes").notNull(),
      /** Active seconds a person must spend (40% of the estimate), counted on the server. */
      minSeconds: integer("min_seconds").notNull(),
      /** How many screens the module has; all must be opened before it can complete. */
      screenCount: smallint("screen_count").notNull(),
      tracks: text("tracks").array().notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.versionId, t.moduleKey] }),
      uniqueIndex("version_modules_position_idx").on(t.versionId, t.position),
      check("version_modules_key_chk", sql`${t.moduleKey} ~ '^[a-z0-9_]{1,40}$'`),
      check("version_modules_time_chk", sql`${t.minSeconds} between 0 and 7200 and ${t.estimatedMinutes} between 1 and 120`),
      check("version_modules_screens_chk", sql`${t.screenCount} between 1 and 60`),
    ],
  )
  .enableRLS();

/** Exam questions. `correct_ids` and `rationale` are the answer key: the app role has NO column grant on them. */
export const questions = learn
  .table(
    "questions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      versionId: uuid("version_id")
        .notNull()
        .references(() => courseVersions.id),
      moduleKey: text("module_key").notNull(),
      topic: text("topic").notNull(),
      type: text("type").notNull(),
      stem: text("stem").notNull(),
      /** [{ "id": "a", "text": "..." }, ...] */
      options: jsonb("options").notNull(),
      /** The answer key (option ids). Never readable by the app role. */
      correctIds: text("correct_ids").array().notNull(),
      /** Why the answer is right. Shown to the person only after a passed attempt, by `attempt_review()`. */
      rationale: text("rationale").notNull(),
      /** The same question across versions (a studio copy keeps it), so a diff can say "changed" rather than "removed and added". */
      lineage: uuid("lineage").notNull().defaultRandom(),
      createdAt: stamp("created_at"),
    },
    (t) => [
      index("questions_version_idx").on(t.versionId, t.moduleKey),
      check("questions_type_chk", sql`${t.type} in (${list(QUESTION_TYPES)})`),
      check("questions_options_chk", sql`jsonb_typeof(${t.options}) = 'array' and jsonb_array_length(${t.options}) between 2 and 8`),
      check("questions_correct_chk", sql`cardinality(${t.correctIds}) between 1 and 8`),
      check("questions_text_chk", sql`char_length(${t.stem}) between 5 and 1500 and char_length(${t.rationale}) between 5 and 2000`),
    ],
  )
  .enableRLS();

export const assignments = learn
  .table(
    "assignments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      courseId: uuid("course_id")
        .notNull()
        .references(() => courses.id),
      /** The published version this assignment is taken on: the person finishes the version they started. */
      versionId: uuid("version_id")
        .notNull()
        .references(() => courseVersions.id),
      track: text("track").notNull(),
      reason: text("reason").notNull(),
      dueOn: date("due_on", { mode: "string" }).notNull(),
      status: text("status").notNull().default("assigned"),
      assignedAt: stamp("assigned_at"),
      passedAt: timestamp("passed_at", { withTimezone: true }),
      closedAt: timestamp("closed_at", { withTimezone: true }),
      createdBy: uuid("created_by").references(() => users.id),
    },
    (t) => [
      // One open assignment per person and course.
      uniqueIndex("assignments_open_idx").on(t.userId, t.courseId).where(sql`${t.status} in ('assigned','in_progress')`),
      index("assignments_due_idx").on(t.dueOn),
      index("assignments_user_idx").on(t.userId),
      check("assignments_track_chk", sql`${t.track} in (${list(TRACKS)})`),
      check("assignments_reason_chk", sql`${t.reason} in (${list(ASSIGNMENT_REASONS)})`),
      check("assignments_status_chk", sql`${t.status} in (${list(ASSIGNMENT_STATUSES)})`),
    ],
  )
  .enableRLS();

/** A screen the person opened (so a module cannot complete until every screen was seen). */
export const moduleScreens = learn
  .table(
    "module_screens",
    {
      assignmentId: uuid("assignment_id")
        .notNull()
        .references(() => assignments.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      moduleKey: text("module_key").notNull(),
      screenIndex: smallint("screen_index").notNull(),
      seenAt: stamp("seen_at"),
    },
    (t) => [primaryKey({ columns: [t.assignmentId, t.moduleKey, t.screenIndex] })],
  )
  .enableRLS();

/** Active seconds credited by the server per person, module and day. Only ever grows. */
export const moduleTime = learn
  .table(
    "module_time",
    {
      assignmentId: uuid("assignment_id")
        .notNull()
        .references(() => assignments.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      moduleKey: text("module_key").notNull(),
      day: date("day", { mode: "string" }).notNull(),
      seconds: integer("seconds").notNull().default(0),
      /** When the last credit was given: a credit is refused if the previous one was under 25 seconds ago. */
      lastCreditAt: timestamp("last_credit_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.assignmentId, t.moduleKey, t.day] }),
      check("module_time_seconds_chk", sql`${t.seconds} between 0 and 14400`),
    ],
  )
  .enableRLS();

export const moduleCompletions = learn
  .table(
    "module_completions",
    {
      assignmentId: uuid("assignment_id")
        .notNull()
        .references(() => assignments.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      moduleKey: text("module_key").notNull(),
      completedAt: stamp("completed_at"),
    },
    (t) => [primaryKey({ columns: [t.assignmentId, t.moduleKey] })],
  )
  .enableRLS();

export const retryGrants = learn
  .table(
    "retry_grants",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      assignmentId: uuid("assignment_id")
        .notNull()
        .references(() => assignments.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      kind: text("kind").notNull(),
      extraTries: smallint("extra_tries").notNull().default(0),
      extraMinutes: smallint("extra_minutes").notNull().default(0),
      reason: text("reason").notNull(),
      grantedBy: uuid("granted_by")
        .notNull()
        .references(() => users.id),
      grantedAt: stamp("granted_at"),
    },
    (t) => [
      index("retry_grants_assignment_idx").on(t.assignmentId),
      check("retry_grants_kind_chk", sql`${t.kind} in (${list(GRANT_KINDS)})`),
      check("retry_grants_amount_chk", sql`(${t.kind} = 'tries' and ${t.extraTries} between 1 and 5 and ${t.extraMinutes} = 0) or (${t.kind} = 'time' and ${t.extraMinutes} between 5 and 60 and ${t.extraTries} = 0)`),
      check("retry_grants_reason_chk", sql`char_length(${t.reason}) between 3 and 500`),
    ],
  )
  .enableRLS();

export const examAttempts = learn
  .table(
    "exam_attempts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      assignmentId: uuid("assignment_id")
        .notNull()
        .references(() => assignments.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      attemptNo: smallint("attempt_no").notNull(),
      status: text("status").notNull().default("in_progress"),
      startedAt: stamp("started_at"),
      /** Server value; answers saved after it are refused. Null when the course sets no time limit. */
      deadlineAt: timestamp("deadline_at", { withTimezone: true }),
      submittedAt: timestamp("submitted_at", { withTimezone: true }),
      totalCount: smallint("total_count").notNull(),
      correctCount: smallint("correct_count"),
      scorePercent: numeric("score_percent", { precision: 5, scale: 2 }),
      passed: boolean("passed"),
    },
    (t) => [
      uniqueIndex("exam_attempts_number_idx").on(t.assignmentId, t.attemptNo),
      // One open attempt per assignment.
      uniqueIndex("exam_attempts_open_idx").on(t.assignmentId).where(sql`${t.status} = 'in_progress'`),
      check("exam_attempts_status_chk", sql`${t.status} in (${list(ATTEMPT_STATUSES)})`),
      check("exam_attempts_done_chk", sql`(${t.status} = 'submitted') = (${t.submittedAt} is not null and ${t.passed} is not null)`),
    ],
  )
  .enableRLS();

/** The questions of one attempt, in order, with the shuffled option order, fixed at the start. */
export const examAttemptItems = learn
  .table(
    "exam_attempt_items",
    {
      attemptId: uuid("attempt_id")
        .notNull()
        .references(() => examAttempts.id),
      position: smallint("position").notNull(),
      questionId: uuid("question_id")
        .notNull()
        .references(() => questions.id),
      optionOrder: text("option_order").array().notNull(),
    },
    (t) => [primaryKey({ columns: [t.attemptId, t.position] }), uniqueIndex("exam_attempt_items_question_idx").on(t.attemptId, t.questionId)],
  )
  .enableRLS();

/** The person's answers. They may change an answer while the attempt is open; once it is submitted nothing can change. */
export const examAnswers = learn
  .table(
    "exam_answers",
    {
      attemptId: uuid("attempt_id")
        .notNull()
        .references(() => examAttempts.id),
      questionId: uuid("question_id")
        .notNull()
        .references(() => questions.id),
      selectedIds: text("selected_ids").array().notNull(),
      answeredAt: stamp("answered_at"),
    },
    (t) => [primaryKey({ columns: [t.attemptId, t.questionId] })],
  )
  .enableRLS();

export const attestations = learn
  .table(
    "attestations",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      assignmentId: uuid("assignment_id")
        .notNull()
        .references(() => assignments.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      /** The version of the statement text the person accepted. */
      statementVersion: text("statement_version").notNull(),
      typedName: text("typed_name").notNull(),
      ip: text("ip"),
      /** How the person signed in to ELEVATE (for example password, totp), copied from the session. */
      authMethods: text("auth_methods").array().notNull().default(sql`'{}'::text[]`),
      acceptedAt: stamp("accepted_at"),
    },
    (t) => [uniqueIndex("attestations_assignment_idx").on(t.assignmentId), check("attestations_name_chk", sql`char_length(${t.typedName}) between 2 and 120`)],
  )
  .enableRLS();

export const certificates = learn
  .table(
    "certificates",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** ERSHC-YYYY-XXXXXX (HIPAA), ERSCSC-YYYY-XXXXXX (Cybersecurity basics), ERSCL-... (client add-ons), ERSLN-... (other); the old HC- form is still accepted */
      reference: text("reference").notNull(),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      assignmentId: uuid("assignment_id")
        .notNull()
        .references(() => assignments.id),
      versionId: uuid("version_id")
        .notNull()
        .references(() => courseVersions.id),
      track: text("track").notNull(),
      /** The name printed on the certificate, fixed at issue so the document is stable. */
      holderName: text("holder_name").notNull(),
      issuedOn: date("issued_on", { mode: "string" }).notNull(),
      endsOn: date("ends_on", { mode: "string" }).notNull(),
      pdfSha256: text("pdf_sha256"),
      createdAt: stamp("created_at"),
    },
    (t) => [
      uniqueIndex("certificates_reference_idx").on(t.reference),
      uniqueIndex("certificates_assignment_idx").on(t.assignmentId),
      index("certificates_user_idx").on(t.userId, t.endsOn),
      check("certificates_reference_chk", sql`${t.reference} ~ '^(HC|ERSHC|ERSCSC|ERSLN|ERSCL)-[0-9]{4}-[A-Z2-9]{6}$'`),
      check("certificates_dates_chk", sql`${t.issuedOn} < ${t.endsOn}`),
    ],
  )
  .enableRLS();

export const certificateRevocations = learn
  .table(
    "certificate_revocations",
    {
      certificateId: uuid("certificate_id")
        .primaryKey()
        .references(() => certificates.id),
      revokedBy: uuid("revoked_by")
        .notNull()
        .references(() => users.id),
      reason: text("reason").notNull(),
      revokedAt: stamp("revoked_at"),
    },
    (t) => [check("certificate_revocations_reason_chk", sql`char_length(${t.reason}) between 3 and 500`)],
  )
  .enableRLS();

/** One-time handoff tokens from ELEVATE. Only the hash is stored; a token works once, for 60 seconds. */
export const launchTokens = learn
  .table(
    "launch_tokens",
    {
      tokenHash: bytea("token_hash").primaryKey(),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      authMethods: text("auth_methods").array().notNull().default(sql`'{}'::text[]`),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      usedAt: timestamp("used_at", { withTimezone: true }),
      createdAt: stamp("created_at"),
    },
    (t) => [index("launch_tokens_expiry_idx").on(t.expiresAt)],
  )
  .enableRLS();

/** Learn's own sessions. Only the hash of the cookie value is stored. */
export const sessions = learn
  .table(
    "sessions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      tokenHash: bytea("token_hash").notNull(),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      authMethods: text("auth_methods").array().notNull().default(sql`'{}'::text[]`),
      createdAt: stamp("created_at"),
      lastSeenAt: stamp("last_seen_at"),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      endedAt: timestamp("ended_at", { withTimezone: true }),
    },
    (t) => [uniqueIndex("sessions_token_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
  )
  .enableRLS();

/** One row per reminder sent, so a reminder is never sent twice (daily 30 / 7 / 0 days, and one overdue notice a week). */
export const reminders = learn
  .table(
    "reminders",
    {
      assignmentId: uuid("assignment_id")
        .notNull()
        .references(() => assignments.id),
      /** d30, d7, d0 or overdue-YYYY-Www */
      kind: text("kind").notNull(),
      sentAt: stamp("sent_at"),
    },
    (t) => [primaryKey({ columns: [t.assignmentId, t.kind] }), check("reminders_kind_chk", sql`${t.kind} ~ '^(d30|d7|d0|overdue-[0-9]{4}-W[0-9]{2})$'`)],
  )
  .enableRLS();

/** Which Learn certificates were recorded in ELEVATE's Certificates (so syncing is idempotent and a revocation can be followed). */
export const certificateSync = learn
  .table("certificate_sync", {
    certificateId: uuid("certificate_id")
      .primaryKey()
      .references(() => certificates.id),
    credentialId: uuid("credential_id").notNull(),
    syncedAt: stamp("synced_at"),
  })
  .enableRLS();

/**
 * Who a course is assigned to AUTOMATICALLY each night. No row = everyone (how courses worked before this table existed). The publish
 * command adds a "paused" row for a newly published course, so publishing alone assigns nobody until HR chooses a pilot or everyone.
 * Only ELEVATE reads it; the Learn app role has no grant.
 */
export const assignmentRules = learn
  .table(
    "assignment_rules",
    {
      courseId: uuid("course_id")
        .primaryKey()
        .references(() => courses.id),
      mode: text("mode").notNull(),
      /** Teams (core.teams ids) when the mode is "teams". */
      teamIds: uuid("team_ids").array().notNull().default(sql`'{}'::uuid[]`),
      updatedBy: uuid("updated_by").references(() => users.id),
      updatedAt: stamp("updated_at"),
    },
    (t) => [
      check("assignment_rules_mode_chk", sql`${t.mode} in ('all','teams','paused')`),
      check("assignment_rules_teams_chk", sql`${t.mode} <> 'teams' or cardinality(${t.teamIds}) > 0`),
    ],
  )
  .enableRLS();

/**
 * An update module: when a published version is marked "material", people already certified on an older version get a short
 * assignment (reason "update") that covers only the modules whose content changed, ending with a few questions from them. This row
 * says which modules and how many questions. Written once by the assignment job, never changed. Migration 0072.
 */
export const updateScopes = learn
  .table(
    "update_scopes",
    {
      assignmentId: uuid("assignment_id")
        .primaryKey()
        .references(() => assignments.id),
      fromVersionId: uuid("from_version_id")
        .notNull()
        .references(() => courseVersions.id),
      moduleKeys: text("module_keys").array().notNull(),
      questionCount: smallint("question_count").notNull(),
      createdAt: stamp("created_at"),
    },
    (t) => [
      check("update_scopes_modules_chk", sql`cardinality(${t.moduleKeys}) >= 1`),
      check("update_scopes_questions_chk", sql`${t.questionCount} between 1 and 20`),
    ],
  )
  .enableRLS();

/**
 * A person's answer to a quarterly micro-drill (Release 3). One per person, course and quarter; insert-only. A nudge, so nothing
 * here gates anything: HR sees only counts and a share per quarter (groups of five or more), never a person. Migration 0073.
 */
export const drillResults = learn
  .table(
    "drill_results",
    {
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      courseSlug: text("course_slug").notNull(),
      quarter: text("quarter").notNull(),
      drillKey: text("drill_key").notNull(),
      choice: text("choice").notNull(),
      correct: boolean("correct").notNull(),
      answeredAt: stamp("answered_at"),
    },
    (t) => [
      primaryKey({ columns: [t.userId, t.courseSlug, t.quarter] }),
      check("drill_results_quarter_chk", sql`${t.quarter} ~ '^[0-9]{4}-Q[1-4]$'`),
      check("drill_results_choice_chk", sql`${t.choice} in ('a','b','c')`),
    ],
  )
  .enableRLS();

/**
 * Comments between editors on a draft (Release 3): a note about the whole course or one module, open until someone marks it done.
 * Internal working notes, never shown to learners, never copied into audit entries or notices (ids only). The text is fixed once
 * written; only "resolved" can be set, once. Migration 0074.
 */
export const studioComments = learn
  .table(
    "studio_comments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      versionId: uuid("version_id")
        .notNull()
        .references(() => courseVersions.id),
      authorId: uuid("author_id")
        .notNull()
        .references(() => users.id),
      /** "course" or "module:<key>". */
      target: text("target").notNull(),
      body: text("body").notNull(),
      createdAt: stamp("created_at"),
      resolvedAt: timestamp("resolved_at", { withTimezone: true }),
      resolvedBy: uuid("resolved_by").references(() => users.id),
    },
    (t) => [
      index("studio_comments_version_idx").on(t.versionId, t.createdAt),
      check("studio_comments_target_chk", sql`${t.target} ~ '^(course|module:[a-z0-9_]{1,40})$'`),
      check("studio_comments_body_chk", sql`char_length(${t.body}) between 3 and 1000`),
      check("studio_comments_resolved_chk", sql`(${t.resolvedAt} is null) = (${t.resolvedBy} is null)`),
    ],
  )
  .enableRLS();
