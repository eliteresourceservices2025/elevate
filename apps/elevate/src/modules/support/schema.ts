import { sql } from "drizzle-orm";
import { boolean, check, index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { ops } from "@/modules/audit/schema";
import { users } from "@/modules/core/schema";

/**
 * A request for help (technical support). Staff-written text: never client or patient information (the form says so). HR and Super Admin
 * read and close them; the person sees their own. The same request is also emailed to the support address.
 */
export const supportRequests = ops
  .table(
    "support_requests",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      /** The sign-in email at the time, so a reply still has an address if the account changes. */
      email: text("email").notNull(),
      topic: text("topic").notNull(),
      subject: text("subject").notNull(),
      message: text("message").notNull(),
      /** The page the person was on (a relative path), if they chose to share it. */
      page: text("page"),
      status: text("status").notNull().default("open"),
      /** Whether the email to the support address went out (no email service = false: HR still has it here). */
      emailed: boolean("emailed").notNull().default(false),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      closedAt: timestamp("closed_at", { withTimezone: true }),
      closedBy: uuid("closed_by").references(() => users.id),
    },
    (t) => [
      index("support_requests_status_idx").on(t.status, t.createdAt),
      index("support_requests_user_idx").on(t.userId, t.createdAt),
      check("support_requests_status_chk", sql`${t.status} in ('open','closed')`),
      check("support_requests_topic_chk", sql`${t.topic} in ('sign_in','time_clock','jibble','data','other')`),
    ],
  )
  .enableRLS();
