import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, numeric, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { chat, conversations } from "@/modules/messages/schema";

// Calls (chat schema, RLS on, no public policies). The media itself never touches our database or servers: it runs through Cloudflare
// Realtime. These tables hold who may be where, which tracks each person published, and a usage estimate. No call content is stored.

/** A call belongs to one conversation; at most one call is live in a conversation at a time. */
export const calls = chat
  .table(
    "calls",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      conversationId: uuid("conversation_id")
        .notNull()
        .references(() => conversations.id),
      /** 'meeting' (everyone can publish) or 'townhall' (a few speakers, the audience only watches). */
      mode: text("mode").notNull().default("meeting"),
      startedBy: uuid("started_by")
        .notNull()
        .references(() => users.id),
      startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
      endedAt: timestamp("ended_at", { withTimezone: true }),
      /** 'ended' (someone ended it), 'empty' (the last person left), 'missed' (nobody joined while it rang), 'conversation_closed'. */
      endReason: text("end_reason"),
      maxParticipants: integer("max_participants").notNull().default(0),
    },
    (t) => [
      uniqueIndex("calls_one_live_per_conversation_idx").on(t.conversationId).where(sql`${t.endedAt} is null`),
      index("calls_conversation_idx").on(t.conversationId, t.startedAt),
      check("calls_mode_chk", sql`${t.mode} in ('meeting','townhall')`),
    ],
  )
  .enableRLS();

/** Who is (or was) in a call. A person can rejoin, so there can be several rows; only one is open (left_at null) at a time. */
export const callParticipants = chat
  .table(
    "call_participants",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      callId: uuid("call_id")
        .notNull()
        .references(() => calls.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      /** 'host' (started it or was made host), 'speaker' (may publish in an all-hands), 'attendee'. */
      role: text("role").notNull().default("attendee"),
      /** Their Cloudflare session id while connected; never shown to other people. */
      cfSessionId: text("cf_session_id"),
      /** A second Cloudflare session for RECEIVING (a session is one connection, so sending and receiving each get their own). Null on older rows. */
      cfPullSessionId: text("cf_pull_session_id"),
      /** What this person pulled into their receiving session (Cloudflare track ids), so the server can close all of it when they leave, are removed or leave the chat. */
      pulledMids: text("pulled_mids").array().notNull().default(sql`'{}'::text[]`),
      /** Set when a host removed this person: they cannot rejoin this call. */
      removedBy: uuid("removed_by").references(() => users.id),
      joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
      /** The browser reports in every 30 seconds; a seat silent for 90 seconds is treated as left (a closed laptop, a lost connection). */
      lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
      leftAt: timestamp("left_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("call_participants_open_idx").on(t.callId, t.userId).where(sql`${t.leftAt} is null`),
      index("call_participants_user_idx").on(t.userId),
      check("call_participants_role_chk", sql`${t.role} in ('host','speaker','attendee')`),
    ],
  )
  .enableRLS();

/** The directory of published tracks, so a late joiner (or a page of tiles) knows what it can pull. */
export const callTracks = chat
  .table(
    "call_tracks",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      callId: uuid("call_id")
        .notNull()
        .references(() => calls.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      cfSessionId: text("cf_session_id").notNull(),
      trackName: text("track_name").notNull(),
      /** Cloudflare's id for the track in the publisher's session (needed to close it). */
      mid: text("mid"),
      /** 'audio', 'video' (camera) or 'screen'. */
      kind: text("kind").notNull(),
      startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
      endedAt: timestamp("ended_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("call_tracks_session_name_idx").on(t.callId, t.cfSessionId, t.trackName),
      index("call_tracks_call_idx").on(t.callId),
      check("call_tracks_kind_chk", sql`${t.kind} in ('audio','video','screen')`),
    ],
  )
  .enableRLS();

/** Company-wide switches (one row). Recording stays off until a Super Admin turns it on, after the policy is published. */
export const callSettings = chat
  .table(
    "call_settings",
    {
      id: integer("id").primaryKey().default(1),
      recordingEnabled: boolean("recording_enabled").notNull().default(false),
      townhallEnabled: boolean("townhall_enabled").notNull().default(true),
      /** Warn when this month's estimated media (in GB) passes this number. Cloudflare's free allowance is 1,000 GB. */
      monthlyGbWarning: integer("monthly_gb_warning").notNull().default(700),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("call_settings_single_chk", sql`${t.id} = 1`)],
  )
  .enableRLS();

/** A rough size of each finished call (participant-minutes times typical bitrate), so Settings can show "about X of 1,000 GB this month". */
export const callUsage = chat
  .table("call_usage", {
    callId: uuid("call_id")
      .primaryKey()
      .references(() => calls.id),
    estimatedGb: numeric("estimated_gb", { precision: 8, scale: 2 }).notNull(),
    participantMinutes: integer("participant_minutes").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();

/**
 * A recording of a call (Phase 5b). Only one is live per call. The video itself is in the private bucket `call-recordings` (parts), never
 * in the database. A recording ends when the recorder stops, leaves, or the call ends, and is deleted 30 days later by a daily job.
 */
export const callRecordings = chat
  .table(
    "call_recordings",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      callId: uuid("call_id")
        .notNull()
        .references(() => calls.id),
      recorderUserId: uuid("recorder_user_id")
        .notNull()
        .references(() => users.id),
      startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
      endedAt: timestamp("ended_at", { withTimezone: true }),
      /** 'stopped' (the recorder or host stopped it), 'recorder_left', 'call_ended', 'guest_joined', 'too_big'. */
      endReason: text("end_reason"),
      sizeBytes: bigint("size_bytes", { mode: "number" }).notNull().default(0),
      /** Set when it ends: 30 days later the files are deleted. */
      expiresAt: timestamp("expires_at", { withTimezone: true }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("call_recordings_one_live_idx").on(t.callId).where(sql`${t.endedAt} is null`),
      index("call_recordings_expiry_idx").on(t.expiresAt).where(sql`${t.deletedAt} is null`),
      index("call_recordings_recorder_idx").on(t.recorderUserId),
    ],
  )
  .enableRLS();

/** The pieces of a recording, in order (about 10 MB each). The server picks the path; the browser only gets a one-time upload token. */
export const callRecordingParts = chat
  .table(
    "call_recording_parts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      recordingId: uuid("recording_id")
        .notNull()
        .references(() => callRecordings.id),
      seq: integer("seq").notNull(),
      path: text("path").notNull(),
      /** 'pending' until the server has read the file and checked it; 'ready' after. */
      status: text("status").notNull().default("pending"),
      sizeBytes: integer("size_bytes").notNull().default(0),
      sha256: text("sha256"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("call_recording_parts_seq_idx").on(t.recordingId, t.seq), check("call_recording_parts_status_chk", sql`${t.status} in ('pending','ready')`)],
  )
  .enableRLS();

/** Everyone in a recorded call says yes or no. Insert-only history (a person can change their mind: the latest answer counts); nothing is recorded of a person before a yes. */
export const recordingConsents = chat
  .table(
    "recording_consents",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      recordingId: uuid("recording_id")
        .notNull()
        .references(() => callRecordings.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      answer: text("answer").notNull(),
      answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("recording_consents_idx").on(t.recordingId, t.userId, t.answeredAt), check("recording_consents_answer_chk", sql`${t.answer} in ('allow','decline')`)],
  )
  .enableRLS();
