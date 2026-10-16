"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { allowRequest, clientIp } from "@/lib/rate-limit";
import { ActionFailure, fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { MAX_SIGNATURE_PNG_BYTES, MAX_SIGNATURE_PNG_SIZE, isTypedSignatureEncodable, pngSize } from "./constants";
import { esignEnvelopes, esignEvents, esignSigners, esignTemplates } from "./schema";
import { currentSignInMethods } from "./session";
import { issueExternalLinks } from "./external-mail";
import { appendEvent, endEnvelope, legalNames, recordSignature, sealEnvelope, sendDraft, sendQueuedEmailNow, voidEnvelopeTx } from "./service";
import { openSigningDocument } from "./document";
import { resolveSigneeGroup, type SignerChoice } from "./queries";
import { archiveSchema, deleteTestSchema, envelopeIdSchema, reasonSchema, signSchema, signeeGroupSchema, templateIdSchema, testMarkSchema } from "./validators";

const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? "Check the form and try again.";
const refresh = (id?: string) => {
  revalidatePath("/signing");
  if (id) revalidatePath(`/signing/${id}`);
};

// ---- HR ---------------------------------------------------------------------------------------------------------------------

export async function sendEnvelope(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "signing.manage");
    const parsed = envelopeIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const ip = await clientIp();
    const sent = await db.transaction((tx) => sendDraft(tx, actor, parsed.data.envelopeId, ip === "unknown" ? null : ip));
    if (sent.externalIds.length) await issueExternalLinks(sent.externalIds, "turn");
    await sendQueuedEmailNow();
    refresh(parsed.data.envelopeId);
    return { ok: true, data: undefined };
  });
}

export async function voidEnvelope(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "signing.manage");
    const parsed = reasonSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { envelopeId, reason } = parsed.data;
    const ip = await clientIp();
    await db.transaction((tx) => voidEnvelopeTx(tx, actor, envelopeId, reason, ip === "unknown" ? null : ip));
    refresh(envelopeId);
    return { ok: true, data: undefined };
  });
}

/** The people in a group (everyone, a team, or a client's current assignments), for adding as signees. */
export async function findSignees(input: unknown): Promise<ActionResult<{ people: SignerChoice[] }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "signing.manage");
    const parsed = signeeGroupSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const people = await resolveSigneeGroup(parsed.data.kind, parsed.data.id ?? null);
    return { ok: true, data: { people } };
  });
}

/** Marks a document as a test (or removes the mark), so it can be told apart, archived, and (Super Admin) deleted. Audited. */
export async function setEnvelopeTest(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "signing.manage");
    const parsed = testMarkSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { envelopeId, isTest } = parsed.data;
    await db.transaction(async (tx) => {
      const [env] = await tx.select({ isTest: esignEnvelopes.isTest }).from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId)).for("update");
      if (!env) throw new ActionFailure("That document was not found.");
      if (env.isTest === isTest) return;
      await tx.update(esignEnvelopes).set({ isTest }).where(eq(esignEnvelopes.id, envelopeId));
      await writeAudit({ actor, action: isTest ? "signing.mark_test" : "signing.unmark_test", targetType: "esign_envelope", targetId: envelopeId, before: { isTest: env.isTest }, after: { isTest } }, tx);
    });
    refresh(envelopeId);
    return { ok: true, data: undefined };
  });
}

/** Hides a document from the lists (or brings it back). Nothing is deleted. A document still waiting for signatures must be voided first. */
export async function archiveEnvelope(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "signing.manage");
    const parsed = archiveSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { envelopeId, archived } = parsed.data;
    await db.transaction(async (tx) => {
      const [env] = await tx.select({ status: esignEnvelopes.status, archivedAt: esignEnvelopes.archivedAt }).from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId)).for("update");
      if (!env) throw new ActionFailure("That document was not found.");
      if (archived && env.status === "out") throw new ActionFailure("This document is still waiting for signatures. Void it first, then archive it.");
      if (Boolean(env.archivedAt) === archived) return;
      await tx.update(esignEnvelopes).set({ archivedAt: archived ? new Date() : null, archivedBy: archived ? actor.id : null }).where(eq(esignEnvelopes.id, envelopeId));
      await writeAudit({ actor, action: archived ? "signing.archive" : "signing.unarchive", targetType: "esign_envelope", targetId: envelopeId }, tx);
    });
    refresh(envelopeId);
    return { ok: true, data: undefined };
  });
}

/**
 * Permanently deletes a document that was marked as a test: its file, signed copy, signers and log. Super Admin only, with a reason.
 * A real document can never be deleted (the database refuses). The audit log keeps who deleted what and why, never the content.
 */
