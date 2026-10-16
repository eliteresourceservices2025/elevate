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

  it("shows the document in the page: HR and the signer may; an outsider and a draft are refused; the first open is recorded once", async () => {
    const { openSigningDocument } = await import("@/modules/signing/document");
    const actorOf = (u: TestUser) => ({ id: u.id, email: u.email, roles: u.roles });
    const id = await send({ signers: [ana] });
    const draft = await send({ signers: [ana], send: false });

    const hrView = await openSigningDocument(actorOf(hr), id);
    expect(hrView.sealed).toBe(false);
    expect(fake.objects.has(fake.key("signed-docs", hrView.path))).toBe(true);
    expect((await rows(sql`select 1 from docs.esign_events where envelope_id = ${id} and type = 'viewed'`)).length).toBe(0); // HR looking is not a signer opening

    await openSigningDocument(actorOf(ana), id);
    await openSigningDocument(actorOf(ana), id);
    expect((await rows(sql`select 1 from docs.esign_events where envelope_id = ${id} and type = 'viewed'`)).length).toBe(1);
    expect((await signerRow(id, ana)).viewed_at).not.toBeNull();

    await expect(openSigningDocument(actorOf(outsider), id)).rejects.toThrow("Forbidden");
    await expect(openSigningDocument(actorOf(ana), draft)).rejects.toThrow(/not found/);
    await expect(openSigningDocument(actorOf(hr), randomUUID())).rejects.toThrow(/not found/);
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

describe("initials on each page", () => {
  const sendWithInitials = async (signers: TestUser[] = [ana]) => {
    const { id } = await service.createEnvelope(
      { id: hr.id, email: hr.email, roles: hr.roles },
      { title: uniq("Handbook "), pdf: await samplePdf(3), fileName: "handbook.pdf", signers: signers.map((p) => ({ userId: p.id, role: "Contractor" })), order: "sequential", expiryDays: 14, send: true, ip: "203.0.113.9", initialEachPage: true },
    );
    return id;
  };

  it("refuses to sign until every page is initialed, then stamps the sealed copy and records the initials", async () => {
    const id = await sendWithInitials();
    await open(ana, id);
    expect(await signTyped(ana, id)).toEqual({ ok: false, error: expect.stringContaining("Initial every page") });
    expect(await signTyped(ana, id, { initials: "AR", initialedPages: [1, 2] })).toEqual({ ok: false, error: expect.stringContaining("all 3 pages") });
    expect(await signTyped(ana, id, { initials: "A1", initialedPages: [1, 2, 3] })).toEqual({ ok: false, error: expect.stringContaining("Initials are") });
    expect(await signerRow(id, ana)).toMatchObject({ status: "pending" });

    expect((await signTyped(ana, id, { initials: "ar", initialedPages: [3, 1, 2] })).ok).toBe(true);
    const [row] = await rows<{ initials_text: string; initialed_pages: number }>(sql`select initials_text, initialed_pages from docs.esign_signers where envelope_id = ${id} and user_id = ${ana.id}`);
    expect(row).toEqual({ initials_text: "AR", initialed_pages: 3 });
    const [env] = await rows<{ status: string; sealed_path: string }>(sql`select status, sealed_path from docs.esign_envelopes where id = ${id}`);
    expect(env.status).toBe("completed");
    expect((await PDFDocument.load(fake.objects.get(fake.key("signed-docs", env.sealed_path))!)).getPageCount()).toBe(3 + 2);
  });

  it("does not ask for initials on a normal document, and refuses initials with an outside signer", async () => {
    const id = await send({ signers: [ana] });
    await open(ana, id);
    expect((await signTyped(ana, id)).ok).toBe(true);
    await expect(
      service.createEnvelope({ id: hr.id, email: hr.email, roles: hr.roles }, { title: uniq("X "), pdf: await samplePdf(2), fileName: "x.pdf", signers: [{ external: { name: "Out Sider", email: `${uniq("o")}@example.com` } }], order: "sequential", expiryDays: 14, send: false, ip: null, initialEachPage: true }),
    ).rejects.toThrow(/ELEVATE account/);
  });
});

describe("the email when a document is sent", () => {
  it("goes out straight away to the person whose turn it is, and to the next signer after a signature", async () => {
    const { setEmailSender } = await import("@/modules/notifications/email");
    // Earlier tests in this file left mail waiting in the queue; start clean so only this document's mail is counted.
    await db.execute(sql`delete from ops.email_queue`);
    const sent: { to: string; subject: string }[] = [];
    setEmailSender({ send: async (m: { to: string; subject: string }) => void sent.push({ to: m.to, subject: m.subject }) } as never);
    try {
      const id = await send();
      expect(sent.filter((m) => m.to === ana.email).map((m) => m.subject)).toEqual(["A document is waiting for your signature"]);
      expect(sent.some((m) => m.to === ben.email)).toBe(false); // not his turn yet

      await open(ana, id);
      expect((await signTyped(ana, id)).ok).toBe(true);
      expect(sent.filter((m) => m.to === ben.email).map((m) => m.subject)).toEqual(["A document is waiting for your signature"]);
    } finally {
      setEmailSender(null);
    }
  });
});

describe("adding signees by group", () => {
  it("finds everyone, a team, or a client's current assignees, and only people with accounts who have not left", async () => {
    const [d] = await rows<{ id: string }>(sql`insert into core.departments (name) values (${uniq("Dept ")}) returning id`);
    const [team] = await rows<{ id: string }>(sql`insert into core.teams (department_id, name) values (${d.id}, ${uniq("Team ")}) returning id`);
    const [client] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Client ")}) returning id`);
    const inTeam = await makeUser("grp-a", ["employee"], ["Gina", "Alba"]);
    const onClient = await makeUser("grp-b", ["employee"], ["Hugo", "Bautista"]);
    const left = await makeUser("grp-c", ["employee"], ["Iris", "Cruz"]);
    await db.execute(sql`update core.employees set team_id = ${team.id} where user_id in (${inTeam.id}, ${left.id})`);
    await db.execute(sql`update core.employees set status = 'separated' where user_id = ${left.id}`);
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) select id, ${client.id}, '2026-01-05' from core.employees where user_id = ${onClient.id}`);
    // an ended assignment does not count
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date, end_date) select id, ${client.id}, '2025-01-05', '2025-06-30' from core.employees where user_id = ${inTeam.id}`);

    as(hr);
    const ids = async (kind: "everyone" | "team" | "client", id?: string) => {
      const r = await actions.findSignees({ kind, id });
      if (!r.ok) throw new Error(r.error);
      return (r.data as { people: { userId: string }[] }).people.map((p) => p.userId);
    };
    expect(await ids("team", team.id)).toEqual([inTeam.id]); // the one who left is not offered
    expect(await ids("client", client.id)).toEqual([onClient.id]);
    const all = await ids("everyone");
    expect(all).toEqual(expect.arrayContaining([inTeam.id, onClient.id]));
    expect(all).not.toContain(left.id);
    expect((await actions.findSignees({ kind: "team" })).ok).toBe(false); // a team needs an id

    // Not for people who are not HR
    as(ana);
    expect(await actions.findSignees({ kind: "everyone" })).toEqual({ ok: false, error: NO_ACCESS });
    const groups = await (async () => {
      as(hr);
      return queries.listSigneeGroups();
    })();
    expect(groups.teams.find((t) => t.id === team.id)?.count).toBe(1);
    expect(groups.clients.find((c) => c.id === client.id)?.count).toBe(1);
  });
});

