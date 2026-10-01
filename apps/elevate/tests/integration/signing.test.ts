import { randomUUID } from "node:crypto";
import zlib from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage } from "./fake-storage";

// Real-database tests for ELEVATE Sign (Phase 3.2): the full create -> sign -> seal -> verify flow, signing order, who may see and
// sign what, decline/void/expire, reminders, the seal sweep, and the immutability of the evidence.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.50" }) }));
vi.mock("@/modules/signing/session", () => ({ currentSignInMethods: async () => "password, totp" }));

const { db } = await import("@/lib/db");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const actions = await import("@/modules/signing/actions");
const queries = await import("@/modules/signing/queries");
const service = await import("@/modules/signing/service");
const jobs = await import("@/modules/signing/jobs");
const { sha256Hex } = await import("@/modules/signing/chain");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const forbidden = (p: Promise<unknown>) => p.then(() => "resolved", (e: Error) => e.name);

const fake = new FakeStorage();

async function samplePdf(pages = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`Agreement ${i + 1}`, { x: 60, y: 700 });
  return doc.save();
}

/** A tiny valid PNG (a drawn signature stand-in). */
function png(width = 120, height = 40): string {
  const crcTable = (buf: Buffer) => zlib.crc32(buf);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crcTable(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 4, 0x20)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}

