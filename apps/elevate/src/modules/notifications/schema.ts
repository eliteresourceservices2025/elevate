import { index, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
