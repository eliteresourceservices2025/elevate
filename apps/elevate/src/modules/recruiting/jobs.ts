import "server-only";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { getEmailSender } from "@/modules/notifications/email";
import { retentionMonths } from "./constants";
import { applicationStageHistory, applications, candidateEmails, candidateNotes, candidates, scorecards } from "./schema";
import { getRetentionSettings } from "./service";

const MAX_ATTEMPTS = 3;

/** Emails to applicants allowed per rolling 24 hours (separate from the staff email budget; Resend's free plan is 100 a day). */
export function candidateEmailBudget(): number {
  const n = Number(process.env.CANDIDATE_EMAIL_DAILY_BUDGET ?? 20);
  return Number.isFinite(n) ? Math.max(0, Math.min(500, Math.floor(n))) : 20;
}

/** Sends queued applicant emails (received, rejection, interview) under their own daily cap. Without a sender nothing happens. */
export async function sendCandidateEmails(now = new Date()) {
  const sender = getEmailSender();
  if (!sender) return { configured: false, sent: 0, failed: 0, skipped: 0 };
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [{ used }] = await db.select({ used: sql<number>`count(*)::int` }).from(candidateEmails).where(and(eq(candidateEmails.status, "sent"), gte(candidateEmails.sentAt, since)));
  const left = candidateEmailBudget() - used;
  if (left <= 0) return { configured: true, sent: 0, failed: 0, skipped: 0 };

  const batch = await db
    .select({ id: candidateEmails.id, to: candidateEmails.toEmail, subject: candidateEmails.subject, body: candidateEmails.body, attachment: candidateEmails.attachment, attempts: candidateEmails.attempts, anonymized: candidates.anonymizedAt })
    .from(candidateEmails)
    .leftJoin(applications, eq(applications.id, candidateEmails.applicationId))
    .leftJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(eq(candidateEmails.status, "queued"))
    .orderBy(asc(candidateEmails.createdAt))
    .limit(left);

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const item of batch) {
    if (item.anonymized) {
      await db.update(candidateEmails).set({ status: "skipped", lastError: "applicant data removed" }).where(eq(candidateEmails.id, item.id));
      skipped += 1;
      continue;
    }
    const parsed = JSON.parse(item.body) as { text: string; html: string };
    try {
      await sender.send({ to: item.to, subject: item.subject, text: parsed.text, html: parsed.html, ...(item.attachment ? { attachments: [item.attachment] } : {}) });
      await db.update(candidateEmails).set({ status: "sent", sentAt: new Date(), attempts: item.attempts + 1, lastError: null }).where(eq(candidateEmails.id, item.id));
      sent += 1;
    } catch (error) {
      const attempts = item.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db
        .update(candidateEmails)
        .set({ attempts, status: giveUp ? "failed" : "queued", lastError: (error instanceof Error ? error.message : "send failed").slice(0, 200) })
        .where(eq(candidateEmails.id, item.id));
      if (giveUp) failed += 1;
    }
  }
  return { configured: true, sent, failed, skipped };
}

const addMonths = (d: Date, n: number) => {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + n);
  return out;
};

/**
 * Removes the personal data of applicants whose every application ended without a hire (rejected or withdrawn) longer ago than
 * the retention period. Does nothing until HR switches it on (the periods are for counsel to confirm). The candidate row stays
 * (name and email replaced, resume deleted) so counts and stage history still add up; notes, applicant emails and the free text
 * of scorecards are erased. Someone who was hired is never touched here.
 */
export async function runRecruitingRetention(now = new Date()) {
  const settings = await getRetentionSettings();
  if (!settings.retentionEnabled) return { enabled: false, candidates: 0 };

  const closed = await db
    .select({ candidateId: applications.candidateId, closeKind: applications.closeKind, closedAt: applications.closedAt })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(and(eq(applications.stage, "rejected"), sql`${applications.closedAt} is not null`, isNull(candidates.anonymizedAt)));
  const expired = new Set<string>();
  for (const c of closed) {
    const months = retentionMonths(c.closeKind as "rejected" | "withdrawn" | null, settings);
    if (months !== null && c.closedAt && addMonths(c.closedAt, months) <= now) expired.add(c.candidateId);
  }
  if (expired.size === 0) return { enabled: true, candidates: 0 };

  // A candidate with any application that is still open, hired, or not yet expired keeps their data.
  const keep = await db
    .select({ candidateId: applications.candidateId, stage: applications.stage, closeKind: applications.closeKind, closedAt: applications.closedAt })
    .from(applications)
    .where(inArray(applications.candidateId, [...expired]));
  const remove = [...expired].filter((id) =>
    keep
      .filter((a) => a.candidateId === id)
      .every((a) => {
        const months = a.stage === "rejected" ? retentionMonths(a.closeKind as "rejected" | "withdrawn" | null, settings) : null;
        return months !== null && a.closedAt !== null && addMonths(a.closedAt, months) <= now;
      }),
  );
  if (remove.length === 0) return { enabled: true, candidates: 0 };

  const files: string[] = [];
  let done = 0;
  for (const candidateId of remove) {
    const paths = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('talent.retention', 'on', true)`);
      const [c] = await tx.select({ resumePath: candidates.resumePath }).from(candidates).where(and(eq(candidates.id, candidateId), isNull(candidates.anonymizedAt)));
      if (!c) return null;
      const apps = (await tx.select({ id: applications.id }).from(applications).where(eq(applications.candidateId, candidateId))).map((a) => a.id);
      if (apps.length) {
        await tx.delete(candidateNotes).where(inArray(candidateNotes.applicationId, apps));
        await tx.delete(candidateEmails).where(inArray(candidateEmails.applicationId, apps));
        await tx.update(scorecards).set({ comments: "[removed]" }).where(inArray(scorecards.applicationId, apps));
        await tx.update(applicationStageHistory).set({ note: null }).where(inArray(applicationStageHistory.applicationId, apps));
        await tx.update(applications).set({ note: null, closeReason: null }).where(inArray(applications.id, apps));
      }
      await tx
        .update(candidates)
        .set({ email: `removed-${candidateId}@removed.invalid`, fullName: "Removed applicant", phone: null, country: null, resumePath: null, resumeName: null, resumeKind: null, resumeSha256: null, anonymizedAt: now })
        .where(eq(candidates.id, candidateId));
      await writeAudit({ actor: null, action: "recruiting.purge", targetType: "candidate", targetId: candidateId, metadata: { applications: apps.length } }, tx);
      return c.resumePath ? [c.resumePath] : [];
    });
    if (paths === null) continue;
    files.push(...paths);
    done += 1;
  }
  if (files.length) await getDocumentStorage().remove(BUCKETS.recruiting, files);
  return { enabled: true, candidates: done };
}