async function makeUser(label: string, roles: RoleSlug[], name?: [string, string]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  if (name) await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${name[0]}, ${name[1]}, ${email}, 'active', ${id})`);
  return { id, email, roles };
}

let hr: TestUser;
let ana: TestUser;
let ben: TestUser;
let cara: TestUser;
let outsider: TestUser;

const send = async (opts: { order?: "sequential" | "parallel"; signers?: TestUser[]; title?: string; expiryDays?: number; send?: boolean } = {}) => {
  const people = opts.signers ?? [ana, ben];
  const { id } = await service.createEnvelope(
    { id: hr.id, email: hr.email, roles: hr.roles },
    { title: opts.title ?? uniq("Agreement "), pdf: await samplePdf(), fileName: "agreement.pdf", signers: people.map((p, i) => ({ userId: p.id, role: i === 0 ? "Contractor" : "ERS representative" })), order: opts.order ?? "sequential", expiryDays: opts.expiryDays ?? 14, send: opts.send ?? true, ip: "203.0.113.9" },
  );
  return id;
};
const signerRow = async (envelopeId: string, user: TestUser) => (await rows<{ status: string; viewed_at: Date | null }>(sql`select status, viewed_at from docs.esign_signers where envelope_id = ${envelopeId} and user_id = ${user.id}`))[0];
const open = async (user: TestUser, envelopeId: string) => {
  as(user);
  const r = await actions.getDocumentLink({ envelopeId });
  if (!r.ok) throw new Error(r.error);
  return r.data;
};
const signTyped = async (user: TestUser, envelopeId: string, extra: Record<string, unknown> = {}) => {
  as(user);
  return actions.signEnvelope({ envelopeId, consent: true, kind: "typed", typedText: "Ana Reyes", ...extra });
};

beforeAll(async () => {
  setDocumentStorage(fake);
  hr = await makeUser("hr", ["hr_admin", "employee"], ["Hannah", "Ramos"]);
  ana = await makeUser("ana", ["employee"], ["Ana", "Reyes"]);
  ben = await makeUser("ben", ["employee"], ["Ben", "Cruz"]);
  cara = await makeUser("cara", ["employee"], ["Cara", "Lim"]);
  outsider = await makeUser("out", ["employee"], ["Omar", "Diaz"]);
});
afterAll(() => setDocumentStorage(null));

describe("sending", () => {
  it("stores the original, notifies and emails only the first signer of a sequential envelope, and starts the event chain", async () => {
    const id = await send();
    expect(await signerRow(id, ana)).toMatchObject({ status: "pending" });
    expect(await signerRow(id, ben)).toMatchObject({ status: "waiting" });
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${ana.id} and kind = 'signing.turn' and link = ${`/signing/${id}`}`)).length).toBe(1);
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${ben.id} and kind = 'signing.turn'`)).toHaveLength(0);
    const [mail] = await rows<{ body: string; subject: string }>(sql`select body, subject from ops.email_queue where dedupe_key like 'esign-turn:%' and user_id = ${ana.id}`);
    expect(mail.subject).toContain("waiting for your signature");
    expect(mail.body).not.toMatch(/Agreement|Contractor/); // no titles or names in email
    const [env] = await rows<{ original_path: string; original_sha256: string; status: string }>(sql`select original_path, original_sha256, status from docs.esign_envelopes where id = ${id}`);
    expect(env.status).toBe("out");
    expect(fake.objects.has(fake.key("signed-docs", env.original_path))).toBe(true);
    expect(sha256Hex(fake.objects.get(fake.key("signed-docs", env.original_path))!)).toBe(env.original_sha256);
    expect((await rows<{ type: string }>(sql`select type from docs.esign_events where envelope_id = ${id} order by seq`)).map((e) => e.type)).toEqual(["created", "sent"]);
  });

  it("wakes everyone at once in a parallel envelope", async () => {
    const id = await send({ order: "parallel", signers: [ana, ben, cara] });
    for (const u of [ana, ben, cara]) expect(await signerRow(id, u)).toMatchObject({ status: "pending" });
  });

  it("can be saved as a draft, then sent; and refuses bad files, duplicate or unknown signers", async () => {
    const draft = await send({ send: false });
    expect(await signerRow(draft, ana)).toMatchObject({ status: "waiting" });
    as(hr);
    expect((await actions.sendEnvelope({ envelopeId: draft })).ok).toBe(true);
    expect(await signerRow(draft, ana)).toMatchObject({ status: "pending" });
    expect((await actions.sendEnvelope({ envelopeId: draft })).ok).toBe(false); // already sent

    const base = { title: "x agreement", fileName: "a.pdf", order: "sequential" as const, expiryDays: 14, send: true, ip: null };
    const actor = { id: hr.id, email: hr.email, roles: hr.roles };
    await expect(service.createEnvelope(actor, { ...base, pdf: new TextEncoder().encode("MZ not a pdf at all"), signers: [{ userId: ana.id }] })).rejects.toThrow(/not a PDF/);
    await expect(service.createEnvelope(actor, { ...base, pdf: await samplePdf(), signers: [{ userId: ana.id }, { userId: ana.id }] })).rejects.toThrow(/only be added once/);
    await expect(service.createEnvelope(actor, { ...base, pdf: await samplePdf(), signers: [{ userId: randomUUID() }] })).rejects.toThrow(/active ELEVATE account/);
    await expect(service.createEnvelope(actor, { ...base, pdf: new TextEncoder().encode("%PDF-1.4\ngarbage that is not a real pdf"), signers: [{ userId: ana.id }] })).rejects.toThrow(/cannot be used/);
  });
});

describe("signing, sealing and verifying", () => {
  it("runs the whole flow: order enforced, read first, then sealed with a certificate whose fingerprint verifies", async () => {
    const id = await send();

    // Ben is waiting: not his turn
    as(ben);
    expect(await signTyped(ben, id)).toEqual({ ok: false, error: expect.stringContaining("not your turn") });
    // Ana has not opened the document yet
    expect(await signTyped(ana, id)).toEqual({ ok: false, error: expect.stringContaining("read it before") });
    // Consent is required (schema)
    await open(ana, id);
    expect((await signTyped(ana, id, { consent: false })).ok).toBe(false);

    expect((await signTyped(ana, id)).ok).toBe(true);
    expect(await signerRow(id, ana)).toMatchObject({ status: "signed" });
    expect(await signerRow(id, ben)).toMatchObject({ status: "pending" }); // woken
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${ben.id} and kind = 'signing.turn' and link = ${`/signing/${id}`}`)).length).toBe(1);
    expect((await signTyped(ana, id)).ok).toBe(false); // only once

    const [sigRow] = await rows<{ signed_name: string; ip: string; mfa_methods: string; consent_version: string; signature_kind: string }>(sql`select signed_name, ip, mfa_methods, consent_version, signature_kind from docs.esign_signers where envelope_id = ${id} and user_id = ${ana.id}`);
    expect(sigRow).toMatchObject({ signed_name: "Ana Reyes", ip: "203.0.113.50", mfa_methods: "password, totp", signature_kind: "typed" });
    expect(sigRow.consent_version).toBeTruthy();

    // Ben draws his signature
    await open(ben, id);
    as(ben);
    const final = await actions.signEnvelope({ envelopeId: id, consent: true, kind: "drawn", pngBase64: png() });
    expect(final.ok).toBe(true);

    const [env] = await rows<{ status: string; sealed_path: string; sealed_sha256: string; original_sha256: string }>(sql`select status, sealed_path, sealed_sha256, original_sha256 from docs.esign_envelopes where id = ${id}`);
    expect(env.status).toBe("completed");
    const sealed = fake.objects.get(fake.key("signed-docs", env.sealed_path))!;
    expect(sha256Hex(sealed)).toBe(env.sealed_sha256);
    expect(env.sealed_sha256).not.toBe(env.original_sha256);
    expect((await PDFDocument.load(sealed)).getPageCount()).toBe(2 + 2); // original + signature page + certificate

    // Public verification: the exact file matches, one changed byte does not
    expect(await queries.verifyFingerprint(env.sealed_sha256)).toMatchObject({ match: true, reference: expect.stringMatching(/^ES-[0-9A-F]{8}$/) });
    const tampered = sealed.slice();
    tampered[tampered.length - 30] ^= 0xff;
    expect(await queries.verifyFingerprint(sha256Hex(tampered))).toEqual({ match: false });
    expect(await queries.verifyFingerprint(env.original_sha256)).toEqual({ match: false }); // the unsigned original is not a sealed document

    // Everyone was told; the log is chained and intact for HR
    for (const u of [hr, ana, ben]) expect((await rows(sql`select 1 from ops.notifications where user_id = ${u.id} and kind = 'signing.completed' and link = ${`/signing/${id}`}`)).length).toBe(1);
    as(hr);
    const detail = await queries.getEnvelopeDetail(id);
    expect(detail.chainOk).toBe(true);
    expect(detail.events?.map((e) => e.type)).toEqual(["created", "sent", "viewed", "consented", "signed", "viewed", "consented", "signed", "sealed"]);

    // The signed copy link is for the sealed file
    const link = await open(ana, id);
    expect(link.sealed).toBe(true);
  });

  it("seals a parallel envelope when the last person signs, in either order", async () => {
    const id = await send({ order: "parallel", signers: [ana, ben] });
    await open(ben, id);
    await open(ana, id);
    expect((await signTyped(ben, id, { typedText: "Ben Cruz" })).ok).toBe(true);
    expect((await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${id}`))[0].status).toBe("out");
    expect((await signTyped(ana, id)).ok).toBe(true);
    expect((await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${id}`))[0].status).toBe("completed");
  });

  it("refuses a bad drawing and a typed name the PDF font cannot draw", async () => {
    const id = await send({ signers: [ana] });
    await open(ana, id);
    as(ana);
    expect((await actions.signEnvelope({ envelopeId: id, consent: true, kind: "drawn", pngBase64: Buffer.from("not a png").toString("base64") })).ok).toBe(false);
    expect((await actions.signEnvelope({ envelopeId: id, consent: true, kind: "drawn", pngBase64: png(2000, 100) })).ok).toBe(false); // too wide
    expect((await actions.signEnvelope({ envelopeId: id, consent: true, kind: "typed", typedText: "山田太郎" })).ok).toBe(false);
    expect((await signTyped(ana, id)).ok).toBe(true);
  });

  it("keeps the signature when sealing fails, and the sweep seals it later", async () => {
    const id = await send({ signers: [ana] });
    await open(ana, id);
    const original = fake.write.bind(fake);
    let fail = true;
    fake.write = async (bucket, path, bytes, type) => {
      if (fail && path.startsWith("sealed/")) throw new Error("storage down");
      return original(bucket, path, bytes, type);
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await signTyped(ana, id)).ok).toBe(true); // the signature stands
    fail = false;
    fake.write = original;
    const [stuck] = await rows<{ status: string; all_signed_at: Date | null }>(sql`select status, all_signed_at from docs.esign_envelopes where id = ${id}`);
    expect(stuck.status).toBe("out");
    expect(stuck.all_signed_at).not.toBeNull();
    const result = await jobs.runEsignSealSweep();
    expect(result.sealed).toBeGreaterThanOrEqual(1);
    expect((await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${id}`))[0].status).toBe("completed");
    expect(await jobs.runEsignSealSweep()).toMatchObject({ sealed: 0 }); // nothing left, and sealing twice is harmless
  });

  it("refuses to seal when the stored original no longer matches its fingerprint", async () => {
    const id = await send({ signers: [ana] });
    await open(ana, id);
    const [env] = await rows<{ original_path: string }>(sql`select original_path from docs.esign_envelopes where id = ${id}`);
    fake.objects.set(fake.key("signed-docs", env.original_path), await samplePdf(5)); // someone swapped the file in storage
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await signTyped(ana, id)).ok).toBe(true);
    expect((await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${id}`))[0].status).toBe("out"); // not sealed
    await expect(service.sealEnvelope(id)).rejects.toThrow(/no longer matches/);
  });
});

