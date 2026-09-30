import "server-only";
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { hrUserIds, notify, type NewNotification } from "@/modules/notifications/service";
import { employees } from "@/modules/people/schema";
import { describeExpiry, dueReminder } from "./expiry";
import { documentReminders, documentTypes, documents } from "./schema";
import { getDocumentStorage, type Bucket } from "./storage";

// Background work. These are plain functions (no request, no signed-in user) so tests can call them
// directly; src/inngest wraps them in scheduled functions. Audit rows here have no actor ("system").

const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ReminderRun = { checked: number; employeeNotices: number; hrSummaries: number };

/**
 * Sends the expiry reminders that are due today: 30 days, 7 days and the day itself. Each document and
 * threshold is recorded once, so running this twice (or after a missed day) never sends duplicates and
 * never floods: a document already inside the 7-day window only gets the 7-day message.
 * The person gets their own notification; HR gets one summary with a link.
 */
export async function runExpiryReminders(today: string): Promise<ReminderRun> {
  const candidates = await db
    .select({
      id: documents.id,
      expiresOn: documents.expiresOn,
      employeeId: documents.employeeId,
      typeName: documentTypes.name,
      userId: employees.userId,
    })
    .from(documents)
    .innerJoin(documentTypes, eq(documentTypes.id, documents.typeId))
    .innerJoin(employees, eq(employees.id, documents.employeeId))
    .where(
      and(
        eq(documents.status, "active"),
        isNull(documents.archivedAt),
        isNotNull(documents.expiresOn),
        isNull(employees.archivedAt),
        sql`${employees.status} <> 'separated'`,
        sql`${documents.expiresOn} <= ${today}::date + 30`,
      ),
    );

  const sentRows = candidates.length
    ? await db.select({ documentId: documentReminders.documentId, days: documentReminders.daysBefore }).from(documentReminders).where(inArray(documentReminders.documentId, candidates.map((c) => c.id)))
    : [];
  const sentBy = new Map<string, Set<number>>();
  for (const r of sentRows) sentBy.set(r.documentId, (sentBy.get(r.documentId) ?? new Set()).add(r.days));

  let employeeNotices = 0;
  let hrItems = 0;

  for (const c of candidates) {
    const decision = dueReminder(c.expiresOn!, today, sentBy.get(c.id) ?? new Set());
    if (decision.send === null) continue;

    await db.transaction(async (tx) => {
      // The unique index makes this the claim: if another run got there first, we skip quietly.
      const claimed = await tx
        .insert(documentReminders)
        .values(decision.record.map((daysBefore) => ({ documentId: c.id, daysBefore })))
        .onConflictDoNothing()
        .returning({ daysBefore: documentReminders.daysBefore });
      if (!claimed.some((r) => r.daysBefore === decision.send)) return;

      hrItems += 1;
      if (c.userId) {
        const note: NewNotification = {
          userId: c.userId,
          kind: "document.expiring",
          title: `Your ${c.typeName} ${describeExpiry(c.expiresOn!, today)}`,
          body: "Upload a renewed copy so your records stay current.",
          link: `/people/${c.employeeId}?tab=documents`,
        };
        await notify(tx, note);
        employeeNotices += 1;
      }
    });
  }

  let hrSummaries = 0;
  if (hrItems > 0) {
    const hr = await hrUserIds();
    await notify(
      db,
      hr.map((userId) => ({
        userId,
        kind: "document.expiring_summary",
        title: `${hrItems} ${hrItems === 1 ? "document needs" : "documents need"} attention`,
        body: "Some documents are expiring soon or have expired.",
        link: "/documents?tab=attention",
      })),
    );
    hrSummaries = hr.length;
  }

  return { checked: candidates.length, employeeNotices, hrSummaries };
}

/**
 * Removes uploads that were started but never finished (the browser closed, the file failed a check
 * and the person walked away). Pending rows older than 24 hours are deleted along with any stored object.
 */
export async function cleanupPendingUploads(now = new Date()): Promise<{ removed: number }> {
  const cutoff = new Date(now.getTime() - PENDING_MAX_AGE_MS);
  const stale = await db
    .select({ id: documents.id, bucket: documents.storageBucket, path: documents.storagePath, employeeId: documents.employeeId })
    .from(documents)
    .where(and(eq(documents.status, "pending"), lt(documents.createdAt, cutoff)));
  if (stale.length === 0) return { removed: 0 };

  const storage = getDocumentStorage();
  const byBucket = new Map<Bucket, string[]>();
  for (const s of stale) byBucket.set(s.bucket as Bucket, [...(byBucket.get(s.bucket as Bucket) ?? []), s.path]);
  for (const [bucket, paths] of byBucket) await storage.remove(bucket, paths).catch(() => undefined);

  await db.transaction(async (tx) => {
    await tx.delete(documents).where(and(inArray(documents.id, stale.map((s) => s.id)), eq(documents.status, "pending")));
    await writeAudit({ actor: null, action: "document.upload_expired", metadata: { count: stale.length } }, tx);
  });
  return { removed: stale.length };
}