describe("details filled in from people's records", () => {
  it("reads name, address, role, start date and manager, and names who is missing what", async () => {
    const { loadSigneeValues, assertSigneeValues, renderForSignee } = await import("@/modules/signing/compose");
    const boss = await makeUser("mf-boss", ["employee"], ["Bea", "Santos"]);
    const full = await makeUser("mf-full", ["employee"], ["Carl", "Dizon"]);
    const bare = await makeUser("mf-bare", ["employee"], ["Dina", "Evangelista"]);
    await db.execute(sql`update core.employees set address_line = '12 Mabini St', city = 'Quezon City', province = 'Metro Manila', postal_code = '1100', position = 'Virtual Assistant', start_date = '2026-11-02',
      manager_id = (select id from core.employees where user_id = ${boss.id}) where user_id = ${full.id}`);

    const people = await loadSigneeValues([full.id, bare.id]);
    expect(people.get(full.id)?.values).toEqual({
      contractor_name: "Carl Dizon",
      contractor_address: "12 Mabini St, Quezon City, Metro Manila 1100, Philippines",
      role_title: "Virtual Assistant",
      start_date: expect.stringMatching(/2026/),
      reporting_line: "Bea Santos",
    });
    const text = "Agreement with {{contractor_name}} of {{contractor_address}}.";
    expect(() => assertSigneeValues(text, people, [full.id])).not.toThrow();
    expect(() => assertSigneeValues(text, people, [full.id, bare.id])).toThrow(/Dina Evangelista: Address/);
    const pdf = await renderForSignee("Test", `${text} This text is long enough to be a document.`, people.get(full.id) as { values: Record<string, string> });
    expect(pdf.length).toBeGreaterThan(500);
  });
});

