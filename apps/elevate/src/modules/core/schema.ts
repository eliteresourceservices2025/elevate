import { sql } from "drizzle-orm";
import { boolean, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const core = pgSchema("core");

// One row per signed-in person. `id` equals the Supabase auth user id.
export const users = core
  .table(
    "users",
    {
      id: uuid("id").primaryKey(),
      email: text("email").notNull(),
      // Safe Voice handlers are named individually; a role never grants case access.
      isSafevoiceHandler: boolean("is_safevoice_handler").notNull().default(false),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
    },
    (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
  )
  .enableRLS();

// Sign-up is allowed only for invited emails. The before-user-created auth hook
// (see drizzle custom migration) enforces this for every provider, including Google.
export const invitations = core
  .table(
    "invitations",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      email: text("email").notNull(),
      invitedBy: uuid("invited_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    },
    (t) => [uniqueIndex("invitations_email_lower_idx").on(sql`lower(${t.email})`)],
  )
  .enableRLS();

// Reference data, inserted by the migration. Slugs match ROLE_SLUGS in src/lib/roles.ts.
export const roles = core
  .table("roles", {
    slug: text("slug").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
  })
  .enableRLS();

export const userRoles = core
  .table(
    "user_roles",
    {
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      roleSlug: text("role_slug")
        .notNull()
        .references(() => roles.slug),
      grantedBy: uuid("granted_by"),
      grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.userId, t.roleSlug] })],
  )
  .enableRLS();
