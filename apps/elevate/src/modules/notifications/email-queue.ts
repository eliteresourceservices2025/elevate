import "server-only";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/modules/core/schema";
import { getEmailSender } from "./email";
import { renderEmail } from "./email-content";
import { emailQueue } from "./schema";

type Executor = Pick<typeof db, "insert">;

export const EMAIL_PRIORITY = { ack_due: 1, digest: 2 } as const;
const MAX_ATTEMPTS = 3;
const DIGEST_MAX_AGE_HOURS = 24;

/** Emails allowed per rolling 24 hours. The free Resend plan sends 100 a day; we stay under it. */
export function dailyEmailBudget(): number {
  const n = Number(process.env.EMAIL_DAILY_BUDGET ?? 90);
  return Number.isFinite(n) ? Math.max(0, Math.min(1000, Math.floor(n))) : 90;
}

export type QueuedEmail = {
  userId: string;
  kind: keyof typeof EMAIL_PRIORITY;
  subject: string;
  heading: string;
  /** The message lines (counts only). */
  lines: string[];
  /** Relative in-app path. */
  link: string;
  /** Queuing the same key for the same person twice does nothing. */
  dedupeKey: string;
};

/** Adds emails to the queue. Returns how many were new. Pass a transaction to commit with the change. */
export async function queueEmails(executor: Executor, items: QueuedEmail[]): Promise<number> {
  if (items.length === 0) return 0;
  const inserted = await executor
    .insert(emailQueue)
    .values(
      items.map((i) => ({
        userId: i.userId,
        kind: i.kind,
        priority: EMAIL_PRIORITY[i.kind],
        subject: i.subject.slice(0, 200),
        body: JSON.stringify({ heading: i.heading, lines: i.lines }),
        link: i.link,
        dedupeKey: i.dedupeKey,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: emailQueue.id });
  return inserted.length;
}

export type FlushResult = { configured: boolean; sent: number; failed: number; skipped: number; budgetLeft: number };

/**
 * Sends queued email within the daily budget: acknowledgments first, then the digest, oldest first.
 * Without a configured sender nothing happens and everything stays queued. A send that fails is retried
 * on the next run, up to 3 attempts. A digest older than a day is dropped (it would be stale).
 */
export async function flushEmailQueue(now = new Date()): Promise<FlushResult> {
  const sender = getEmailSender();
  if (!sender) return { configured: false, sent: 0, failed: 0, skipped: 0, budgetLeft: 0 };

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const staleBefore = new Date(now.getTime() - DIGEST_MAX_AGE_HOURS * 60 * 60 * 1000);

  const dropped = await db
    .update(emailQueue)
    .set({ status: "skipped", lastError: "stale digest" })
    .where(and(eq(emailQueue.status, "queued"), eq(emailQueue.kind, "digest"), lt(emailQueue.createdAt, staleBefore)))
    .returning({ id: emailQueue.id });

  const [{ used }] = await db
    .select({ used: sql<number>`count(*)::int` })
    .from(emailQueue)
    .where(and(eq(emailQueue.status, "sent"), gte(emailQueue.sentAt, since)));
  const budgetLeft = dailyEmailBudget() - used;
  if (budgetLeft <= 0) return { configured: true, sent: 0, failed: 0, skipped: dropped.length, budgetLeft: 0 };

  const batch = await db
    .select({
      id: emailQueue.id,
      subject: emailQueue.subject,
      body: emailQueue.body,
      link: emailQueue.link,
      attempts: emailQueue.attempts,
      to: users.email,
      archivedAt: users.archivedAt,
    })
    .from(emailQueue)
    .innerJoin(users, eq(users.id, emailQueue.userId))
    .where(eq(emailQueue.status, "queued"))
    .orderBy(asc(emailQueue.priority), asc(emailQueue.createdAt))
    .limit(budgetLeft);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let sent = 0;
  let failed = 0;
  let skipped = dropped.length;

  for (const item of batch) {
    if (item.archivedAt) {
      await db.update(emailQueue).set({ status: "skipped", lastError: "account archived" }).where(eq(emailQueue.id, item.id));
      skipped += 1;
      continue;
    }
    const parsed = JSON.parse(item.body) as { heading: string; lines: string[] };
    const rendered = renderEmail({ heading: parsed.heading, lines: parsed.lines, link: item.link, appUrl });
    try {
      await sender.send({ to: item.to, subject: item.subject, text: rendered.text, html: rendered.html });
      await db.update(emailQueue).set({ status: "sent", sentAt: new Date(), attempts: item.attempts + 1, lastError: null }).where(eq(emailQueue.id, item.id));
      sent += 1;
    } catch (error) {
      const attempts = item.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db
        .update(emailQueue)
        .set({ attempts, status: giveUp ? "failed" : "queued", lastError: (error instanceof Error ? error.message : "send failed").slice(0, 200) })
        .where(eq(emailQueue.id, item.id));
      if (giveUp) failed += 1;
    }
  }
  return { configured: true, sent, failed, skipped, budgetLeft: budgetLeft - sent };
}