describe("details typed in while signing", () => {
  it("collects the contractor's details, keeps them encrypted, leaves the countersigner alone, and seals", async () => {
    const { id } = await service.createEnvelope(
      { id: hr.id, email: hr.email, roles: hr.roles },
      { title: uniq("Agreement "), pdf: await samplePdf(2), fileName: "a.pdf", signers: [{ userId: ana.id, role: "Contractor", position: 1, fillsDetails: true }, { userId: ben.id, role: "ERS representative", position: 2 }], order: "sequential", expiryDays: 14, send: true, ip: null, signeeDetails: ["bank_name", "account_number", "account_name", "phone_number"] },
    );
    await open(ana, id);
    expect(await signTyped(ana, id)).toEqual({ ok: false, error: expect.stringContaining("Bank name is needed") });
    expect(await signTyped(ana, id, { details: { bank_name: "BDO", account_number: "abc", account_name: "Ana Reyes", phone_number: "+63 917 123 4567" } })).toEqual({ ok: false, error: expect.stringContaining("Account number") });
    const details = { bank_name: "BDO", account_number: "0012 3456 7890", account_name: "Ana Reyes", phone_number: "+63 917 123 4567" };
    expect((await signTyped(ana, id, { details })).ok).toBe(true);
    const [row] = await rows<{ details_enc: string; fills_details: boolean }>(sql`select details_enc, fills_details from docs.esign_signers where envelope_id = ${id} and user_id = ${ana.id}`);
    expect(row.fills_details).toBe(true);
    expect(row.details_enc).toBeTruthy();
    expect(row.details_enc).not.toContain("0012");
    // The log records which details were collected, never their values
    const events = await rows<{ detail: Record<string, unknown> }>(sql`select detail from docs.esign_events where envelope_id = ${id} and type = 'signed'`);
    expect(JSON.stringify(events)).not.toContain("0012");
    expect(JSON.stringify(events)).toContain("bank_name");

    // The countersigner does not type any details
    await open(ben, id);
    expect((await signTyped(ben, id)).ok).toBe(true);
    const [env] = await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${id}`);
    expect(env.status).toBe("completed");
  });
});

describe("the send route", () => {
  const post = async (fields: Record<string, string>, query = "") => {
    const { POST } = await import("@/app/api/signing/envelopes/route");
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    const res = await POST(new Request(`http://localhost/api/signing/envelopes${query}`, { method: "POST", body: form }));
    return { status: res.status, body: (await res.json()) as { ok: boolean; error?: string; id?: string; count?: number } };
  };
  const text = "This is a long enough document for the people who are going to sign it in ELEVATE.";
  const signersJson = (users: TestUser[]) => JSON.stringify(users.map((u, i) => ({ userId: u.id, role: "Contractor", position: i + 1 })));
  const countFor = async (title: string) => (await rows<{ n: number }>(sql`select count(*)::int as n from docs.esign_envelopes where title = ${title}`))[0].n;

  it("adds the countersigner after each person, even when the form says 'parallel'", async () => {
    as(hr);
    const title = uniq("Counter ");
    const r = await post({ title, content: text, individual: "true", order: "parallel", signers: signersJson([ana, ben]), countersigner: JSON.stringify({ userId: cara.id, role: "ERS representative" }) });
    expect(r.body).toMatchObject({ ok: true, count: 2 });
    const signers = await rows<{ position: number; role: string; user_id: string }>(sql`
      select s.position, s.role, s.user_id from docs.esign_signers s join docs.esign_envelopes e on e.id = s.envelope_id where e.title = ${title} order by e.id, s.position`);
    expect(signers).toHaveLength(4);
    for (const s of signers.filter((x) => x.user_id === cara.id)) expect(s).toMatchObject({ position: 2, role: "ERS representative" });
    expect(signers.filter((x) => x.user_id !== cara.id).every((x) => x.position === 1)).toBe(true);
    // Only the person's turn is open at first
    expect((await signerRow((await rows<{ id: string }>(sql`select id from docs.esign_envelopes where title = ${title} limit 1`))[0].id, cara))?.status).toBe("waiting");
  });

  it("refuses a countersigner who is also a signee before creating anything", async () => {
    as(hr);
    const title = uniq("Clash ");
    const r = await post({ title, content: text, individual: "true", signers: signersJson([ana, ben]), countersigner: JSON.stringify({ userId: ben.id }) });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/countersigner cannot also/);
    expect(await countFor(title)).toBe(0);
    // also in a check-only request
    const c = await post({ title, content: text, individual: "true", signers: signersJson([ben]), countersigner: JSON.stringify({ userId: ben.id }) }, "?check=1");
    expect(c.status).toBe(400);
  });

  it("refuses text with [[parts]] still to fill in, and a countersigner on a shared document", async () => {
    as(hr);
    const t1 = uniq("Blank ");
    const blank = await post({ title: t1, content: `${text} Address: [[Company business address]]`, signers: signersJson([ana]) });
    expect(blank.status).toBe(400);
    expect(blank.body.error).toMatch(/Company business address/);
    const t2 = uniq("Shared ");
    const shared = await post({ title: t2, content: text, signers: signersJson([ana, ben]), countersigner: JSON.stringify({ userId: cara.id }) });
    expect(shared.status).toBe(400);
    expect(await countFor(t1)).toBe(0);
    expect(await countFor(t2)).toBe(0);
  });

  it("checks everyone first and sends nothing when someone's details are missing", async () => {
    as(hr);
    const title = uniq("Fields ");
    const body = `${text} Name: {{contractor_name}} Address: {{contractor_address}}`;
    await db.execute(sql`update core.employees set address_line = null where user_id = ${ana.id}`);
    const checked = await post({ title, content: body, individual: "true", signers: signersJson([ana]) }, "?check=1");
    expect(checked.status).toBe(400);
    expect(checked.body.error).toMatch(/Ana Reyes: Address/);
    expect(await countFor(title)).toBe(0);
    // a document with fields needs per-person copies when there is more than one signee
    const shared = await post({ title, content: body, signers: signersJson([ana, ben]) });
    expect(shared.status).toBe(400);
    expect(shared.body.error).toMatch(/own copy/);
    expect(await countFor(title)).toBe(0);
  });
});

