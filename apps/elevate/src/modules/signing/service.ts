import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AuthzUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { users } from "@/modules/core/schema";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { queueEmails } from "@/modules/notifications/email-queue";
import { notify } from "@/modules/notifications/service";
import { employees } from "@/modules/people/schema";
import { computeEventHash, GENESIS_HASH, sha256Hex } from "./chain";
import { DEFAULT_EXPIRY_DAYS, MAX_PDF_BYTES, MAX_SIGNERS, allSigned, envelopeReference, isPdf, signersToActivate, type EventType, type SigningOrder } from "./constants";
import { readPdfInfo, sealPdf, type SealSigner } from "./seal";
import { esignEnvelopes, esignEvents, esignSigners } from "./schema";

// Internals that take the acting user as an argument (not a "use server" file, so none of this is a public endpoint). Callers
// authorize first. Other modules (offers, onboarding) create envelopes through createEnvelope().

type Tx = Pick<typeof db, "insert" | "select" | "update" | "delete" | "execute">;
export type Actor = AuthzUser & { email: string };

/** The name printed on a certificate: the legal name from the people record, or the sign-in email when there is none. */
export async function legalNames(executor: Tx, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await executor
    .select({ userId: users.id, email: users.email, first: employees.legalFirstName, last: employees.legalLastName })
    .from(users)
    .leftJoin(employees, eq(employees.userId, users.id))
    .where(inArray(users.id, userIds));
  return new Map(rows.map((r) => [r.userId, r.first && r.last ? `${r.first} ${r.last}` : r.email]));
}

