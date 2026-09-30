import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { redact } from "@/lib/redact";
import { auditLog } from "./schema";

export type AuditEntry = {
  actor?: { id: string; email: string } | null;
  /** Dotted verb, e.g. "roles.update", "auth.login". */
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
};

// Anything with `insert`, so callers can pass a transaction and commit the change and its audit row together.
type Executor = Pick<typeof db, "insert">;

async function requestInfo() {
  try {
    const h = await headers();
    return {
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    };
  } catch {
    return { ip: null, userAgent: null }; // background job: no request
  }
}

/**
 * Append one row to ops.audit_log. before/after/metadata are redacted first, so never pass
 * decrypted sensitive values here on purpose either. The table is insert-only.
 */
export async function writeAudit(entry: AuditEntry, executor: Executor = db): Promise<void> {
  const { ip, userAgent } = await requestInfo();

  await executor.insert(auditLog).values({
    actorUserId: entry.actor?.id ?? null,
    actorEmail: entry.actor?.email ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    before: entry.before === undefined ? null : redact(entry.before),
    after: entry.after === undefined ? null : redact(entry.after),
    metadata: entry.metadata === undefined ? null : redact(entry.metadata),
    ip,
    userAgent,
  });
}
