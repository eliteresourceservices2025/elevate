import { sql } from "drizzle-orm";
import { check, date, index, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { employees } from "@/modules/people/schema";
import { talent } from "@/modules/recruiting/schema";

// Equipment inventory (D3). Items are archived, never deleted. The assignment table is the history: one row per hand-over, closed once
// by a return, never edited or deleted afterwards (trigger in the migration). No prices or values are stored anywhere.

export const assets = talent
  .table(
    "assets",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** Printed on the label and used as the item's address. Upper case; never changes. */
      tag: text("tag").notNull(),
      name: text("name").notNull(),
      category: text("category").notNull(),
      serialNumber: text("serial_number"),
      notes: text("notes"),
      purchaseDate: date("purchase_date", { mode: "string" }),
      status: text("status").notNull().default("in_stock"),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      createdBy: uuid("created_by").references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("assets_tag_idx").on(sql`upper(${t.tag})`),
      index("assets_status_idx").on(t.status, t.category),
      check("assets_status_chk", sql`${t.status} in ('in_stock','assigned','repair','lost','retired')`),
      check("assets_category_chk", sql`${t.category} in ('laptop','desktop','monitor','headset','phone','peripheral','network','other')`),
    ],
  )
  .enableRLS();

export const assetAssignments = talent
  .table(
    "asset_assignments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      assetId: uuid("asset_id")
        .notNull()
        .references(() => assets.id),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
      conditionOut: text("condition_out").notNull(),
      /** Who handed it over. */
      assignedBy: uuid("assigned_by")
        .notNull()
        .references(() => users.id),
      assignNote: text("assign_note"),
      returnedAt: timestamp("returned_at", { withTimezone: true }),
      conditionIn: text("condition_in"),
      /** Who received it back. */
      receivedBy: uuid("received_by").references(() => users.id),
      returnNote: text("return_note"),
    },
    (t) => [
      // One active assignment at a time
      uniqueIndex("asset_assignments_active_idx").on(t.assetId).where(sql`${t.returnedAt} is null`),
      index("asset_assignments_asset_idx").on(t.assetId, t.assignedAt),
      index("asset_assignments_employee_idx").on(t.employeeId, t.returnedAt),
      check("asset_assignments_cond_out_chk", sql`${t.conditionOut} in ('new','good','fair','damaged')`),
      check("asset_assignments_cond_in_chk", sql`${t.conditionIn} is null or ${t.conditionIn} in ('new','good','fair','damaged')`),
      check("asset_assignments_return_chk", sql`(${t.returnedAt} is null) = (${t.conditionIn} is null) and (${t.returnedAt} is null) = (${t.receivedBy} is null)`),
    ],
  )
  .enableRLS();
