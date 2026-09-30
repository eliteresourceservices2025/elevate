import "server-only";
import { db } from "@/lib/db";
import { reminderDue } from "./due";
import { pendingAcknowledgments, queueAckEmails, remindPending, type ReminderSubject } from "./service";

// Background work (no signed-in person). src/inngest wraps these in scheduled functions.

export type AckReminderRun = { items: number; notified: number };

/**
 * Daily: reminds people who have not acknowledged an item that has a due date, 3 days before, on the day,
 * and once a week while overdue. Each item and day is claimed once, so running twice sends nothing twice.
 * In-app notices go out immediately; the emails are queued and sent under the daily budget.
 */
export async function runAckReminders(today: string): Promise<AckReminderRun> {
  const pending = await pendingAcknowledgments(db);

  const bySubject = new Map<string, { subject: ReminderSubject; dueOn: string; rows: typeof pending }>();
  for (const p of pending) {
    if (!p.dueOn || !reminderDue(p.dueOn, today)) continue;
    const subject: ReminderSubject = p.kind === "announcement" ? { kind: "announcement", id: p.id } : { kind: "policy_version", id: p.versionId! };
    const key = `${subject.kind}:${subject.id}`;
    const entry = bySubject.get(key) ?? { subject, dueOn: p.dueOn, rows: [] };
    entry.rows.push(p);
    bySubject.set(key, entry);
  }

  let notified = 0;
  const userIds = new Set<string>();
  for (const { subject, rows } of bySubject.values()) {
    const done = await db.transaction((tx) => remindPending(tx, subject, rows, today, "scheduled", null));
    if (!done) continue; // today's reminder for this item already went out
    notified += done.length;
    for (const id of done) userIds.add(id);
  }
  if (userIds.size > 0) await queueAckEmails(db, [...userIds], today);
  return { items: bySubject.size, notified };
}
