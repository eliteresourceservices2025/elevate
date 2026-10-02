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
import { CONSENT_VERSION, DEFAULT_EXPIRY_DAYS, MAX_PDF_BYTES, MAX_SIGNERS, allSigned, envelopeReference, isPdf, signersToActivate, type EventType, type SigningOrder } from "./constants";
import { issueExternalLinks } from "./external-mail";
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

/** An ELEVATE user (userId) or an outside signer such as a candidate (external: name and email, signs by emailed link and code). */
export type SignerSpec = { userId?: string; external?: { name: string; email: string }; role?: string | null; position?: number };

export type NewEnvelope = {
  title: string;
  pdf: Uint8Array;
  fileName: string;
  templateId?: string | null;
  signers: SignerSpec[];
  order: SigningOrder;
  expiryDays: number;
  send: boolean;
  ip: string | null;
};

const SIGN_LINK = (envelopeId: string) => `/signing/${envelopeId}`;

/**
 * Tells signers it is their turn: ELEVATE users get an in-app notification and a short email (no names or titles in the email).
 * Returns the ids of outside signers, who are emailed their link AFTER the transaction commits (see issueExternalLinks).
 */
async function announceTurn(tx: Tx, envelopeId: string, signerIds: string[], kind: "turn" | "reminder", day: string): Promise<string[]> {
  if (signerIds.length === 0) return [];
  const rows = await tx.select({ id: esignSigners.id, userId: esignSigners.userId }).from(esignSigners).where(inArray(esignSigners.id, signerIds));
  const people = rows.filter((r): r is { id: string; userId: string } => r.userId !== null);
  await notify(tx, people.map((r) => ({ userId: r.userId, kind: "signing.turn", title: kind === "turn" ? "A document needs your signature" : "Reminder: a document needs your signature", body: "Open Signing to read and sign it.", link: SIGN_LINK(envelopeId) })));
  await queueEmails(
    tx,
    people.map((r) => ({
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
  return rows.filter((r) => r.userId === null).map((r) => r.id);
}

/** Moves a draft out for signature: the people whose turn it is get notified. */
export async function sendDraft(tx: Tx, actor: Actor, envelopeId: string, ip: string | null): Promise<{ externalIds: string[] }> {
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
  const externalIds = await announceTurn(tx, envelopeId, activeIds, "turn", now.toISOString().slice(0, 10));
  await writeAudit({ actor, action: "signing.send", targetType: "esign_envelope", targetId: envelopeId, after: { signers: signers.length } }, tx);
  return { externalIds };
}

/**
 * Creates an envelope from a PDF: validates the file by its bytes, stores the original (never edited), adds the signers and
 * the first event, and sends it unless `send` is false. Used by the HR form and, later, by offers and onboarding.
 */
export async function createEnvelope(actor: Actor, input: NewEnvelope): Promise<{ id: string; links: { sent: number; failed: number } | null }> {
  if (input.pdf.length === 0 || input.pdf.length > MAX_PDF_BYTES) throw new ActionFailure("The PDF must be 8 MB or smaller.");
  if (!isPdf(input.pdf)) throw new ActionFailure("That file is not a PDF.");
  let pages: number;
  try {
    pages = (await readPdfInfo(input.pdf)).pages;
  } catch (error) {
    throw new ActionFailure(error instanceof Error && /pages/.test(error.message) ? error.message : "That PDF cannot be used. Password-protected or damaged files are refused.");
  }
  if (input.signers.length === 0 || input.signers.length > MAX_SIGNERS) throw new ActionFailure(`Add between 1 and ${MAX_SIGNERS} signers.`);
  if (input.signers.some((s) => Boolean(s.userId) === Boolean(s.external))) throw new ActionFailure("Each signer is either an ELEVATE user or an outside person with a name and email.");
  const ids = input.signers.flatMap((s) => (s.userId ? [s.userId] : []));
  const outside = input.signers.flatMap((s) => (s.external ? [s.external.email.trim().toLowerCase()] : []));
  if (new Set(ids).size !== ids.length || new Set(outside).size !== outside.length) throw new ActionFailure("Each person can only be added once.");
  if (input.signers.some((s) => s.external && (s.external.name.trim().length < 2 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.external.email.trim())))) throw new ActionFailure("An outside signer needs a name and a valid email.");
  if (ids.length) {
    const real = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), isNull(users.archivedAt)));
    if (real.length !== ids.length) throw new ActionFailure("One of the signers does not have an active ELEVATE account.");
  }

  const sha = sha256Hex(input.pdf);
  const path = `originals/${randomUUID()}.pdf`;
  const storage = getDocumentStorage();
  await storage.write(BUCKETS.signed, path, input.pdf, "application/pdf");
  try {
    const created = await db.transaction(async (tx) => {
      const now = new Date();
      const [env] = await tx
        .insert(esignEnvelopes)
        .values({ title: input.title, templateId: input.templateId ?? null, createdBy: actor.id, signingOrder: input.order, originalPath: path, originalName: input.fileName.slice(0, 200), originalSha256: sha, pageCount: pages, expiresAt: new Date(now.getTime() + input.expiryDays * 86_400_000) })
        .returning({ id: esignEnvelopes.id });
      await tx.insert(esignSigners).values(
        input.signers.map((s, i) => ({
          envelopeId: env.id,
          userId: s.userId ?? null,
          externalEmail: s.external ? s.external.email.trim().toLowerCase() : null,
          externalName: s.external ? s.external.name.trim() : null,
          role: s.role ?? null,
          position: input.order === "parallel" ? 1 : (s.position ?? i + 1),
        })),
      );
      await appendEvent(tx, env.id, { type: "created", actorUserId: actor.id, ip: input.ip, detail: { sha256: sha, pages, signers: input.signers.length } }, now);
      await writeAudit({ actor, action: "signing.create", targetType: "esign_envelope", targetId: env.id, after: { signers: input.signers.length, pages } }, tx);
      const sent = input.send ? await sendDraft(tx, actor, env.id, input.ip) : { externalIds: [] as string[] };
      return { id: env.id, externalIds: sent.externalIds };
    });
    // Outside signers are emailed their link once the envelope is committed (the link points at a row that now exists)
    const links = created.externalIds.length ? await issueExternalLinks(created.externalIds, "turn") : null;
    return { id: created.id, links };
  } catch (error) {
    await storage.remove(BUCKETS.signed, [path]).catch(() => undefined);
    throw error;
  }
}

