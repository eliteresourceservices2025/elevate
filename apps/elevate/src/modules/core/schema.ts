import { sql } from "drizzle-orm";
import { pgSchema, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";

export const core = pgSchema("core");

// One row per signed-in person. `id` equals the Supabase auth user id.
// Roles arrive in Phase 0.3 (core.roles, core.user_roles).
export const users = core.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)]).enableRLS();

// Sign-up is allowed only for invited emails. The before-user-created auth hook
// (see drizzle custom migration) enforces this for every provider, including Google.
export const invitations = core.table("invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  invitedBy: uuid("invited_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
}, (t) => [uniqueIndex("invitations_email_lower_idx").on(sql`lower(${t.email})`)]).enableRLS();