describe("who can open a signed copy that holds personal details", () => {
  const sealedWithDetails = async () => {
    const { id } = await service.createEnvelope(
      { id: hr.id, email: hr.email, roles: hr.roles },
      { title: uniq("Agreement "), pdf: await samplePdf(2), fileName: "a.pdf", signers: [{ userId: ana.id, role: "Contractor", position: 1, fillsDetails: true }, { userId: ben.id, role: "ERS representative", position: 2 }], order: "sequential", expiryDays: 14, send: true, ip: null, signeeDetails: ["bank_name", "account_number", "account_name", "phone_number"] },
    );
    await open(ana, id);
    await signTyped(ana, id, { details: { bank_name: "BDO", account_number: "0012 3456 7890", account_name: "Ana Reyes", phone_number: "+63 917 123 4567" } });
    await open(ben, id);
    await signTyped(ben, id);
    return id;
  };

  it("lets the contractor, HR and Super Admin open it, and keeps the countersigner and others out", async () => {
    const id = await sealedWithDetails();
    expect((await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${id}`))[0].status).toBe("completed");
    as(ana);
    expect((await actions.getDocumentLink({ envelopeId: id })).ok).toBe(true);
    as(hr);
    expect((await actions.getDocumentLink({ envelopeId: id })).ok).toBe(true);
    as(ben);
    expect(await actions.getDocumentLink({ envelopeId: id })).toEqual({ ok: false, error: expect.stringContaining("only the contractor and HR") });
    // The page says so instead of offering the copy
    const detail = await queries.getEnvelopeDetail(id);
    expect(detail.envelope.canOpenSealed).toBe(false);
    as(ana);
    expect((await queries.getEnvelopeDetail(id)).envelope.canOpenSealed).toBe(true);
    as(hr);
    expect((await queries.getEnvelopeDetail(id)).envelope.canOpenSealed).toBe(true);
  });

  it("audits the seal's read of the details (field names only) and everyone is still told it is done", async () => {
    const id = await sealedWithDetails();
    const [a] = await rows<{ metadata: { fields: string[] } }>(sql`select metadata from ops.audit_log where action = 'sensitive.view' and target_id = ${id}`);
    expect(a.metadata.fields).toContain("account_number");
    expect(JSON.stringify(a)).not.toContain("0012");
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${ben.id} and kind = 'signing.completed' and link = ${`/signing/${id}`}`)).length).toBe(1);
  });

  it("does not restrict an ordinary signed document", async () => {
    const id = await send({ signers: [ana, ben] });
    await open(ana, id);
    await signTyped(ana, id);
    await open(ben, id);
    await signTyped(ben, id);
    as(ben);
    expect((await actions.getDocumentLink({ envelopeId: id })).ok).toBe(true);
    expect((await queries.getEnvelopeDetail(id)).envelope.canOpenSealed).toBe(true);
  });
});

