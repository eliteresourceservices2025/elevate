"use server";

import { and, eq, inArray } from "drizzle-orm";
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
import { esignEnvelopes, esignSigners, esignTemplates } from "./schema";
import { currentSignInMethods } from "./session";
import { issueExternalLinks } from "./external-mail";
import { appendEvent, endEnvelope, legalNames, recordSignature, sealEnvelope, sendDraft, voidEnvelopeTx } from "./service";
import { openSigningDocument } from "./document";
import { envelopeIdSchema, reasonSchema, signSchema, templateIdSchema } from "./validators";

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
      const result = await recordSignature(tx, { envelopeId: v.envelopeId, signerId: mine.id, kind: v.kind, typedText: v.typedText ?? null, png, ip: ip === "unknown" ? null : ip, methods, signedName: names.get(actor.id) ?? actor.email, actorUserId: actor.id });
      await writeAudit({ actor, action: "signing.sign", targetType: "esign_envelope", targetId: v.envelopeId, after: { kind: v.kind } }, tx);
      return result;
    });
    const ready = outcome.ready;
    if (outcome.externalIds.length) await issueExternalLinks(outcome.externalIds, "turn"); // the next signer is an outside person

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
      await endEnvelope(tx, envelopeId, "declined", "A signer declined", row.id);
      await appendEvent(tx, envelopeId, { type: "declined", actorUserId: actor.id, signerId: row.id, ip: ip === "unknown" ? null : ip, detail: { reason } });
      await notify(tx, [...new Set([env.createdBy, ...hr])].map((userId) => ({ userId, kind: "signing.declined", title: "A signer declined to sign", body: "Open Signing to see the reason.", link: `/signing/${envelopeId}` })));
      await writeAudit({ actor, action: "signing.decline", targetType: "esign_envelope", targetId: envelopeId, after: { reason } }, tx);
    });
    refresh(envelopeId);
    return { ok: true, data: undefined };
  });
}