/** After a signature: wakes the next signer(s) in a sequential envelope, or marks the envelope ready to seal. */
export async function afterSignature(tx: Tx, envelopeId: string): Promise<{ ready: boolean; externalIds: string[] }> {
  const [env] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId));
  const signers = await tx.select().from(esignSigners).where(eq(esignSigners.envelopeId, envelopeId));
  const view = signers.map((s) => ({ position: s.position, status: s.status as never }));
  if (allSigned(view)) {
    await tx.update(esignEnvelopes).set({ allSignedAt: new Date() }).where(eq(esignEnvelopes.id, envelopeId));
    return { ready: true, externalIds: [] };
  }
  const turn = signersToActivate(env.signingOrder as SigningOrder, view);
  const wake = signers.filter((s) => s.status === "waiting" && turn.includes(s.position)).map((s) => s.id);
  if (wake.length) {
    await tx.update(esignSigners).set({ status: "pending" }).where(inArray(esignSigners.id, wake));
    const externalIds = await announceTurn(tx, envelopeId, wake, "turn", new Date().toISOString().slice(0, 10));
    return { ready: false, externalIds };
  }
  return { ready: false, externalIds: [] };
}

export type SignatureInput = {
  envelopeId: string;
  signerId: string;
  kind: "typed" | "drawn";
  typedText: string | null;
  png: Buffer | null;
  ip: string | null;
  methods: string | null;
  signedName: string;
  /** The ELEVATE user who signed, or null for an outside signer. */
  actorUserId: string | null;
};

/**
 * Records one signature inside the caller's transaction: the envelope must be out and unexpired, it must be this person's turn, and
 * they must have opened the document. Writes the consent and signed events, fills the signer row, and wakes the next signers or marks
 * the envelope ready to seal. Shared by ELEVATE users and outside signers, so both are held to exactly the same rules.
 */