describe("decline, void and expiry", () => {
  it("a decline stops the envelope for everyone, cancels the rest and tells HR", async () => {
    const id = await send({ signers: [ana, ben] });
    as(ana);
    expect((await actions.declineEnvelope({ envelopeId: id, reason: "I disagree with clause 4" })).ok).toBe(true);
    const [env] = await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${id}`);
    expect(env.status).toBe("declined");
    expect(await signerRow(id, ana)).toMatchObject({ status: "declined" });
    expect(await signerRow(id, ben)).toMatchObject({ status: "cancelled" });
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${hr.id} and kind = 'signing.declined'`)).length).toBeGreaterThan(0);
    expect((await signTyped(ben, id)).ok).toBe(false);
    expect((await actions.declineEnvelope({ envelopeId: id, reason: "again" })).ok).toBe(false);
  });

  it("HR can void a waiting document; nobody can then sign; a completed one cannot be voided", async () => {
    const id = await send();
    as(hr);
    expect((await actions.voidEnvelope({ envelopeId: id, reason: "Wrong version" })).ok).toBe(true);
    expect((await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${id}`))[0].status).toBe("voided");
    expect((await signTyped(ana, id)).ok).toBe(false);
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${ana.id} and kind = 'signing.voided'`)).length).toBeGreaterThan(0);
    as(hr);
    expect((await actions.voidEnvelope({ envelopeId: id, reason: "twice" })).ok).toBe(false);

    const done = await send({ signers: [ana] });
    await open(ana, done);
    await signTyped(ana, done);
    as(hr);
    expect((await actions.voidEnvelope({ envelopeId: done, reason: "too late" })).ok).toBe(false);
  });

  it("expires overdue documents and refuses a signature after expiry", async () => {
    const id = await send({ signers: [ana] });
    await open(ana, id);
    await db.execute(sql`update docs.esign_envelopes set expires_at = now() - interval '1 hour' where id = ${id}`);
    expect(await signTyped(ana, id)).toEqual({ ok: false, error: expect.stringContaining("expired") });
    const run = await jobs.runEsignReminders();
    expect(run.expired).toBeGreaterThanOrEqual(1);
    expect((await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${id}`))[0].status).toBe("expired");
    expect(await signerRow(id, ana)).toMatchObject({ status: "cancelled" });
  });

  it("reminds a person every three days, and not before", async () => {
    const id = await send({ signers: [ana] });
    await db.execute(sql`update docs.esign_signers set last_notice_at = now() - interval '1 day' where envelope_id = ${id}`);
    const before = (await rows(sql`select 1 from docs.esign_events where envelope_id = ${id} and type = 'reminded'`)).length;
    await jobs.runEsignReminders();
    expect((await rows(sql`select 1 from docs.esign_events where envelope_id = ${id} and type = 'reminded'`)).length).toBe(before);
    await db.execute(sql`update docs.esign_signers set last_notice_at = now() - interval '4 days' where envelope_id = ${id}`);
    await jobs.runEsignReminders();
    expect((await rows(sql`select 1 from docs.esign_events where envelope_id = ${id} and type = 'reminded'`)).length).toBe(before + 1);
    as(hr);
    expect((await actions.remindSigners({ envelopeId: id })).ok).toBe(true);
  });
});

describe("who can see and do what", () => {
  it("lets a signer see their envelope but not the log; keeps everyone else out", async () => {
    const id = await send({ signers: [ana] });
    as(ana);
    const mine = await queries.getEnvelopeDetail(id);
    expect(mine.viewer).toBe("signer");
    expect(mine.events).toBeNull();
    expect(mine.envelope.originalSha256).toBeNull();
    expect(mine.signers[0].email).toBeNull();
    expect(mine.canSign).toBe(true);
    expect((await queries.listMySigning()).some((r) => r.envelopeId === id)).toBe(true);

    as(outsider);
    expect(await forbidden(queries.getEnvelopeDetail(id))).toBe("ForbiddenError");
    expect((await queries.listMySigning()).some((r) => r.envelopeId === id)).toBe(false);
    expect(await signTyped(outsider, id)).toEqual({ ok: false, error: NO_ACCESS });
    expect(await actions.declineEnvelope({ envelopeId: id, reason: "not mine" })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await actions.getDocumentLink({ envelopeId: id })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await forbidden(queries.listEnvelopes())).toBe("ForbiddenError");

    as(hr);
    const all = await queries.listEnvelopes();
    expect(all.some((e) => e.id === id)).toBe(true);
    expect((await queries.getEnvelopeDetail(id)).viewer).toBe("manager");
  });

  it("keeps HR actions to HR, and a draft out of sight of signers", async () => {
    const draft = await send({ send: false });
    as(ana);
    expect(await forbidden(queries.getEnvelopeDetail(draft))).toBe("ForbiddenError");
    expect(await actions.sendEnvelope({ envelopeId: draft })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await actions.voidEnvelope({ envelopeId: draft, reason: "nope nope" })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await actions.remindSigners({ envelopeId: draft })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await actions.archiveTemplate({ templateId: randomUUID() })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await forbidden(queries.listSignerChoices())).toBe("ForbiddenError");
    expect(await forbidden(queries.listTemplates())).toBe("ForbiddenError");
  });

  it("records each document open and audits it, with a 60-second link", async () => {
    const id = await send({ signers: [ana] });
    const link = await open(ana, id);
    expect(link.url).toContain("expires=60");
    expect((await rows(sql`select 1 from docs.esign_events where envelope_id = ${id} and type = 'viewed'`)).length).toBe(1);
    await open(ana, id);
    expect((await rows(sql`select 1 from docs.esign_events where envelope_id = ${id} and type = 'viewed'`)).length).toBe(1); // recorded once
    expect((await rows(sql`select 1 from ops.audit_log where action = 'signing.document_view' and target_id = ${id}`)).length).toBe(2);
  });
});

describe("the evidence cannot be changed", () => {
  it("refuses edits and deletes of events, and edits of a signed signer", async () => {
    const id = await send({ signers: [ana] });
    await open(ana, id);
    await signTyped(ana, id);
    await expect(db.execute(sql`update docs.esign_events set type = 'created' where envelope_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from docs.esign_events where envelope_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`update docs.esign_signers set signed_name = 'Someone Else' where envelope_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from docs.esign_signers where envelope_id = ${id}`)).rejects.toThrow();
  });

  it("refuses to change a sent envelope's original, a sealed copy, or a finished status; and to delete a sent envelope", async () => {
    const id = await send({ signers: [ana] });
    await expect(db.execute(sql`update docs.esign_envelopes set original_sha256 = 'x' where id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from docs.esign_envelopes where id = ${id}`)).rejects.toThrow();
    await open(ana, id);
    await signTyped(ana, id);
    await expect(db.execute(sql`update docs.esign_envelopes set sealed_sha256 = ${"f".repeat(64)} where id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`update docs.esign_envelopes set status = 'out' where id = ${id}`)).rejects.toThrow();
  });

  it("detects a rewritten event even if the append-only rule were bypassed", async () => {
    const id = await send({ signers: [ana] });
    await db.execute(sql`alter table docs.esign_events disable trigger esign_events_append_only`);
    try {
      await db.execute(sql`update docs.esign_events set ip = '198.51.100.99' where envelope_id = ${id} and seq = 1`);
    } finally {
      await db.execute(sql`alter table docs.esign_events enable trigger esign_events_append_only`);
    }
    as(hr);
    expect((await queries.getEnvelopeDetail(id)).chainOk).toBe(false);
  });

  it("discarding a draft keeps its record (voided), since the log is append-only", async () => {
    const id = await send({ send: false });
    as(hr);
    expect((await actions.discardDraft({ envelopeId: id })).ok).toBe(true);
    expect((await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${id}`))[0].status).toBe("voided");
    expect((await actions.discardDraft({ envelopeId: id })).ok).toBe(false);
  });
});
