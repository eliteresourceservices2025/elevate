import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { hrUserIds, notify } from "@/modules/notifications/service";
import { MAX_SIGNATURE_PNG_BYTES, MAX_SIGNATURE_PNG_SIZE, isTypedSignatureEncodable, pngSize } from "./constants";
import { codeHash, codeMail, issueExternalLinks, newCode, sendDirect, sha256 } from "./external-mail";
import { esignEnvelopes, esignSigners } from "./schema";
import { appendEvent, endEnvelope, recordSignature, sealEnvelope } from "./service";

// Signing by an outside person (a candidate with an offer). The emailed link proves nothing by itself: they must also enter a 6-digit
// code emailed to the same address. A wrong code five times locks that code (they ask for a new one). After the right code a random
// session value goes into an httpOnly cookie (only its hash is stored) for two hours. Everything after that goes through
// recordSignature(), the same rules as an ELEVATE user.

export const SESSION_COOKIE = "elevate_sign_session";
export const CODE_MINUTES = 15;
export const MAX_CODE_TRIES = 5;
export const MAX_CODES_PER_HOUR = 5;
const SESSION_HOURS = 2;
const AFTER_CLOSE_DAYS = 30; // a finished or ended document stays reachable by its link this long (to download the signed copy)

type SignerRow = typeof esignSigners.$inferSelect;
type EnvelopeRow = typeof esignEnvelopes.$inferSelect;

export type ExternalContext = { signer: SignerRow; env: EnvelopeRow; state: "waiting" | "active" | "signed" | "done" | "closed" };

/** The signer and envelope behind a link token, or null if the link is unknown, replaced by a newer one, or too old. */
export async function resolveToken(token: string): Promise<ExternalContext | null> {
  if (!/^[A-Za-z0-9_-]{30,64}$/.test(token)) return null;
  const hash = sha256(token);
  const [signer] = await db.select().from(esignSigners).where(or(eq(esignSigners.accessTokenHash, hash), eq(esignSigners.previousTokenHash, hash)));
  if (!signer || !signer.externalEmail) return null;
  const [env] = await db.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, signer.envelopeId));
  if (!env || env.status === "draft") return null;
  // The earlier link works only to open the signed copy of a finished document
  if (signer.accessTokenHash !== hash && env.status !== "completed") return null;
  const now = Date.now();
  if (env.status === "out") {
    if (env.expiresAt && env.expiresAt.getTime() < now) return { signer, env, state: "closed" };
    return { signer, env, state: signer.status === "signed" ? "signed" : signer.status === "pending" ? "active" : "waiting" };
  }
  const ended = env.endedAt ?? env.sealedAt ?? env.createdAt;
  if (now - ended.getTime() > AFTER_CLOSE_DAYS * 86_400_000) return null;
  return { signer, env, state: env.status === "completed" ? "done" : "closed" };
}

export function sessionValid(ctx: ExternalContext, cookieValue: string | undefined): boolean {
  if (!cookieValue || !ctx.signer.sessionHash || !ctx.signer.sessionExpiresAt) return false;
  if (ctx.signer.sessionExpiresAt.getTime() < Date.now()) return false;
  const a = Buffer.from(sha256(cookieValue));
  const b = Buffer.from(ctx.signer.sessionHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Emails a new 6-digit code (replacing any earlier one). At most five an hour per person. Returns false when it was not sent. */
export async function requestCode(ctx: ExternalContext): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ctx.state === "closed") return { ok: false, error: "This document is no longer open for signing." };
  if (ctx.state === "waiting") return { ok: false, error: "It is not your turn yet. We will email you when it is." };
  const hourAgo = Date.now() - 3_600_000;
  const recent = (ctx.signer.codeSentAt ?? []).filter((d) => d.getTime() > hourAgo);
  if (recent.length >= MAX_CODES_PER_HOUR) return { ok: false, error: "Too many codes requested. Please wait a while and try again." };
  const code = newCode();
  await db
    .update(esignSigners)
    .set({ codeHash: codeHash(ctx.signer.id, code), codeExpiresAt: new Date(Date.now() + CODE_MINUTES * 60_000), codeAttempts: 0, codeSentAt: [...recent, new Date()] })
    .where(eq(esignSigners.id, ctx.signer.id));
  const sent = await sendDirect(ctx.signer.externalEmail as string, codeMail(ctx.signer.externalName ?? "", code));
  if (!sent) return { ok: false, error: "We could not send the code right now. Please try again in a few minutes." };
  return { ok: true };
}

/**
 * Checks a code. Five wrong tries lock it (a new code is needed); an expired code fails; the right one is single use. On success
 * returns the session value for the cookie (only its hash is kept) and records that they proved access to the email.
 */
export async function checkCode(ctx: ExternalContext, code: string, ip: string | null): Promise<{ ok: true; session: string } | { ok: false; error: string }> {
  const bad = "That code is not right.";
  if (!/^\d{6}$/.test(code)) return { ok: false, error: bad };
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(esignSigners).where(eq(esignSigners.id, ctx.signer.id)).for("update");
    if (!row || !row.codeHash || !row.codeExpiresAt) return { ok: false as const, error: "Ask for a new code first." };
    if (row.codeExpiresAt.getTime() < Date.now()) return { ok: false as const, error: "That code has expired. Ask for a new one." };
    if (row.codeAttempts >= MAX_CODE_TRIES) return { ok: false as const, error: "Too many wrong tries. Ask for a new code." };
    const a = Buffer.from(codeHash(row.id, code));
    const b = Buffer.from(row.codeHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      await tx.update(esignSigners).set({ codeAttempts: row.codeAttempts + 1 }).where(eq(esignSigners.id, row.id));
      return { ok: false as const, error: row.codeAttempts + 1 >= MAX_CODE_TRIES ? "Too many wrong tries. Ask for a new code." : bad };
    }
    const session = randomBytes(32).toString("base64url");
    await tx.update(esignSigners).set({ codeHash: null, codeExpiresAt: null, codeAttempts: 0, sessionHash: sha256(session), sessionExpiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000) }).where(eq(esignSigners.id, row.id));
    await writeAudit({ actor: null, action: "signing.external_verified", targetType: "esign_envelope", targetId: row.envelopeId, metadata: { ip } }, tx);
    return { ok: true as const, session };
  });
}

