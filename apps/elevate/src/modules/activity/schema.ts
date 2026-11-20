import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { employees } from "@/modules/people/schema";
import { time } from "@/modules/timeoff/schema";

// ELEVATE Tracker (docs/superpowers/specs/2026-11-19-elevate-tracker-design.md). Evidence only: nothing here changes hours.
// Only an app name is ever stored: no window titles, URLs, keystrokes or clipboard. Segments are append-only.

export const TRACKER_OS = ["windows", "macos"] as const;
export const SEGMENT_STATES = ["active", "idle"] as const;
export const ACTIVITY_CATEGORIES = ["work", "non_work"] as const;

/** A computer a person has enrolled. The token itself is never stored, only its SHA-256 hash. */
export const trackerDevices = time
  .table(
    "tracker_devices",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      name: text("name").notNull(),
      os: text("os").notNull(),
      appVersion: text("app_version").notNull().default("0.0.0"),
      tokenHash: text("token_hash").notNull(),
      status: text("status").notNull().default("active"),
      permissionsOk: boolean("permissions_ok").notNull().default(true),
      queueSize: integer("queue_size").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
      revokedBy: uuid("revoked_by").references(() => users.id),
    },
    (t) => [
      uniqueIndex("tracker_devices_token_idx").on(t.tokenHash),
      index("tracker_devices_employee_idx").on(t.employeeId, t.status),
      check("tracker_devices_status_check", sql`${t.status} in ('active', 'revoked')`),
      check("tracker_devices_os_check", sql`${t.os} in ('windows', 'macos')`),
    ],
  )
  .enableRLS();

/** A one-time code a person types into the app to enroll a computer. Stored hashed; valid 15 minutes. */
export const trackerEnrollmentCodes = time
  .table(
    "tracker_enrollment_codes",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      codeHash: text("code_hash").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      usedAt: timestamp("used_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("tracker_codes_hash_idx").on(t.codeHash), index("tracker_codes_employee_idx").on(t.employeeId)],
  )
  .enableRLS();

/** What the person was doing, as merged stretches: one app, active or idle. Append-only (database trigger). */
export const activitySegments = time
  .table(
    "activity_segments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      deviceId: uuid("device_id")
        .notNull()
        .references(() => trackerDevices.id),
      startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
      endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
      app: text("app").notNull(),
      state: text("state").notNull(),
      receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("activity_segments_employee_idx").on(t.employeeId, t.startedAt),
      check("activity_segments_range_check", sql`${t.endedAt} > ${t.startedAt}`),
      check("activity_segments_state_check", sql`${t.state} in ('active', 'idle')`),
    ],
  )
  .enableRLS();

