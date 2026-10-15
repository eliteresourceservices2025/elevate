import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { blankEmployeeDocuments } from "@/modules/documents/retention";
import { getDocumentStorage, type Bucket } from "@/modules/documents/storage";
import { retentionStage, DEFAULT_ANONYMIZE_AFTER_MONTHS, DEFAULT_ARCHIVE_AFTER_MONTHS } from "./retention-rules";
import { customFieldValues, emergencyContacts, employeeSensitive, employees, peopleRetentionSettings } from "./schema";

// Internals for the retention job and its settings form. Not a "use server" file: nothing here is a public endpoint.

export async function getPeopleRetentionSettings(executor: Pick<typeof db, "select"> = db) {
  const [row] = await executor.select().from(peopleRetentionSettings).where(eq(peopleRetentionSettings.id, 1));
  return (
    row ?? {
      id: 1,
      enabled: false,
      archiveAfterMonths: DEFAULT_ARCHIVE_AFTER_MONTHS,
      anonymizeAfterMonths: DEFAULT_ANONYMIZE_AFTER_MONTHS,
      updatedBy: null,
      updatedAt: new Date(),
    }
  );
}

/** Counts only, for the dry run on the settings page and for the job's result. Never names. */
export async function peopleRetentionCounts(now = new Date()) {
  const settings = await getPeopleRetentionSettings();
  const rows = await db
    .select({ status: employees.status, endDate: employees.endDate, legalHoldAt: employees.legalHoldAt, anonymizedAt: employees.anonymizedAt, retentionArchivedAt: employees.retentionArchivedAt })
    .from(employees)
    .where(and(eq(employees.status, "separated"), isNull(employees.anonymizedAt)));
  let toArchive = 0;
  let toAnonymize = 0;
  let onHold = 0;
  for (const r of rows) {
    if (r.legalHoldAt) {
      onHold += 1;
      continue;
    }
    const stage = retentionStage({ status: r.status, endDate: r.endDate, legalHold: false, anonymized: false }, settings, now);
    if (stage === "archive_due" && !r.retentionArchivedAt) toArchive += 1;
    if (stage === "anonymize_due") toAnonymize += 1;
  }
  return { enabled: settings.enabled, toArchive, toAnonymize, onHold };
}

/**
 * Moves separated people through the retention stages. Does nothing until HR switches it on (the periods are for counsel to
 * confirm). Archive = HR-only access, nothing erased. Anonymize = personal fields replaced, sensitive fields, emergency
 * contacts, custom values and files removed; ledgers, clock events and the audit log are append-only and are not rewritten.
 * Someone with a legal hold is skipped. Safe to run twice.
 */
export async function runPeopleRetention(now = new Date()) {
  const settings = await getPeopleRetentionSettings();
  if (!settings.enabled) return { enabled: false, archived: 0, anonymized: 0 };

  const rows = await db
    .select({ id: employees.id, status: employees.status, endDate: employees.endDate, legalHoldAt: employees.legalHoldAt, retentionArchivedAt: employees.retentionArchivedAt })
    .from(employees)
    .where(and(eq(employees.status, "separated"), isNull(employees.anonymizedAt), isNull(employees.legalHoldAt)));

  let archived = 0;
  let anonymized = 0;
  for (const r of rows) {
    const stage = retentionStage({ status: r.status, endDate: r.endDate, legalHold: false, anonymized: false }, settings, now);
    if (stage === "archive_due" && !r.retentionArchivedAt) {
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(employees)
          .set({ retentionArchivedAt: now, updatedAt: now })
          .where(and(eq(employees.id, r.id), isNull(employees.retentionArchivedAt), isNull(employees.anonymizedAt), isNull(employees.legalHoldAt)))
          .returning({ id: employees.id });
        if (updated.length === 0) return;
        await writeAudit({ actor: null, action: "retention.archive", targetType: "employee", targetId: r.id }, tx);
        archived += 1;
      });
    } else if (stage === "anonymize_due") {
      const files = await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('core.retention', 'on', true)`);
        const [held] = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(and(eq(employees.id, r.id), isNull(employees.anonymizedAt), isNull(employees.legalHoldAt)))
          .for("update");
        if (!held) return null;
        await tx
          .update(employees)
          .set({
            legalFirstName: "Removed",
            legalMiddleName: null,
            legalLastName: "Person",
            preferredName: null,
            birthDate: null,
            civilStatus: null,
            workEmail: `removed-${r.id}@removed.invalid`,
            personalEmail: null,
            mobile: null,
            addressLine: null,
            city: null,
            province: null,
            postalCode: null,
            retentionArchivedAt: r.retentionArchivedAt ?? now,
            anonymizedAt: now,
            updatedAt: now,
          })
          .where(eq(employees.id, r.id));
        const sensitive = await tx.delete(employeeSensitive).where(eq(employeeSensitive.employeeId, r.id)).returning({ id: employeeSensitive.employeeId });
        const contacts = await tx.delete(emergencyContacts).where(eq(emergencyContacts.employeeId, r.id)).returning({ id: emergencyContacts.id });
        const custom = await tx.delete(customFieldValues).where(eq(customFieldValues.employeeId, r.id)).returning({ id: customFieldValues.fieldDefId });
        const docs = await blankEmployeeDocuments(tx, r.id, now);
        await writeAudit(
          { actor: null, action: "retention.anonymize", targetType: "employee", targetId: r.id, metadata: { sensitive: sensitive.length, contacts: contacts.length, customValues: custom.length, files: docs.length } },
          tx,
        );
        return docs;
      });
      if (files === null) continue;
      const byBucket = new Map<Bucket, string[]>();
      for (const f of files) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
      for (const [bucket, paths] of byBucket) await getDocumentStorage().remove(bucket, paths);
      anonymized += 1;
    }
  }
  return { enabled: true, archived, anonymized };
}
