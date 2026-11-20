import { jsonb, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { core, users } from "@/modules/core/schema";

/**
 * A person's own hide and reorder choices for one dashboard view. A preference only, never a permission: the view's tiles still ask their
 * own module. Holds tile ids and nothing else. No row means the default layout.
 */
export const dashboardLayouts = core
  .table(
    "dashboard_layouts",
    {
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      /** A dashboard view (lens), e.g. "team_lead". */
      view: text("view").notNull(),
      hidden: jsonb("hidden").$type<string[]>().notNull().default([]),
      order: jsonb("order").$type<string[]>().notNull().default([]),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.userId, t.view] })],
  )
  .enableRLS();
