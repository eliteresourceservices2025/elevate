import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { describeExpiry, dueReminder } from "@/modules/documents/expiry";
import { hrUserIds, notify, type NewNotification } from "@/modules/notifications/service";
import { employees } from "@/modules/people/schema";
import { credentialReminders, credentials } from "./schema";
import { isRenewed } from "./service";

export type CredentialReminderRun = { checked: number; employeeNotices: number; hrSummaries: number };

/**
 * Daily: reminders at 30 days, 7 days and the end date for each certificate, once each (the unique row is the claim, so a repeat or
 * a missed day never double-sends and a certificate already inside the window only gets its most urgent notice). The person gets their
 * own notice; HR gets one summary. A certificate that was renewed (a later one with the same name exists), one for someone who has left,
 * and one that was removed send nothing. Certificates added or imported inside a window start silent (see silenceDueReminders).
 */
export async function runCredentialReminders(today: string): Promise<CredentialReminderRun> {
  const candidates = await db
    .select({ id: credentials.id, name: credentials.name, expiresOn: credentials.expiresOn, employeeId: credentials.employeeId, userId: employees.userId })
    .from(credentials)
    .innerJoin(employees, eq(employees.id, credentials.employeeId))
    .where(
      and(
        isNull(credentials.archivedAt),
        isNull(employees.archivedAt),
        sql`${employees.status} <> 'separated'`,
        sql`${credentials.expiresOn} <= ${today}::date + 30`,
        sql`not ${isRenewed()}`,
      ),
    );

  const sentRows = candidates.length
    ? await db.select({ credentialId: credentialReminders.credentialId, days: credentialReminders.daysBefore }).from(credentialReminders).where(inArray(credentialReminders.credentialId, candidates.map((c) => c.id)))
    : [];
  const sentBy = new Map<string, Set<number>>();
  for (const r of sentRows) sentBy.set(r.credentialId, (sentBy.get(r.credentialId) ?? new Set()).add(r.days));

  let employeeNotices = 0;
  let hrItems = 0;
  for (const c of candidates) {
    const decision = dueReminder(c.expiresOn, today, sentBy.get(c.id) ?? new Set());
    if (decision.send === null) continue;
    await db.transaction(async (tx) => {
      const claimed = await tx.insert(credentialReminders).values(decision.record.map((daysBefore) => ({ credentialId: c.id, daysBefore }))).onConflictDoNothing().returning({ daysBefore: credentialReminders.daysBefore });
      if (!claimed.some((r) => r.daysBefore === decision.send)) return;
      hrItems += 1;
      if (c.userId) {
        const note: NewNotification = {
          userId: c.userId,
          kind: "credential.expiring",
          title: `Your ${c.name} ${describeExpiry(c.expiresOn, today)}`,
          body: "Renew it and tell HR so your record stays current.",
          link: "/credentials",
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
        kind: "credential.expiring_summary",
        title: `${hrItems} ${hrItems === 1 ? "certificate needs" : "certificates need"} attention`,
        body: "Some certificates are expiring soon or have expired.",
        link: "/credentials?status=expiring",
      })),
    );
    hrSummaries = hr.length;
  }
  return { checked: candidates.length, employeeNotices, hrSummaries };
}
