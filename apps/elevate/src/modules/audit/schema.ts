import { bigserial, index, jsonb, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const ops = pgSchema("ops");

// Insert-only. A database trigger (see the drizzle custom migration) refuses
// UPDATE, DELETE and TRUNCATE, so history cannot be rewritten from the app.
export const auditLog = ops
  .table(
    "audit_log",
    {
      id: bigserial("id", { mode: "number" }).primaryKey(),
      occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
      actorUserId: uuid("actor_user_id"),
      actorEmail: text("actor_email"),
      action: text("action").notNull(),
      targetType: text("target_type"),
      targetId: text("target_id"),
      before: jsonb("before"),
      after: jsonb("after"),
      metadata: jsonb("metadata"),
      ip: text("ip"),
      userAgent: text("user_agent"),
    },
    (t) => [
      index("audit_log_occurred_at_idx").on(t.occurredAt),
      index("audit_log_actor_idx").on(t.actorUserId),
      index("audit_log_target_idx").on(t.targetType, t.targetId),
    ],
  )
  .enableRLS();
