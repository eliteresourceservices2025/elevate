import "server-only";
import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAudit } from "@/modules/audit/write";
import { notify } from "@/modules/notifications/service";
import { reminderDue } from "./constants";
import { esignEnvelopes, esignSigners } from "./schema";
import { issueExternalLinks } from "./external-mail";
import { appendEvent, endEnvelope, sealEnvelope } from "./service";
import { queueEmails } from "@/modules/notifications/email-queue";

/**
 * Daily: marks envelopes past their expiry as expired (waiting signers are cancelled and told), and reminds each person whose turn it
 * is every few days (an in-app notification and a short email, no document titles).
 */
export async function runEsignReminders(now = new Date()) {
  let expired = 0;
  let reminded = 0;

  const overdue = await db.select().from(esignEnvelopes).where(and(eq(esignEnvelopes.status, "out"), isNull(esignEnvelopes.allSignedAt), lt(esignEnvelopes.expiresAt, now)));
  for (const env of overdue) {
    await db.transaction(async (tx) => {
      const [fresh] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, env.id)).for("update");
      if (!fresh || fresh.status !== "out" || fresh.allSignedAt) return;
      await endEnvelope(tx, env.id, "expired", "Not signed in time");
      await appendEvent(tx, env.id, { type: "expired" }, now);
      const people = await tx.select({ userId: esignSigners.userId }).from(esignSigners).where(eq(esignSigners.envelopeId, env.id));
      await notify(tx, [...new Set([env.createdBy, ...people.flatMap((p) => (p.userId ? [p.userId] : []))])].map((userId) => ({ userId, kind: "signing.expired", title: "A document expired before everyone signed", body: "HR can send it again.", link: `/signing/${env.id}` })));
      await writeAudit({ actor: null, action: "signing.expire", targetType: "esign_envelope", targetId: env.id }, tx);
      expired += 1;
    });
  }

  const pending = await db
    .select({ id: esignSigners.id, userId: esignSigners.userId, envelopeId: esignSigners.envelopeId, lastNoticeAt: esignSigners.lastNoticeAt })
    .from(esignSigners)
    .innerJoin(esignEnvelopes, eq(esignEnvelopes.id, esignSigners.envelopeId))
    .where(and(eq(esignSigners.status, "pending"), eq(esignEnvelopes.status, "out"), isNull(esignEnvelopes.allSignedAt)));
  const day = now.toISOString().slice(0, 10);
  for (const s of pending) {
    if (!s.lastNoticeAt || !reminderDue(s.lastNoticeAt, now)) continue;
    // An outside signer (a candidate) has no account: they get a fresh emailed link (it replaces the earlier one)
    if (s.userId === null) {
      await db.transaction(async (tx) => {
        await appendEvent(tx, s.envelopeId, { type: "reminded", signerId: s.id }, now);
      });
      await issueExternalLinks([s.id], "reminder");
      reminded += 1;
      continue;
    }
    const userId = s.userId;
    await db.transaction(async (tx) => {
      await notify(tx, { userId, kind: "signing.turn", title: "Reminder: a document needs your signature", body: "Open Signing to read and sign it.", link: `/signing/${s.envelopeId}` });
      await queueEmails(tx, [{ userId, kind: "ack_due", subject: "Reminder: a document is waiting for your signature", heading: "Signature needed", lines: ["A document is still waiting for your signature in ELEVATE.", "Open it, read it, and sign if you agree."], link: `/signing/${s.envelopeId}`, dedupeKey: `esign-remind:${s.id}:${day}` }]);
      await tx.update(esignSigners).set({ lastNoticeAt: now }).where(eq(esignSigners.id, s.id));
      await appendEvent(tx, s.envelopeId, { type: "reminded", signerId: s.id }, now);
      reminded += 1;
    });
  }
  return { expired, reminded };
}

/**
 * Every few minutes: seals any envelope where everyone has signed but sealing did not finish (a crash or a storage hiccup right after
 * the last signature). Sealing is safe to repeat.
 */
export async function runEsignSealSweep() {
  const stuck = await db.select({ id: esignEnvelopes.id }).from(esignEnvelopes).where(and(eq(esignEnvelopes.status, "out"), isNotNull(esignEnvelopes.allSignedAt)));
  let sealed = 0;
  let failed = 0;
  for (const e of stuck) {
    try {
      if (await sealEnvelope(e.id)) sealed += 1;
    } catch (error) {
      failed += 1;
      console.error("sealing failed:", error instanceof Error ? error.name : "unknown error");
    }
  }
  return { sealed, failed };
}