export async function deleteTestEnvelope(input: unknown): Promise<ActionResult<{ filesRemoved: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "signing.delete_test");
    const parsed = deleteTestSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { envelopeId, reason } = parsed.data;
    const paths: string[] = [];
    await db.transaction(async (tx) => {
      const [env] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId)).for("update");
      if (!env) throw new ActionFailure("That document was not found.");
      if (!env.isTest) throw new ActionFailure("Only a document marked as a test can be deleted. Archive it instead.");
      const used = await tx.execute(sql`select 1 from talent.offers where envelope_id = ${envelopeId} union all select 1 from talent.checklist_tasks where envelope_id = ${envelopeId} limit 1`);
      if ((used as unknown as unknown[]).length > 0) throw new ActionFailure("This document belongs to an offer or an onboarding task, so it cannot be deleted. Archive it instead.");
      const signers = await tx.select({ id: esignSigners.id }).from(esignSigners).where(eq(esignSigners.envelopeId, envelopeId));
      paths.push(env.originalPath, ...(env.sealedPath ? [env.sealedPath] : []));
      await tx.delete(esignEvents).where(eq(esignEvents.envelopeId, envelopeId));
      await tx.delete(esignSigners).where(eq(esignSigners.envelopeId, envelopeId));
      await tx.delete(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId));
      await writeAudit({ actor, action: "signing.delete_test", targetType: "esign_envelope", targetId: envelopeId, before: { title: env.title, status: env.status, signees: signers.length }, metadata: { reason } }, tx);
    });
    // The files go after the rows are gone; a failure leaves an orphan file, never a row pointing at nothing, and is reported.
    const filesRemoved = await getDocumentStorage().remove(BUCKETS.signed, paths).then(() => true, () => false);
    refresh();
    return { ok: true, data: { filesRemoved } };
  });
}

export async function remindSigners(input: unknown): Promise<ActionResult<{ reminded: number }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "signing.manage");
    const parsed = envelopeIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    if (!(await allowRequest("upload", actor.id))) return fail("Too many requests. Wait a few minutes and try again.");
    const { envelopeId } = parsed.data;
    const outside: string[] = [];
    const reminded = await db.transaction(async (tx) => {
      const [env] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId));
      if (!env || env.status !== "out") throw new ActionFailure("Only a document that is out for signature can be reminded.");
      const pending = await tx.select().from(esignSigners).where(and(eq(esignSigners.envelopeId, envelopeId), eq(esignSigners.status, "pending")));
      if (pending.length === 0) throw new ActionFailure("Nobody is waiting to sign right now.");
      await notify(tx, pending.flatMap((s) => (s.userId ? [{ userId: s.userId }] : [])).map((s) => ({ userId: s.userId, kind: "signing.turn", title: "Reminder: a document needs your signature", body: "Open Signing to read and sign it.", link: `/signing/${envelopeId}` })));
      outside.push(...pending.filter((s) => s.userId === null).map((s) => s.id));
      await tx.update(esignSigners).set({ lastNoticeAt: new Date() }).where(inArray(esignSigners.id, pending.map((s) => s.id)));
      await appendEvent(tx, envelopeId, { type: "reminded", actorUserId: actor.id, detail: { signers: pending.length } });
      return pending.length;
    });
    // Outside signers get a fresh link by email (it replaces the earlier one)
    if (outside.length) await issueExternalLinks(outside, "reminder");
    await sendQueuedEmailNow();
    refresh(envelopeId);
    return { ok: true, data: { reminded } };
  });
}

export async function discardDraft(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "signing.manage");
    const parsed = envelopeIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { envelopeId } = parsed.data;
    await db.transaction(async (tx) => {
      const [env] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId)).for("update");
      if (!env || env.status !== "draft") throw new ActionFailure("Only a draft can be discarded.");
      // The event log is append-only, so a draft with a log is voided instead of deleted.
      await endEnvelope(tx, envelopeId, "voided", "Draft discarded");
      await appendEvent(tx, envelopeId, { type: "voided", actorUserId: actor.id, detail: { reason: "Draft discarded" } });
      await writeAudit({ actor, action: "signing.discard_draft", targetType: "esign_envelope", targetId: envelopeId }, tx);
    });
    // The original file stays: evidence is kept even for a discarded draft.
    refresh(envelopeId);
    return { ok: true, data: undefined };
  });
}

export async function archiveTemplate(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "signing.manage");
    const parsed = templateIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    await db.transaction(async (tx) => {
      const [t] = await tx.update(esignTemplates).set({ archivedAt: new Date() }).where(eq(esignTemplates.id, parsed.data.templateId)).returning({ id: esignTemplates.id });
      if (!t) throw new ActionFailure("That template was not found.");
      await writeAudit({ actor, action: "signing.template_archive", targetType: "esign_template", targetId: parsed.data.templateId }, tx);
    });
    refresh();
    return { ok: true, data: undefined };
  });
}

// ---- Signers ----------------------------------------------------------------------------------------------------------------

/** The signer's own row in this envelope, or null. Everything a signer does goes through this. */
async function myRow(userId: string, envelopeId: string) {
  const [row] = await db.select().from(esignSigners).where(and(eq(esignSigners.envelopeId, envelopeId), eq(esignSigners.userId, userId)));
  return row ?? null;
}

