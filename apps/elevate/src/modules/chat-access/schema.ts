import { sql } from "drizzle-orm";
import { check, index, integer, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { callRecordings } from "@/modules/calls/schema";
import { users } from "@/modules/core/schema";
import { chat, conversations } from "@/modules/messages/schema";

// HR access to a chat or a call recording they are not part of (Phase 6, owner decision 2026-11-17): an HR Admin asks, a DIFFERENT Super
// Admin approves, access is read-only, for the requested dates only, for 72 hours. The two-person rule is also a database check, and a
// decided request can never be changed (trigger), so history cannot be rewritten. The reason and the decision note are encrypted.

export const accessRequests = chat
  .table(
    "access_requests",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** 'chat' (read messages in a date window) or 'recording' (watch one call recording). */
      kind: text("kind").notNull(),
      conversationId: uuid("conversation_id")
        .notNull()
        .references(() => conversations.id),
      recordingId: uuid("recording_id").references(() => callRecordings.id),
      requestedBy: uuid("requested_by")
        .notNull()
        .references(() => users.id),
      /** For a chat: the messages from this moment (inclusive) to this one (exclusive) can be read. */
      windowFrom: timestamp("window_from", { withTimezone: true }),
      windowTo: timestamp("window_to", { withTimezone: true }),
      reasonEnc: text("reason_enc").notNull(),
      /** 'pending', 'approved', 'denied' or 'cancelled'. (Expired is worked out from the times: a pending request lapses after 7 days, an approval after 72 hours.) */
      status: text("status").notNull().default("pending"),
      requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
      decidedBy: uuid("decided_by").references(() => users.id),
      decidedAt: timestamp("decided_at", { withTimezone: true }),
      decisionNoteEnc: text("decision_note_enc"),
      accessExpiresAt: timestamp("access_expires_at", { withTimezone: true }),
      /** How often the approved access was opened (the people in the chat are told afterwards only if it was used). */
      readCount: integer("read_count").notNull().default(0),
      firstReadAt: timestamp("first_read_at", { withTimezone: true }),
      lastReadAt: timestamp("last_read_at", { withTimezone: true }),
      membersNotifiedAt: timestamp("members_notified_at", { withTimezone: true }),
    },
    (t) => [
      index("access_requests_status_idx").on(t.status, t.requestedAt),
      index("access_requests_requester_idx").on(t.requestedBy, t.requestedAt),
      check("access_requests_kind_chk", sql`${t.kind} in ('chat','recording')`),
      check("access_requests_status_chk", sql`${t.status} in ('pending','approved','denied','cancelled')`),
      check("access_requests_recording_chk", sql`(${t.kind} = 'recording') = (${t.recordingId} is not null)`),
      check("access_requests_window_chk", sql`${t.kind} <> 'chat' or (${t.windowFrom} is not null and ${t.windowTo} is not null and ${t.windowTo} > ${t.windowFrom} and ${t.windowTo} - ${t.windowFrom} <= interval '92 days')`),
      // The two-person rule, in the database too: nobody decides their own request.
      check("access_requests_two_person_chk", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`),
      check("access_requests_approved_chk", sql`${t.status} <> 'approved' or (${t.decidedBy} is not null and ${t.accessExpiresAt} is not null)`),
    ],
  )
  .enableRLS();
