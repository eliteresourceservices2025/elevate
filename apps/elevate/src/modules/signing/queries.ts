import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { authorize, ForbiddenError, scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/modules/core/schema";
import { verifyChain, type StoredEvent } from "./chain";
import { envelopeReference, type EnvelopeStatus, type SignerStatus } from "./constants";
import { esignEnvelopes, esignEvents, esignSigners, esignTemplates } from "./schema";
import { legalNames } from "./service";

export type MySigningRow = { envelopeId: string; title: string; reference: string; envelopeStatus: EnvelopeStatus; myStatus: SignerStatus; sentAt: Date | null; expiresAt: Date | null; signedAt: Date | null };

/** The envelopes the signed-in person was asked to sign, waiting ones first. */
export async function listMySigning(): Promise<MySigningRow[]> {
  const user = await requireUser();
  await authorize(user, "signing.view_own", { ownerUserId: user.id });
  const rows = await db
    .select({ envelopeId: esignEnvelopes.id, title: esignEnvelopes.title, envelopeStatus: esignEnvelopes.status, myStatus: esignSigners.status, sentAt: esignEnvelopes.sentAt, expiresAt: esignEnvelopes.expiresAt, signedAt: esignSigners.signedAt, createdAt: esignEnvelopes.createdAt })
    .from(esignSigners)
    .innerJoin(esignEnvelopes, eq(esignEnvelopes.id, esignSigners.envelopeId))
    .where(and(eq(esignSigners.userId, user.id), sql`${esignEnvelopes.status} <> 'draft'`))
    .orderBy(desc(esignEnvelopes.createdAt));
  const rank = (r: { myStatus: string }) => (r.myStatus === "pending" ? 0 : r.myStatus === "waiting" ? 1 : 2);
  return rows
    .map((r) => ({ envelopeId: r.envelopeId, title: r.title, reference: envelopeReference(r.envelopeId), envelopeStatus: r.envelopeStatus as EnvelopeStatus, myStatus: r.myStatus as SignerStatus, sentAt: r.sentAt, expiresAt: r.expiresAt, signedAt: r.signedAt }))
    .sort((a, b) => rank(a) - rank(b));
}

export type EnvelopeRow = { id: string; title: string; reference: string; status: EnvelopeStatus; createdAt: Date; expiresAt: Date | null; signed: number; total: number };

/** Every envelope (HR and Super Admin). */
export async function listEnvelopes(): Promise<EnvelopeRow[]> {
  const user = await requireUser();
  await authorize(user, "signing.manage");
  const envelopes = await db.select().from(esignEnvelopes).orderBy(desc(esignEnvelopes.createdAt)).limit(1000);
  if (envelopes.length === 0) return [];
  const counts = await db
    .select({ envelopeId: esignSigners.envelopeId, total: sql<number>`count(*)::int`, signed: sql<number>`count(*) filter (where ${esignSigners.status} = 'signed')::int` })
    .from(esignSigners)
    .where(inArray(esignSigners.envelopeId, envelopes.map((e) => e.id)))
    .groupBy(esignSigners.envelopeId);
  const by = new Map(counts.map((c) => [c.envelopeId, c]));
  return envelopes.map((e) => ({ id: e.id, title: e.title, reference: envelopeReference(e.id), status: e.status as EnvelopeStatus, createdAt: e.createdAt, expiresAt: e.expiresAt, signed: by.get(e.id)?.signed ?? 0, total: by.get(e.id)?.total ?? 0 }));
}

export type SignerView = { id: string; userId: string; name: string; email: string | null; role: string | null; position: number; status: SignerStatus; signedAt: Date | null; viewedAt: Date | null; isMe: boolean };
export type EventView = { seq: number; type: string; at: Date; actor: string | null; ip: string | null };

/**
 * One envelope. HR and Super Admin see everything (including the event log and whether its hash chain is intact). A signer sees
 * the document's status and who has signed, but not the log, emails or IP addresses.
 */
export async function getEnvelopeDetail(envelopeId: string) {
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(envelopeId)) throw new ForbiddenError("signing.view_own");
  const [env] = await db.select().from(esignEnvelopes).where(eq(esignEnvelopes.id, envelopeId));
  if (!env) throw new ForbiddenError("signing.view_own"); // shown as "not found", same as no access
  const manager = scopeFor(user, "signing.manage") !== null;
  const signers = await db.select().from(esignSigners).where(eq(esignSigners.envelopeId, envelopeId)).orderBy(asc(esignSigners.position), asc(esignSigners.id));
  const mine = signers.find((s) => s.userId === user.id) ?? null;
  if (manager) await authorize(user, "signing.manage");
  else {
    await authorize(user, "signing.view_own", { ownerUserId: mine?.userId });
    if (env.status === "draft") throw new ForbiddenError("signing.view_own");
  }

  const names = await legalNames(db, [env.createdBy, ...signers.map((s) => s.userId)]);
  const emails = manager ? new Map((await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, [env.createdBy, ...signers.map((s) => s.userId)]))).map((u) => [u.id, u.email])) : new Map<string, string>();

  let events: EventView[] | null = null;
  let chainOk: boolean | null = null;
  if (manager) {
    const rows = await db.select().from(esignEvents).where(eq(esignEvents.envelopeId, envelopeId)).orderBy(asc(esignEvents.seq));
    events = rows.map((e) => ({ seq: e.seq, type: e.type, at: e.at, actor: e.actorUserId ? (emails.get(e.actorUserId) ?? names.get(e.actorUserId) ?? null) : null, ip: e.ip }));
    const stored: StoredEvent[] = rows.map((e) => ({ envelopeId: e.envelopeId, seq: e.seq, type: e.type, actorUserId: e.actorUserId, signerId: e.signerId, at: e.at.toISOString(), ip: e.ip, detail: e.detail, prevHash: e.prevHash, hash: e.hash }));
    chainOk = verifyChain(stored).ok;
  }

  const expired = env.expiresAt !== null && env.expiresAt.getTime() < Date.now();
  return {
    viewer: manager ? ("manager" as const) : ("signer" as const),
    envelope: {
      id: env.id,
      title: env.title,
      reference: envelopeReference(env.id),
      status: env.status as EnvelopeStatus,
      order: env.signingOrder,
      pages: env.pageCount,
      createdBy: names.get(env.createdBy) ?? "ERS",
      createdAt: env.createdAt,
      sentAt: env.sentAt,
      expiresAt: env.expiresAt,
      sealedAt: env.sealedAt,
      sealedSha256: env.sealedSha256,
      originalSha256: manager ? env.originalSha256 : null,
      endReason: env.endReason,
      sealing: env.status === "out" && env.allSignedAt !== null,
    },
    signers: signers.map<SignerView>((s) => ({ id: s.id, userId: s.userId, name: s.signedName ?? names.get(s.userId) ?? "Unknown", email: emails.get(s.userId) ?? null, role: s.role, position: s.position, status: s.status as SignerStatus, signedAt: s.signedAt, viewedAt: s.viewedAt, isMe: s.userId === user.id })),
    mine: mine ? { status: mine.status as SignerStatus, viewed: mine.viewedAt !== null } : null,
    canSign: Boolean(mine && mine.status === "pending" && env.status === "out" && !expired),
    events,
    chainOk,
  };
}