/**
 * A 60-second link that downloads the document (the sealed copy once it is complete, the original before); the in-page viewer is the route /api/signing/[id]/document. The first time a signer opens it
 * is recorded: signing is only allowed after the document was opened. HR can open any envelope's document.
 */
export async function getDocumentLink(input: unknown): Promise<ActionResult<{ url: string; sealed: boolean }>> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = envelopeIdSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const doc = await openSigningDocument(actor, parsed.data.envelopeId);
    const url = await getDocumentStorage().createSignedDownload(BUCKETS.signed, doc.path, 60, doc.fileName);
    refresh(doc.envelopeId);
    return { ok: true, data: { url, sealed: doc.sealed } };
  });
}

export async function signEnvelope(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = signSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const v = parsed.data;
    const mine = await myRow(actor.id, v.envelopeId);
    // Not a signer here looks the same as no access.
    await authorize(actor, "signing.sign", { ownerUserId: mine?.userId ?? undefined });
    if (!mine) return fail("You do not have access to do that.");

    // The signature itself is checked on the server: a drawn one must be a small PNG, a typed one must be drawable in the PDF.
    let png: Buffer | null = null;
    if (v.kind === "drawn") {
      png = Buffer.from(v.pngBase64 ?? "", "base64");
      const size = pngSize(png);
      if (!size || png.length > MAX_SIGNATURE_PNG_BYTES || size.width > MAX_SIGNATURE_PNG_SIZE.width || size.height > MAX_SIGNATURE_PNG_SIZE.height || size.width < 20 || size.height < 10) return fail("That drawing could not be used. Clear it and draw again.");
    } else if (!isTypedSignatureEncodable(v.typedText ?? "")) {
      return fail("Type your name using English-alphabet letters, or draw your signature instead.");
    }

    const ip = await clientIp();
    const methods = await currentSignInMethods();
    const names = await legalNames(db, [actor.id]);
    const outcome = await db.transaction(async (tx) => {
      const result = await recordSignature(tx, { envelopeId: v.envelopeId, signerId: mine.id, kind: v.kind, typedText: v.typedText ?? null, png, ip: ip === "unknown" ? null : ip, methods, signedName: names.get(actor.id) ?? actor.email, actorUserId: actor.id, initials: v.initials ? { text: v.initials, pages: v.initialedPages ?? [] } : null, details: v.details ?? null });
      await writeAudit({ actor, action: "signing.sign", targetType: "esign_envelope", targetId: v.envelopeId, after: { kind: v.kind, initialed: Boolean(v.initials) } }, tx);
      return result;
    });
    const ready = outcome.ready;
    if (outcome.externalIds.length) await issueExternalLinks(outcome.externalIds, "turn"); // the next signer is an outside person
    if (!ready) await sendQueuedEmailNow(); // the next signer's email goes out now

    // Sealing is outside the signature's transaction: if it fails, the signature stands and a job seals it within minutes.
    if (ready) await sealEnvelope(v.envelopeId).catch((error) => console.error("sealing failed:", error instanceof Error ? error.name : "unknown error"));
    refresh(v.envelopeId);
    return { ok: true, data: undefined };
  });
}

export async function declineEnvelope(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    const parsed = reasonSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    const { envelopeId, reason } = parsed.data;
    const mine = await myRow(actor.id, envelopeId);
    await authorize(actor, "signing.sign", { ownerUserId: mine?.userId ?? undefined });
    if (!mine) return fail("You do not have access to do that.");
    const ip = await clientIp();
    const hr = await hrUserIds();
    await db.transaction(async (tx) => {
      const [env] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId)).for("update");
      const [row] = await tx.select().from(esignSigners).where(eq(esignSigners.id, mine.id)).for("update");
      if (!env || !row || env.status !== "out") throw new ActionFailure("This document is no longer waiting for signatures.");
      if (row.status !== "pending") throw new ActionFailure(row.status === "signed" ? "You already signed this." : "It is not your turn yet.");
      await tx.update(esignSigners).set({ status: "declined", declineReason: reason }).where(eq(esignSigners.id, row.id));
      await endEnvelope(tx, envelopeId, "declined", "A signee declined", row.id);
      await appendEvent(tx, envelopeId, { type: "declined", actorUserId: actor.id, signerId: row.id, ip: ip === "unknown" ? null : ip, detail: { reason } });
      await notify(tx, [...new Set([env.createdBy, ...hr])].map((userId) => ({ userId, kind: "signing.declined", title: "A signee declined to sign", body: "Open Signing to see the reason.", link: `/signing/${envelopeId}` })));
      await writeAudit({ actor, action: "signing.decline", targetType: "esign_envelope", targetId: envelopeId, after: { reason } }, tx);
    });
    refresh(envelopeId);
    return { ok: true, data: undefined };
  });
}