/** One row per person per day, rebuilt from the segments (like attendance_days). Never edited by hand. */
export const activityMinutes = time
  .table(
    "activity_minutes",
    {
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      date: date("date").notNull(),
      activeMinutes: integer("active_minutes").notNull().default(0),
      idleMinutes: integer("idle_minutes").notNull().default(0),
      workMinutes: integer("work_minutes").notNull().default(0),
      nonWorkMinutes: integer("non_work_minutes").notNull().default(0),
      /** Up to 10 entries: { app, minutes }, by active minutes. */
      topApps: jsonb("top_apps").notNull().default(sql`'[]'::jsonb`),
      rebuiltAt: timestamp("rebuilt_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.employeeId, t.date] })],
  )
  .enableRLS();

/** A blurred screenshot. The file is deleted after 30 days; the row stays with purged_at set. One per person per 10-minute window. */
export const activityShots = time
  .table(
    "activity_shots",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      deviceId: uuid("device_id")
        .notNull()
        .references(() => trackerDevices.id),
      windowIndex: bigint("window_index", { mode: "number" }).notNull(),
      storagePath: text("storage_path").notNull(),
      takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
      finalizedAt: timestamp("finalized_at", { withTimezone: true }),
      purgedAt: timestamp("purged_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("activity_shots_window_idx").on(t.employeeId, t.windowIndex),
      uniqueIndex("activity_shots_path_idx").on(t.storagePath),
      index("activity_shots_purge_idx").on(t.takenAt).where(sql`${t.purgedAt} is null`),
    ],
  )
  .enableRLS();

/** App name -> work / non-work rules, applied when minutes are rebuilt. Highest rank wins. */
export const activityCategories = time
  .table(
    "activity_categories",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      pattern: text("pattern").notNull(),
      category: text("category").notNull(),
      rank: integer("rank").notNull().default(10),
      createdBy: uuid("created_by").references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
    },
    (t) => [check("activity_categories_category_check", sql`${t.category} in ('work', 'non_work')`)],
  )
  .enableRLS();

/** Company-wide thresholds (one row, scope 'default'). Per-team rows can be added later with another scope key. */
export const activitySettings = time
  .table("activity_settings", {
    scope: text("scope").primaryKey(),
    idleTimeoutSeconds: integer("idle_timeout_seconds").notNull().default(180),
    offlineGraceMinutes: integer("offline_grace_minutes").notNull().default(5),
    lowActivityPercent: integer("low_activity_percent").notNull().default(30),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();

/** One "tracker offline" notice per clock-in, so a lead is told once per session. */
export const trackerOfflineNotices = time
  .table("tracker_offline_notices", {
    clockInEventId: uuid("clock_in_event_id").primaryKey(),
    noticedAt: timestamp("noticed_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();

export const RELEASE_STATUSES = ["draft", "published", "withdrawn"] as const;
export const BUILD_KINDS = ["installer", "update"] as const;

/**
 * A release of the ELEVATE Tracker App. Frozen by a database trigger once published: only withdrawing it is allowed afterwards.
 * `policy_version_id` (a docs.policy_versions row, foreign key added by hand in the migration) is required before publishing a release
 * that adds new data collection.
 */
export const trackerReleases = time
  .table(
    "tracker_releases",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      version: text("version").notNull(),
      status: text("status").notNull().default("draft"),
      notesAdded: text("notes_added").array().notNull().default(sql`'{}'::text[]`),
      notesImproved: text("notes_improved").array().notNull().default(sql`'{}'::text[]`),
      notesFixed: text("notes_fixed").array().notNull().default(sql`'{}'::text[]`),
      minRequired: boolean("min_required").notNull().default(false),
      addsCollection: boolean("adds_collection").notNull().default(false),
      policyVersionId: uuid("policy_version_id"),
      createdBy: uuid("created_by").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      publishedBy: uuid("published_by"),
      publishedAt: timestamp("published_at", { withTimezone: true }),
      withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("tracker_releases_version_idx").on(t.version),
      check("tracker_releases_version_check", sql`${t.version} ~ '^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$'`),
      check("tracker_releases_status_check", sql`${t.status} in ('draft', 'published', 'withdrawn')`),
    ],
  )
  .enableRLS();

/** A file of a release for one platform: the installer people download, or the update file the app's updater downloads (with its signature). */
export const trackerReleaseBuilds = time
  .table(
    "tracker_release_builds",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      releaseId: uuid("release_id")
        .notNull()
        .references(() => trackerReleases.id),
      platform: text("platform").notNull(),
      kind: text("kind").notNull(),
      storagePath: text("storage_path").notNull(),
      fileName: text("file_name").notNull(),
      sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
      sha256: text("sha256").notNull(),
      signature: text("signature"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("tracker_release_builds_kind_idx").on(t.releaseId, t.platform, t.kind),
      uniqueIndex("tracker_release_builds_path_idx").on(t.storagePath),
      check("tracker_release_builds_platform_check", sql`${t.platform} in ('windows-x86_64', 'darwin-aarch64', 'darwin-x86_64')`),
      check("tracker_release_builds_kind_check", sql`${t.kind} in ('installer', 'update')`),
      check("tracker_release_builds_signature_check", sql`${t.kind} <> 'update' or (${t.signature} is not null and length(${t.signature}) > 0)`),
    ],
  )
  .enableRLS();