/** The document bytes for an outside signer with a valid session: the sealed copy once complete, the original before. */
export async function externalDocument(ctx: ExternalContext, ip: string | null): Promise<{ bytes: Uint8Array; sealed: boolean; fileName: string }> {
  const path = ctx.env.sealedPath ?? ctx.env.originalPath;
  const bytes = await getDocumentStorage().read(BUCKETS.signed, path);
  if (!bytes) throw new ActionFailure("The document could not be found.");
  if (ctx.signer.status === "pending" && !ctx.signer.viewedAt) {
    await db.transaction(async (tx) => {
      await tx.update(esignSigners).set({ viewedAt: new Date() }).where(and(eq(esignSigners.id, ctx.signer.id), eq(esignSigners.status, "pending")));
      await appendEvent(tx, ctx.env.id, { type: "viewed", signerId: ctx.signer.id, ip });
      // The recruiter who sent it can see when the applicant opened it
      await notify(tx, { userId: ctx.env.createdBy, kind: "signing.viewed", title: "An outside signer opened a document", body: "Open Signing to see where it stands.", link: `/signing/${ctx.env.id}` });
    });
  }
  const base = ctx.env.title.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 60) || "document";
  return { bytes, sealed: Boolean(ctx.env.sealedPath), fileName: `${base}${ctx.env.sealedPath ? " (signed)" : ""}.pdf` };
}

export type ExternalSignInput = { consent: boolean; kind: "typed" | "drawn"; typedText?: string; pngBase64?: string };

export async function externalSign(ctx: ExternalContext, input: ExternalSignInput, ip: string | null): Promise<void> {
  if (input.consent !== true) throw new ActionFailure("Tick the box to agree to sign electronically.");
  let png: Buffer | null = null;
  if (input.kind === "drawn") {
    png = Buffer.from(input.pngBase64 ?? "", "base64");
    const size = pngSize(png);
    if (!size || png.length > MAX_SIGNATURE_PNG_BYTES || size.width > MAX_SIGNATURE_PNG_SIZE.width || size.height > MAX_SIGNATURE_PNG_SIZE.height || size.width < 20 || size.height < 10) throw new ActionFailure("That drawing could not be used. Clear it and draw again.");
  } else if (!isTypedSignatureEncodable(input.typedText ?? "")) {
    throw new ActionFailure("Type your name using English-alphabet letters, or draw your signature instead.");
  }
  const outcome = await db.transaction(async (tx) => {
    const result = await recordSignature(tx, {
      envelopeId: ctx.env.id,
      signerId: ctx.signer.id,
      kind: input.kind,
      typedText: input.typedText ?? null,
      png,
      ip,
      methods: "email link and one-time code",
      signedName: ctx.signer.externalName as string,
      actorUserId: null,
    });
    await writeAudit({ actor: null, action: "signing.sign", targetType: "esign_envelope", targetId: ctx.env.id, after: { kind: input.kind, outside: true } }, tx);
    return result;
  });
  if (outcome.externalIds.length) await issueExternalLinks(outcome.externalIds, "turn");
  if (outcome.ready) await sealEnvelope(ctx.env.id).catch((error) => console.error("sealing failed:", error instanceof Error ? error.name : "unknown error"));
}

export async function externalDecline(ctx: ExternalContext, reason: string, ip: string | null): Promise<void> {
  const text = reason.trim();
  if (text.length < 3 || text.length > 500) throw new ActionFailure("Give a short reason.");
  const hr = await hrUserIds();
  await db.transaction(async (tx) => {
    const [env] = await tx.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, ctx.env.id)).for("update");
    const [row] = await tx.select().from(esignSigners).where(eq(esignSigners.id, ctx.signer.id)).for("update");
    if (!env || !row || env.status !== "out") throw new ActionFailure("This document is no longer waiting for signatures.");
    if (row.status !== "pending") throw new ActionFailure(row.status === "signed" ? "You already signed this." : "It is not your turn yet.");
    await tx.update(esignSigners).set({ status: "declined", declineReason: text, sessionHash: null, sessionExpiresAt: null }).where(eq(esignSigners.id, row.id));
    await endEnvelope(tx, ctx.env.id, "declined", "A signer declined", row.id);
    await appendEvent(tx, ctx.env.id, { type: "declined", signerId: row.id, ip, detail: { reason: text } });
    await notify(tx, [...new Set([env.createdBy, ...hr])].map((userId) => ({ userId, kind: "signing.declined", title: "A signer declined to sign", body: "Open Signing to see the reason.", link: `/signing/${ctx.env.id}` })));
    await writeAudit({ actor: null, action: "signing.decline", targetType: "esign_envelope", targetId: ctx.env.id, after: { reason: text, outside: true } }, tx);
  });
}