/** Adds the next event to an envelope's chain. The advisory lock keeps two writers from taking the same sequence number. */
export async function appendEvent(tx: Tx, envelopeId: string, e: { type: EventType; actorUserId?: string | null; signerId?: string | null; ip?: string | null; detail?: Record<string, unknown> | null }, at = new Date()) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`esign:${envelopeId}`}))`);
  const [last] = await tx.select({ seq: esignEvents.seq, hash: esignEvents.hash }).from(esignEvents).where(eq(esignEvents.envelopeId, envelopeId)).orderBy(desc(esignEvents.seq)).limit(1);
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const fields = { envelopeId, seq, type: e.type, actorUserId: e.actorUserId ?? null, signerId: e.signerId ?? null, at: at.toISOString(), ip: e.ip ?? null, detail: e.detail ?? null };
  await tx.insert(esignEvents).values({ ...fields, at, prevHash, hash: computeEventHash(prevHash, fields) });
}

export type NewEnvelope = {
  title: string;
  pdf: Uint8Array;
  fileName: string;
  templateId?: string | null;
  signers: { userId: string; role?: string | null; position?: number }[];
  order: SigningOrder;
  expiryDays: number;
  send: boolean;
  ip: string | null;
};

const SIGN_LINK = (envelopeId: string) => `/signing/${envelopeId}`;

/** Tells signers it is their turn: an in-app notification and a short email (no names or titles in the email). */
async function announceTurn(tx: Tx, envelopeId: string, signerIds: string[], kind: "turn" | "reminder", day: string) {
  if (signerIds.length === 0) return;
  const rows = await tx.select({ id: esignSigners.id, userId: esignSigners.userId }).from(esignSigners).where(inArray(esignSigners.id, signerIds));
  await notify(tx, rows.map((r) => ({ userId: r.userId, kind: "signing.turn", title: kind === "turn" ? "A document needs your signature" : "Reminder: a document needs your signature", body: "Open Signing to read and sign it.", link: SIGN_LINK(envelopeId) })));
  await queueEmails(
    tx,
    rows.map((r) => ({
      userId: r.userId,
      kind: "ack_due" as const,
      subject: kind === "turn" ? "A document is waiting for your signature" : "Reminder: a document is waiting for your signature",
      heading: "Signature needed",
      lines: ["A document is waiting for your signature in ELEVATE.", "Open it, read it, and sign if you agree. You will be asked for your sign-in code first."],
      link: SIGN_LINK(envelopeId),
      dedupeKey: kind === "turn" ? `esign-turn:${r.id}` : `esign-remind:${r.id}:${day}`,
    })),
  );
  await tx.update(esignSigners).set({ lastNoticeAt: new Date() }).where(inArray(esignSigners.id, signerIds));
}

/** Moves a draft out for signature: the people whose turn it is get notified. */
export async function sendDraft(tx: Tx, actor: Actor, envelopeId: string, ip: string | null) {
  const [env] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId)).for("update");
  if (!env) throw new ActionFailure("That document was not found.");
  if (env.status !== "draft") throw new ActionFailure("It was already sent.");
  const signers = await tx.select().from(esignSigners).where(eq(esignSigners.envelopeId, envelopeId));
  if (signers.length === 0) throw new ActionFailure("Add at least one signer first.");

  const now = new Date();
  // A draft kept for a while gets a fresh window from the day it is sent.
  const expiresAt = env.expiresAt && env.expiresAt.getTime() > now.getTime() + 86_400_000 ? env.expiresAt : new Date(now.getTime() + DEFAULT_EXPIRY_DAYS * 86_400_000);
  const active = signersToActivate(env.signingOrder as SigningOrder, signers.map((s) => ({ position: s.position, status: s.status as never })));
  const activeIds = signers.filter((s) => active.includes(s.position)).map((s) => s.id);
  await tx.update(esignEnvelopes).set({ status: "out", sentAt: now, expiresAt }).where(eq(esignEnvelopes.id, envelopeId));
  if (activeIds.length) await tx.update(esignSigners).set({ status: "pending" }).where(inArray(esignSigners.id, activeIds));
  await appendEvent(tx, envelopeId, { type: "sent", actorUserId: actor.id, ip, detail: { signers: signers.length, order: env.signingOrder } }, now);
  await announceTurn(tx, envelopeId, activeIds, "turn", now.toISOString().slice(0, 10));
  await writeAudit({ actor, action: "signing.send", targetType: "esign_envelope", targetId: envelopeId, after: { signers: signers.length } }, tx);
}

/**
 * Creates an envelope from a PDF: validates the file by its bytes, stores the original (never edited), adds the signers and
 * the first event, and sends it unless `send` is false. Used by the HR form and, later, by offers and onboarding.
 */
export async function createEnvelope(actor: Actor, input: NewEnvelope): Promise<{ id: string }> {
  if (input.pdf.length === 0 || input.pdf.length > MAX_PDF_BYTES) throw new ActionFailure("The PDF must be 8 MB or smaller.");
  if (!isPdf(input.pdf)) throw new ActionFailure("That file is not a PDF.");
  let pages: number;
  try {
    pages = (await readPdfInfo(input.pdf)).pages;
  } catch (error) {
    throw new ActionFailure(error instanceof Error && /pages/.test(error.message) ? error.message : "That PDF cannot be used. Password-protected or damaged files are refused.");
  }
  if (input.signers.length === 0 || input.signers.length > MAX_SIGNERS) throw new ActionFailure(`Add between 1 and ${MAX_SIGNERS} signers.`);
  const ids = input.signers.map((s) => s.userId);
  if (new Set(ids).size !== ids.length) throw new ActionFailure("Each person can only be added once.");
  const real = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), isNull(users.archivedAt)));
  if (real.length !== ids.length) throw new ActionFailure("One of the signers does not have an active ELEVATE account.");

  const sha = sha256Hex(input.pdf);
  const path = `originals/${randomUUID()}.pdf`;
  const storage = getDocumentStorage();
  await storage.write(BUCKETS.signed, path, input.pdf, "application/pdf");
  try {
    const id = await db.transaction(async (tx) => {
      const now = new Date();
      const [env] = await tx
        .insert(esignEnvelopes)
        .values({ title: input.title, templateId: input.templateId ?? null, createdBy: actor.id, signingOrder: input.order, originalPath: path, originalName: input.fileName.slice(0, 200), originalSha256: sha, pageCount: pages, expiresAt: new Date(now.getTime() + input.expiryDays * 86_400_000) })
        .returning({ id: esignEnvelopes.id });
      await tx.insert(esignSigners).values(
        input.signers.map((s, i) => ({ envelopeId: env.id, userId: s.userId, role: s.role ?? null, position: input.order === "parallel" ? 1 : (s.position ?? i + 1) })),
      );
      await appendEvent(tx, env.id, { type: "created", actorUserId: actor.id, ip: input.ip, detail: { sha256: sha, pages, signers: input.signers.length } }, now);
      await writeAudit({ actor, action: "signing.create", targetType: "esign_envelope", targetId: env.id, after: { signers: input.signers.length, pages } }, tx);
      if (input.send) await sendDraft(tx, actor, env.id, input.ip);
      return env.id;
    });
    return { id };
  } catch (error) {
    await storage.remove(BUCKETS.signed, [path]).catch(() => undefined);
    throw error;
  }
}

/** After a signature: wakes the next signer(s) in a sequential envelope, or marks the envelope ready to seal. */
export async function afterSignature(tx: Tx, envelopeId: string) {
  const [env] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId));
  const signers = await tx.select().from(esignSigners).where(eq(esignSigners.envelopeId, envelopeId));
  const view = signers.map((s) => ({ position: s.position, status: s.status as never }));
  if (allSigned(view)) {
    await tx.update(esignEnvelopes).set({ allSignedAt: new Date() }).where(eq(esignEnvelopes.id, envelopeId));
    return { ready: true };
  }
  const turn = signersToActivate(env.signingOrder as SigningOrder, view);
  const wake = signers.filter((s) => s.status === "waiting" && turn.includes(s.position)).map((s) => s.id);
  if (wake.length) {
    await tx.update(esignSigners).set({ status: "pending" }).where(inArray(esignSigners.id, wake));
    await announceTurn(tx, envelopeId, wake, "turn", new Date().toISOString().slice(0, 10));
  }
  return { ready: false };
}

/** Ends an envelope early (declined, voided or expired): waiting and pending signers are cancelled. */
export async function endEnvelope(tx: Tx, envelopeId: string, status: "declined" | "voided" | "expired", reason: string, keepSigner?: string) {
  await tx.update(esignEnvelopes).set({ status, endedAt: new Date(), endReason: reason }).where(eq(esignEnvelopes.id, envelopeId));
  const open = await tx.select({ id: esignSigners.id }).from(esignSigners).where(and(eq(esignSigners.envelopeId, envelopeId), inArray(esignSigners.status, ["waiting", "pending"])));
  const ids = open.map((o) => o.id).filter((id) => id !== keepSigner);
  if (ids.length) await tx.update(esignSigners).set({ status: "cancelled" }).where(inArray(esignSigners.id, ids));
}

/**
 * Seals an envelope whose signers have all signed: reads the original, checks it still matches its fingerprint, stamps the
 * signatures and certificate, stores the sealed copy and its fingerprint, and completes the envelope. Safe to run twice (a job
 * retries it). Returns true when this call completed it.
 */
export async function sealEnvelope(envelopeId: string): Promise<boolean> {
  const [env] = await db.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId));
  if (!env || env.status !== "out" || !env.allSignedAt) return false;
  const signers = await db.select().from(esignSigners).where(eq(esignSigners.envelopeId, envelopeId)).orderBy(asc(esignSigners.position), asc(esignSigners.signedAt));
  if (!allSigned(signers.map((s) => ({ position: s.position, status: s.status as never })))) return false;

  const storage = getDocumentStorage();
  const original = await storage.read(BUCKETS.signed, env.originalPath);
  if (!original) throw new Error("The original document is missing from storage.");
  if (sha256Hex(original) !== env.originalSha256) throw new Error("The original document no longer matches its fingerprint.");

  const names = await legalNames(db, [env.createdBy, ...signers.map((s) => s.userId)]);
  const emails = new Map((await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, [env.createdBy, ...signers.map((s) => s.userId)]))).map((u) => [u.id, u.email]));
  const events = await db.select().from(esignEvents).where(eq(esignEvents.envelopeId, envelopeId)).orderBy(asc(esignEvents.seq));
  const sealedAt = new Date();
  const sealSigners: SealSigner[] = signers.map((s) => ({
    name: s.signedName ?? names.get(s.userId) ?? "Unknown",
    email: emails.get(s.userId) ?? "",
    role: s.role,
    signedAt: s.signedAt as Date,
    ip: s.ip,
    mfa: s.mfaMethods,
    kind: (s.signatureKind as "typed" | "drawn") ?? "typed",
    typedText: s.signatureText,
    png: s.signaturePng ? new Uint8Array(Buffer.from(s.signaturePng, "base64")) : null,
    consentVersion: s.consentVersion ?? "",
  }));
  const bytes = await sealPdf({
    original,
    title: env.title,
    reference: envelopeReference(env.id),
    originalSha256: env.originalSha256,
    createdBy: `${names.get(env.createdBy) ?? "ERS"} (${emails.get(env.createdBy) ?? ""})`,
    signers: sealSigners,
    events: events.map((e) => ({ seq: e.seq, type: e.type, at: e.at, actor: e.actorUserId ? (emails.get(e.actorUserId) ?? null) : null, ip: e.ip })),
    sealedAt,
  });
  const sha = sha256Hex(bytes);
  const path = `sealed/${env.id}-${randomUUID().slice(0, 8)}.pdf`;
  await storage.write(BUCKETS.signed, path, bytes, "application/pdf");

  const done = await db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId)).for("update");
    if (!fresh || fresh.status !== "out" || fresh.sealedSha256) return false; // someone else sealed it first
    await tx.update(esignEnvelopes).set({ status: "completed", sealedPath: path, sealedSha256: sha, sealedAt, endedAt: sealedAt }).where(eq(esignEnvelopes.id, envelopeId));
    await appendEvent(tx, envelopeId, { type: "sealed", detail: { sha256: sha } }, sealedAt);
    await notify(tx, [...new Set([env.createdBy, ...signers.map((s) => s.userId)])].map((userId) => ({ userId, kind: "signing.completed", title: "A document was signed by everyone", body: "The sealed copy is ready to download.", link: SIGN_LINK(envelopeId) })));
    await writeAudit({ actor: null, action: "signing.seal", targetType: "esign_envelope", targetId: envelopeId, after: { sha256: sha } }, tx);
    return true;
  });
  if (!done) await storage.remove(BUCKETS.signed, [path]).catch(() => undefined);
  return done;
}