describe("the emails of a per-person send", () => {
  it("go out right after the batch (one flush), not at the next job run", async () => {
    const { setEmailSender } = await import("@/modules/notifications/email");
    const { POST } = await import("@/app/api/signing/envelopes/route");
    await db.execute(sql`delete from ops.email_queue`);
    const sent: { to: string; subject: string }[] = [];
    setEmailSender({ send: async (m: { to: string; subject: string }) => void sent.push({ to: m.to, subject: m.subject }) } as never);
    try {
      as(hr);
      const form = new FormData();
      form.set("title", uniq("Batch "));
      form.set("content", "This is a long enough document for the people who are going to sign it in ELEVATE.");
      form.set("individual", "true");
      form.set("signers", JSON.stringify([ana, ben].map((u, i) => ({ userId: u.id, role: "Contractor", position: i + 1 }))));
      const res = await POST(new Request("http://localhost/api/signing/envelopes", { method: "POST", body: form }));
      expect(res.status).toBe(200);
      for (const u of [ana, ben]) expect(sent.filter((m) => m.to === u.email).map((m) => m.subject)).toEqual(["A document is waiting for your signature"]);
    } finally {
      setEmailSender(null);
    }
  });

  it("refuses a PDF whose bytes do not match the checked fingerprint", async () => {
    const pdf = await samplePdf(1);
    const info = await service.inspectPdf(pdf);
    await expect(
      service.createEnvelope({ id: hr.id, email: hr.email, roles: hr.roles }, { title: uniq("Mismatch "), pdf: await samplePdf(2), pdfInfo: info, fileName: "x.pdf", signers: [{ userId: ana.id }], order: "sequential", expiryDays: 14, send: false, ip: null }),
    ).rejects.toThrow(/changed after it was checked/);
  });
});

