import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ops } from "@/modules/audit/schema";
import { users } from "@/modules/core/schema";

/**
 * A message on a report or request (a technical issue, time correction, support request, extra hours, make-up hours or time off request):
 * the person who reported and whoever handles it. Append-only (a trigger refuses changes and deletes). The text is encrypted
 * (`report_message:<reportId>:<messageId>`) and never appears in notifications, audit rows or logs. Privacy incidents keep their own thread.
 */
export const reportMessages = ops
  .table(
    "report_messages",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      reportType: text("report_type").notNull(),
      reportId: uuid("report_id").notNull(),
      authorUserId: uuid("author_user_id")
        .notNull()
        .references(() => users.id),
      /** 'reporter' (the person it is about) or 'handler' (whoever may decide or handle it). */
      authorKind: text("author_kind").notNull(),
      bodyEnc: text("body_enc").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("report_messages_report_idx").on(t.reportType, t.reportId, t.createdAt),
      check("report_messages_type_chk", sql`${t.reportType} in ('tech_issue','correction','support','extra_hours','makeup','time_off')`),
      check("report_messages_kind_chk", sql`${t.authorKind} in ('reporter','handler')`),
    ],
  )
  .enableRLS();
