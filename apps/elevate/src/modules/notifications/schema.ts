import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ops } from "@/modules/audit/schema";
import { users } from "@/modules/core/schema";

// In-app notifications (P2). Phase 1.3 adds the table and the bell; email digests follow in 1.4.
export const notifications = ops
  .table(
    "notifications",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      /** Machine-readable kind, e.g. "document.expiring". */
      kind: text("kind").notNull(),
      title: text("title").notNull(),
      body: text("body"),
      /** In-app path to open, always relative, for example "/documents?tab=expiring". */
      link: text("link"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      readAt: timestamp("read_at", { withTimezone: true }),
    },
    (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
  )
  .enableRLS();

// Email queue (1.4). Emails are queued first and sent by a job under a daily budget, because the free
// Resend plan allows 100 a day. Bodies hold counts and links only: email is not a secure channel.
export const emailQueue = ops
  .table(
    "email_queue",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      /** "ack_due" and "invite" are sent first; "digest" fills the remaining budget. */
      kind: text("kind").notNull(),
      priority: integer("priority").notNull(),
      subject: text("subject").notNull(),
      body: text("body").notNull(),
      /** Relative in-app path; the sender prefixes the app address. */
      link: text("link").notNull(),
      /** One optional attachment, stored as text (a calendar invite). */
      attachment: jsonb("attachment").$type<{ fileName: string; mimeType: string; content: string }>(),
      /** Queuing the same key twice does nothing, e.g. "digest:2026-10-01". */
      dedupeKey: text("dedupe_key").notNull(),
      /** queued, sent, failed (gave up) or skipped (no longer relevant). */
      status: text("status").notNull().default("queued"),
      attempts: integer("attempts").notNull().default(0),
      lastError: text("last_error"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      sentAt: timestamp("sent_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("email_queue_dedupe_idx").on(t.userId, t.dedupeKey),
      index("email_queue_pending_idx").on(t.priority, t.createdAt).where(sql`${t.status} = 'queued'`),
      index("email_queue_sent_idx").on(t.sentAt).where(sql`${t.status} = 'sent'`),
      check("email_queue_kind_chk", sql`${t.kind} in ('ack_due','digest','invite')`),
      check("email_queue_status_chk", sql`${t.status} in ('queued','sent','failed','skipped')`),
    ],
  )
  .enableRLS();

export const emailPreferences = ops
  .table("email_preferences", {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id),
    /** Opts out of the daily digest only. Emails about something you must acknowledge are required. */
    digestOptOut: boolean("digest_opt_out").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();
