import "server-only";
import { and, eq, exists, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import { dueReminder } from "@/modules/documents/expiry";
import { credentialReminders, credentials } from "./schema";

type Tx = Pick<typeof db, "insert">;

/** True for a certificate that a later one (same person, same name, later end date) has replaced. Used in a where clause on `credentials`. */
export function isRenewed() {
  const later = alias(credentials, "later");
  return exists(
    db
      .select({ one: sql`1` })
      .from(later)
      .where(and(eq(later.employeeId, credentials.employeeId), sql`lower(${later.name}) = lower(${credentials.name})`, isNull(later.archivedAt), sql`${later.expiresOn} > ${credentials.expiresOn}`)),
  );
}

/**
 * A certificate that is recorded already inside a reminder window must not trigger a burst of notices the moment it is added.
 * The thresholds it has already passed are marked as handled, so only the NEXT ones send.
 */
export async function silenceDueReminders(tx: Tx, credentialId: string, expiresOn: string, today: string): Promise<void> {
  const { record } = dueReminder(expiresOn, today, new Set());
  if (record.length === 0) return;
  await tx.insert(credentialReminders).values(record.map((daysBefore) => ({ credentialId, daysBefore }))).onConflictDoNothing();
}