describe("test marks, archive and delete", () => {
  let superAdmin: TestUser;
  beforeAll(async () => {
    superAdmin = await makeUser("sa", ["super_admin"], ["Sam", "Admin"]);
  });

  const completed = async (extra: { isTest?: boolean } = {}) => {
    const { id } = await service.createEnvelope({ id: hr.id, email: hr.email, roles: hr.roles }, { title: uniq("Trial "), pdf: await samplePdf(1), fileName: "t.pdf", signers: [{ userId: ana.id }], order: "sequential", expiryDays: 14, send: true, ip: null, ...extra });
    await open(ana, id);
    await signTyped(ana, id);
    return id;
  };
  const row = async (id: string) => (await rows<{ is_test: boolean; archived_at: Date | null; status: string }>(sql`select is_test, archived_at, status from docs.esign_envelopes where id = ${id}`))[0];

  it("marks a document as a test (from the send form or afterwards), audited, and shows it as Test to the signee", async () => {
    const id = await completed({ isTest: true });
    expect((await row(id)).is_test).toBe(true);
    const other = await completed();
    expect((await row(other)).is_test).toBe(false);
    as(hr);
    expect((await actions.setEnvelopeTest({ envelopeId: other, isTest: true })).ok).toBe(true);
    expect((await row(other)).is_test).toBe(true);
    expect((await rows(sql`select 1 from ops.audit_log where action = 'signing.mark_test' and target_id = ${other}`)).length).toBe(1);
    as(ana);
    expect((await queries.listMySigning()).find((r) => r.envelopeId === other)?.isTest).toBe(true);
    // not for people who are not HR
    expect(await actions.setEnvelopeTest({ envelopeId: other, isTest: false })).toEqual({ ok: false, error: NO_ACCESS });
  });

  it("archives and restores, keeps it out of the lists, refuses while it waits for signatures, and never deletes", async () => {
    const waiting = await send({ signers: [ana] });
    as(hr);
    expect(await actions.archiveEnvelope({ envelopeId: waiting, archived: true })).toEqual({ ok: false, error: expect.stringContaining("Void it first") });
    const id = await completed();
    as(hr);
    expect((await queries.listEnvelopes("active")).some((e) => e.id === id)).toBe(true);
    expect((await actions.archiveEnvelope({ envelopeId: id, archived: true })).ok).toBe(true);
    expect((await row(id)).archived_at).not.toBeNull();
    expect((await queries.listEnvelopes("active")).some((e) => e.id === id)).toBe(false);
    expect((await queries.listEnvelopes("archived")).some((e) => e.id === id)).toBe(true);
    as(ana);
    expect((await queries.listMySigning()).some((r) => r.envelopeId === id)).toBe(true); // a real archived document stays in the signee's record
    as(hr);
    expect((await actions.archiveEnvelope({ envelopeId: id, archived: false })).ok).toBe(true);
    expect((await queries.listEnvelopes("active")).some((e) => e.id === id)).toBe(true);
    // the test filter only shows marked, unarchived ones
    expect((await queries.listEnvelopes("test")).some((e) => e.id === id)).toBe(false);
  });

  it("hides an archived TEST document from the signee's list, and a test document never verifies as genuine", async () => {
    const id = await completed({ isTest: true });
    const [env] = await rows<{ sealed_sha256: string }>(sql`select sealed_sha256 from docs.esign_envelopes where id = ${id}`);
    as(ana);
    expect((await queries.listMySigning()).some((r) => r.envelopeId === id)).toBe(true); // shown, marked Test
    expect(await queries.verifyFingerprint(env.sealed_sha256)).toEqual({ match: false });
    as(hr);
    await actions.archiveEnvelope({ envelopeId: id, archived: true });
    as(ana);
    expect((await queries.listMySigning()).some((r) => r.envelopeId === id)).toBe(false);
  });

  it("deletes a test document completely (Super Admin, with a reason) and keeps a record; refuses a real one", async () => {
    const test = await completed({ isTest: true });
    const real = await completed();
    const [paths] = await rows<{ original_path: string; sealed_path: string }>(sql`select original_path, sealed_path from docs.esign_envelopes where id = ${test}`);
    expect(fake.objects.has(fake.key("signed-docs", paths.sealed_path))).toBe(true);

    as(hr);
    expect(await actions.deleteTestEnvelope({ envelopeId: test, reason: "Testing only" })).toEqual({ ok: false, error: NO_ACCESS }); // HR cannot
    as(superAdmin);
    expect(await actions.deleteTestEnvelope({ envelopeId: real, reason: "Testing only" })).toEqual({ ok: false, error: expect.stringContaining("marked as a test") });
    expect((await actions.deleteTestEnvelope({ envelopeId: test, reason: "x" })).ok).toBe(false); // a reason is needed
    expect(await actions.deleteTestEnvelope({ envelopeId: test, reason: "Trial run of the handbook" })).toEqual({ ok: true, data: { filesRemoved: true } });

    expect((await rows(sql`select 1 from docs.esign_envelopes where id = ${test}`)).length).toBe(0);
    expect((await rows(sql`select 1 from docs.esign_signers where envelope_id = ${test}`)).length).toBe(0);
    expect((await rows(sql`select 1 from docs.esign_events where envelope_id = ${test}`)).length).toBe(0);
    expect(fake.objects.has(fake.key("signed-docs", paths.sealed_path))).toBe(false);
    expect(fake.objects.has(fake.key("signed-docs", paths.original_path))).toBe(false);
    const [a] = await rows<{ metadata: { reason: string }; before: { title: string } }>(sql`select metadata, before from ops.audit_log where action = 'signing.delete_test' and target_id = ${test}`);
    expect(a.metadata.reason).toBe("Trial run of the handbook");
    // the real one is untouched
    expect((await row(real)).status).toBe("completed");
  });

  it("is enforced by the database: a real signed document cannot be deleted or have its log or signature changed, even directly", async () => {
    const real = await completed();
    await expect(db.execute(sql`delete from docs.esign_events where envelope_id = ${real}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from docs.esign_signers where envelope_id = ${real}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from docs.esign_envelopes where id = ${real}`)).rejects.toThrow();
    const refused = { cause: { message: expect.stringContaining("a signature cannot change") } };
    await expect(db.execute(sql`update docs.esign_signers set details_enc = 'x' where envelope_id = ${real}`)).rejects.toMatchObject(refused);
    await expect(db.execute(sql`update docs.esign_signers set initials_text = 'ZZ' where envelope_id = ${real}`)).rejects.toMatchObject(refused);
    await expect(db.execute(sql`update docs.esign_events set type = 'x' where envelope_id = ${real}`)).rejects.toThrow();
  });
});
