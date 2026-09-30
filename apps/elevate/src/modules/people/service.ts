import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { fieldCrypto } from "@/lib/crypto";
import { users } from "@/modules/core/schema";
import { SENSITIVE_FIELDS, type HistoryEvent, type SensitiveField } from "./constants";
import { employeeSensitive, employees, employmentHistory } from "./schema";
import { changeRequestContext, maskFor, sensitiveContext } from "./sensitive";

export { changeRequestContext, sensitiveContext };

// Shared building blocks for people actions. Nothing here checks permissions: callers do,
// before calling, with authorize() (CLAUDE.md rule 4).

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];


const COLUMNS = {
  tin: "tinEnc",
  sss: "sssEnc",
  philhealth: "philhealthEnc",
  pagibig: "pagibigEnc",
  bankName: "bankNameEnc",
  bankAccountName: "bankAccountNameEnc",
  bankAccountNumber: "bankAccountNumberEnc",
  payRate: "payRateEnc",
} as const satisfies Record<SensitiveField, keyof typeof employeeSensitive.$inferSelect>;

export const sensitiveColumn = (field: SensitiveField) => {
  // eslint-disable-next-line security/detect-object-injection -- typed SensitiveField key
  return COLUMNS[field];
};


export type SensitiveValues = Partial<Record<SensitiveField, string | null>>;

/**
 * Encrypt and save the given values (string = set, null = clear, missing = untouched).
 * Returns the labels of fields that actually changed. Does not write audit or history.
 */
export async function upsertSensitive(
  tx: Tx,
  employeeId: string,
  values: SensitiveValues,
  actorId: string,
): Promise<SensitiveField[]> {
  const [existing] = await tx.select().from(employeeSensitive).where(eq(employeeSensitive.employeeId, employeeId)).limit(1);
  const crypto = fieldCrypto();

  const patch: Record<string, string | null> = {};
  const masks: Record<string, string> = { ...(existing?.masks ?? {}) };
  const changed: SensitiveField[] = [];

  for (const field of SENSITIVE_FIELDS) {
    // eslint-disable-next-line security/detect-object-injection -- typed SensitiveField key
    const value = values[field];
    if (value === undefined) continue;

    const column = sensitiveColumn(field);
    // eslint-disable-next-line security/detect-object-injection -- `column` comes from a typed SensitiveField
    const before = existing?.[column] ?? null;
    if (value === null) {
      if (before === null) continue;
      patch[column] = null; // eslint-disable-line security/detect-object-injection
      delete masks[field]; // eslint-disable-line security/detect-object-injection
    } else {
      patch[column] = crypto.encrypt(value, sensitiveContext(field, employeeId)); // eslint-disable-line security/detect-object-injection
      masks[field] = maskFor(field, value); // eslint-disable-line security/detect-object-injection
    }
    changed.push(field);
  }

  if (changed.length === 0) return [];

  await tx
    .insert(employeeSensitive)
    .values({ employeeId, ...patch, masks, updatedBy: actorId })
    .onConflictDoUpdate({
      target: employeeSensitive.employeeId,
      set: { ...patch, masks, updatedBy: actorId, updatedAt: new Date() },
    });

  return changed;
}

export async function recordHistory(
  tx: Tx,
  entry: {
    employeeId: string;
    eventType: HistoryEvent;
    summary: string;
    before?: unknown;
    after?: unknown;
    changedBy: string | null;
    effectiveDate?: string;
  },
) {
  await tx.insert(employmentHistory).values({
    employeeId: entry.employeeId,
    eventType: entry.eventType,
    summary: entry.summary,
    before: entry.before ?? null,
    after: entry.after ?? null,
    changedBy: entry.changedBy,
    ...(entry.effectiveDate ? { effectiveDate: entry.effectiveDate } : {}),
  });
}

/**
 * The one unlinked sign-in account whose email exactly matches one of these addresses,
 * or null when there is none or more than one (never guess).
 */
export async function findLinkableUser(tx: Tx, emails: (string | null | undefined)[]) {
  const wanted = [...new Set(emails.filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase()))];
  if (wanted.length === 0) return null;

  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) in (${sql.join(wanted.map((e) => sql`${e}`), sql`, `)}) and ${users.archivedAt} is null`);

  const free: string[] = [];
  for (const { id } of rows) {
    const [taken] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, id)).limit(1);
    if (!taken) free.push(id);
  }
  return free.length === 1 ? free[0] : null;
}

/** Sign-in hook: attach a person's ELEVATE account to their people record by exact email. */
export async function linkEmployeeToUser(tx: Tx, input: { userId: string; email: string }) {
  const email = input.email.toLowerCase();
  const [already] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.userId, input.userId)).limit(1);
  if (already) return null;

  const matches = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(
      sql`${employees.userId} is null and ${employees.archivedAt} is null
          and (lower(${employees.workEmail}) = ${email} or lower(${employees.personalEmail}) = ${email})`,
    );
  if (matches.length !== 1) return null; // none, or ambiguous: HR links by hand

  await tx.update(employees).set({ userId: input.userId, updatedAt: new Date() }).where(eq(employees.id, matches[0].id));
  return matches[0].id;
}