export async function recordSignature(tx: Tx, v: SignatureInput): Promise<{ ready: boolean; externalIds: string[] }> {
  const [env] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, v.envelopeId)).for("update");
  const [row] = await tx.select().from(esignSigners).where(eq(esignSigners.id, v.signerId)).for("update");
  if (!env || !row || row.envelopeId !== v.envelopeId) throw new ActionFailure("That document was not found.");
  if (env.status !== "out") throw new ActionFailure(env.status === "completed" ? "Everyone has already signed this." : "This document is no longer waiting for signatures.");
  if (env.expiresAt && env.expiresAt.getTime() < Date.now()) throw new ActionFailure("This document has expired. Ask HR to send it again.");
  if (row.status === "signed") throw new ActionFailure("You already signed this.");
  if (row.status !== "pending") throw new ActionFailure("It is not your turn yet. You will be notified.");
  if (!row.viewedAt) throw new ActionFailure("Open the document and read it before you sign.");

  const now = new Date();
  await appendEvent(tx, v.envelopeId, { type: "consented", actorUserId: v.actorUserId, signerId: row.id, ip: v.ip, detail: { consentVersion: CONSENT_VERSION } }, now);
  await tx
    .update(esignSigners)
    .set({ status: "signed", signedAt: now, ip: v.ip, mfaMethods: v.methods, consentVersion: CONSENT_VERSION, signatureKind: v.kind, signedName: v.signedName, signatureText: v.kind === "typed" ? v.typedText : null, signaturePng: v.kind === "drawn" && v.png ? v.png.toString("base64") : null, codeHash: null, codeExpiresAt: null })
    .where(eq(esignSigners.id, row.id));
  await appendEvent(tx, v.envelopeId, { type: "signed", actorUserId: v.actorUserId, signerId: row.id, ip: v.ip, detail: { kind: v.kind, mfa: v.methods } }, new Date(now.getTime() + 1));
  return afterSignature(tx, v.envelopeId);
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

  const userIds = [env.createdBy, ...signers.flatMap((s) => (s.userId ? [s.userId] : []))];
  const names = await legalNames(db, userIds);
  const emails = new Map((await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, userIds))).map((u) => [u.id, u.email]));
  const signerNames = new Map(signers.map((x) => [x.id, x.signedName ?? x.externalName ?? (x.userId ? names.get(x.userId) : null) ?? "Unknown"]));
  const events = await db.select().from(esignEvents).where(eq(esignEvents.envelopeId, envelopeId)).orderBy(asc(esignEvents.seq));
  const sealedAt = new Date();
  const sealSigners: SealSigner[] = signers.map((s) => ({
    name: s.signedName ?? s.externalName ?? (s.userId ? names.get(s.userId) : null) ?? "Unknown",
    email: s.userId ? (emails.get(s.userId) ?? "") : (s.externalEmail ?? ""),
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
    events: events.map((e) => ({ seq: e.seq, type: e.type, at: e.at, actor: e.actorUserId ? (emails.get(e.actorUserId) ?? null) : e.signerId ? (signerNames.get(e.signerId) ?? null) : null, ip: e.ip })),
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
    await notify(tx, [...new Set(userIds)].map((userId) => ({ userId, kind: "signing.completed", title: "A document was signed by everyone", body: "The sealed copy is ready to download.", link: SIGN_LINK(envelopeId) })));
    await writeAudit({ actor: null, action: "signing.seal", targetType: "esign_envelope", targetId: envelopeId, after: { sha256: sha } }, tx);
    return true;
  });
  if (!done) await storage.remove(BUCKETS.signed, [path]).catch(() => undefined);
  // Outside signers get a link to read and download the signed copy
  if (done) await issueExternalLinks(signers.filter((x) => x.userId === null).map((x) => x.id), "completed").catch(() => undefined);
  return done;
}

/** Voids an envelope that is still waiting (a draft or out, and not yet fully signed). Signers who are ELEVATE users are told. */
export async function voidEnvelopeTx(tx: Tx, actor: Actor, envelopeId: string, reason: string, ip: string | null): Promise<void> {
  const [env] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId)).for("update");
  if (!env) throw new ActionFailure("That document was not found.");
  if (env.status !== "out" && env.status !== "draft") throw new ActionFailure("Only a document that is still waiting can be voided.");
  if (env.allSignedAt) throw new ActionFailure("Everyone has signed; it is being sealed and cannot be voided.");
  await endEnvelope(tx, envelopeId, "voided", reason);
  await appendEvent(tx, envelopeId, { type: "voided", actorUserId: actor.id, ip, detail: { reason } });
  const signers = await tx.select({ userId: esignSigners.userId }).from(esignSigners).where(eq(esignSigners.envelopeId, envelopeId));
  await notify(tx, signers.flatMap((s) => (s.userId ? [{ userId: s.userId }] : [])).map((s) => ({ userId: s.userId, kind: "signing.voided", title: "A document was withdrawn", body: "You no longer need to sign it.", link: SIGN_LINK(envelopeId) })));
  await writeAudit({ actor, action: "signing.void", targetType: "esign_envelope", targetId: envelopeId, after: { reason } }, tx);
}