export type TemplateRow = { id: string; name: string; description: string | null; roles: string[]; pages: number; fileName: string };

export async function listTemplates(): Promise<TemplateRow[]> {
  const user = await requireUser();
  await authorize(user, "signing.manage");
  const rows = await db.select().from(esignTemplates).where(isNull(esignTemplates.archivedAt)).orderBy(asc(esignTemplates.name));
  return rows.map((t) => ({ id: t.id, name: t.name, description: t.description, roles: t.roles, pages: t.pageCount, fileName: t.fileName }));
}

export type SignerChoice = { userId: string; name: string; email: string };

/** Everyone with an active ELEVATE account, for choosing signers (signers must be signed in with MFA, so they need an account). */
export async function listSignerChoices(): Promise<SignerChoice[]> {
  const user = await requireUser();
  await authorize(user, "signing.manage");
  const all = await db.select({ id: users.id, email: users.email }).from(users).where(isNull(users.archivedAt));
  const names = await legalNames(db, all.map((u) => u.id));
  return all.map((u) => ({ userId: u.id, name: names.get(u.id) ?? u.email, email: u.email })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Public: does a fingerprint belong to a sealed ELEVATE document? Says nothing else about it beyond when it was sealed and its reference. */
export async function verifyFingerprint(sha256: string): Promise<{ match: false } | { match: true; reference: string; sealedAt: Date }> {
  const [row] = await db.select({ id: esignEnvelopes.id, sealedAt: esignEnvelopes.sealedAt }).from(esignEnvelopes).where(and(eq(esignEnvelopes.sealedSha256, sha256), eq(esignEnvelopes.status, "completed")));
  return row?.sealedAt ? { match: true, reference: envelopeReference(row.id), sealedAt: row.sealedAt } : { match: false };
}
