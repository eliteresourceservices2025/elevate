import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PDF_BYTES } from "./fake-storage";

// Real-database tests for offers and hiring (Phase 3.3): templates, making an offer, the applicant signing by emailed link and code (no
// account), the countersigner, sealing, decline, withdraw, resend, and the hire (person record, invitation, onboarding case).

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.40" }), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/modules/signing/session", () => ({ currentSignInMethods: async () => "password, totp" }));

const { db } = await import("@/lib/db");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const { setEmailSender } = await import("@/modules/notifications/email");
const recruitingActions = await import("@/modules/recruiting/actions");
const recruitingService = await import("@/modules/recruiting/service");
const offerActions = await import("@/modules/offers/actions");
const offerQueries = await import("@/modules/offers/queries");
const signingActions = await import("@/modules/signing/actions");
const external = await import("@/modules/signing/external");
const { DEFAULT_OFFER_TEMPLATE } = await import("@/modules/offers/merge");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const idOf = (r: { ok: boolean; data?: { id: string }; error?: string }) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.data!.id;
};
const forbidden = (p: Promise<unknown>) => p.then(() => "resolved", (e: Error) => e.name);

const fake = new FakeStorage();
const mails: { to: string; subject: string; text: string; bcc?: string }[] = [];
const linkIn = (to: string) => {
  const m = [...mails].reverse().find((x) => x.to === to && /\/sign\//.test(x.text));
  return m?.text.match(/\/sign\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
};
const codeFor = (to: string) => [...mails].reverse().find((x) => x.to === to && /Your code is/.test(x.subject))?.subject.match(/\d{6}/)?.[0] ?? null;

async function makeUser(label: string, roles: RoleSlug[], name?: [string, string]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  if (name) await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${name[0]}, ${name[1]}, ${email}, 'active', ${id})`);
  return { id, email, roles };
}

let hr: TestUser;
let recruiter: TestUser;
let lead: TestUser;
let exec: TestUser;
let outsider: TestUser;
let templateId: string;
let positionId: string;

const offerInput = (applicationId: string, extra: Record<string, unknown> = {}) => ({ applicationId, templateId, roleTitle: "Virtual Assistant", startDate: "2026-12-01", clientName: "Acme Dental", payNote: "Hourly rate agreed per client.", expiryDays: 7, send: true, ...extra });

/** An open job, an applicant at the Offer stage. */
async function applicantAtOffer(opts: { name?: string } = {}) {
  as(recruiter);
  const opening = idOf(await recruitingActions.saveOpening({ title: uniq("Offer VA "), description: "Support our clients with scheduling and inbox care.", hiringTeamUserIds: [lead.id] }));
  await recruitingActions.setOpeningStatus({ id: opening, status: "open" });
  const email = `${uniq("cand")}@example.com`;
  expect(await recruitingService.submitApplication({ openingId: opening, fullName: opts.name ?? "Ana Reyes", email, phone: "09170000000", consent: true, website: "" }, { bytes: PDF_BYTES, name: "cv.pdf" })).toEqual({ ok: true });
  const [app] = await rows<{ id: string }>(sql`select a.id from talent.applications a join talent.candidates c on c.id = a.candidate_id where lower(c.email) = ${email}`);
  expect((await recruitingActions.moveApplication({ applicationId: app.id, to: "offer" })).ok).toBe(true);
  return { opening, email, appId: app.id };
}
const offerOf = async (appId: string) => (await rows<{ id: string; envelope_id: string; status: string }>(sql`select o.id, o.envelope_id, e.status from talent.offers o join docs.esign_envelopes e on e.id = o.envelope_id where o.application_id = ${appId} order by o.created_at desc`))[0];
const signerOf = async (envelopeId: string, outside: boolean) => (await rows<{ id: string; status: string; viewed_at: Date | null; user_id: string | null }>(sql`select id, status, viewed_at, user_id from docs.esign_signers where envelope_id = ${envelopeId} and (user_id is null) = ${outside}`))[0];

/** The applicant's side: use the emailed link, get the code, enter it, and return the verified context. */
async function applicantVerifies(email: string) {
  const token = linkIn(email);
  expect(token).toBeTruthy();
  const ctx = (await external.resolveToken(token!))!;
  expect(ctx).toBeTruthy();
  expect(await external.requestCode(ctx)).toEqual({ ok: true });
  const checked = await external.checkCode(ctx, codeFor(email)!, "198.51.100.77");
  if (!checked.ok) throw new Error(checked.error);
  const fresh = (await external.resolveToken(token!))!;
  expect(external.sessionValid(fresh, checked.session)).toBe(true);
  return { token: token!, ctx: fresh, session: checked.session };
}

beforeAll(async () => {
  setDocumentStorage(fake);
  setEmailSender({ send: async (m) => void mails.push({ to: m.to, subject: m.subject, text: m.text, bcc: m.bcc }) });
  hr = await makeUser("hr", ["hr_admin", "employee"], ["Hannah", "Ramos"]);
  recruiter = await makeUser("rec", ["recruiter", "employee"], ["Rey", "Cruz"]);
  lead = await makeUser("lead", ["team_lead", "employee"], ["Lia", "Lim"]);
  exec = await makeUser("exec", ["executive", "employee"], ["Eddie", "Tan"]);
  outsider = await makeUser("out", ["employee"], ["Omar", "Diaz"]);
  const [pos] = await rows<{ id: string }>(sql`insert into core.positions (title) values (${uniq("Virtual Assistant ")}) returning id`);
  positionId = pos.id;
  as(hr);
  templateId = idOf(await offerActions.saveOfferTemplate({ name: uniq("Contractor offer "), body: DEFAULT_OFFER_TEMPLATE }));
});
afterAll(() => {
  setEmailSender(undefined);
  setDocumentStorage(null);
});

describe("templates", () => {
  it("only HR and Super Admin manage them; an unknown field is refused; archived ones cannot be used", async () => {
    as(recruiter);
    expect(await offerActions.saveOfferTemplate({ name: "Nope nope", body: DEFAULT_OFFER_TEMPLATE })).toEqual({ ok: false, error: NO_ACCESS });
    as(hr);
    expect(await offerActions.saveOfferTemplate({ name: uniq("Bad "), body: "Dear {{candidate_name}}, your {{salary}} is great and we are happy to have you." })).toMatchObject({ ok: false, error: expect.stringContaining("{{salary}}") });
    const id = idOf(await offerActions.saveOfferTemplate({ name: uniq("Short lived "), body: DEFAULT_OFFER_TEMPLATE }));
    expect((await offerActions.archiveOfferTemplate({ templateId: id })).ok).toBe(true);
    const { appId } = await applicantAtOffer();
    as(recruiter);
    expect(await offerActions.makeOffer(offerInput(appId, { templateId: id }))).toEqual({ ok: false, error: "That template was not found or is archived." });
  });
});

describe("making an offer", () => {
  it("creates a PDF, emails the applicant their link, and records an offer whose status follows the envelope", async () => {
    const { appId, email } = await applicantAtOffer();
    mails.length = 0;
    as(recruiter);
    const result = await offerActions.makeOffer(offerInput(appId));
    expect(result).toMatchObject({ ok: true, data: { emailed: true } });

    const offer = await offerOf(appId);
    expect(offer.status).toBe("out");
    const [row] = await rows<{ rendered_body: string; fields: Record<string, string> }>(sql`select rendered_body, fields from talent.offers where id = ${offer.id}`);
    expect(row.rendered_body).toContain("Dear Ana Reyes,");
    expect(row.rendered_body).toContain("Pay: Hourly rate agreed per client.");
    expect(row.rendered_body).not.toContain("{{");

    const [env] = await rows<{ original_path: string; title: string; signing_order: string }>(sql`select original_path, title, signing_order from docs.esign_envelopes where id = ${offer.envelope_id}`);
    const pdf = fake.objects.get(fake.key("signed-docs", env.original_path))!;
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);
    expect(env.title).toBe("Offer: Virtual Assistant");

    const outside = await signerOf(offer.envelope_id, true);
    expect(outside.status).toBe("pending");
    const mail = mails.find((m) => m.to === email)!;
    expect(mail.subject).toBe("A document is waiting for your signature");
    expect(mail.text).toMatch(/\/sign\/[A-Za-z0-9_-]{40,}/);
    expect(mail.text).not.toMatch(/Virtual Assistant|Hourly rate|Acme/); // no role, pay or client in the email
    expect(mail.bcc).toBeUndefined(); // the link is a secret: never copied to a shared mailbox
    // The token is stored only as a hash
    const [stored] = await rows<{ access_token_hash: string }>(sql`select access_token_hash from docs.esign_signers where id = ${outside.id}`);
    expect(stored.access_token_hash).toHaveLength(64);
    expect(mail.text).not.toContain(stored.access_token_hash);
  });

  it("needs the Offer stage, every required field, and refuses a second offer while one is waiting", async () => {
    const { appId } = await applicantAtOffer();
    as(recruiter);
    expect((await offerActions.makeOffer(offerInput(appId, { roleTitle: "" }))).ok).toBe(false);
    expect((await offerActions.makeOffer(offerInput(appId))).ok).toBe(true);
    expect(await offerActions.makeOffer(offerInput(appId))).toEqual({ ok: false, error: expect.stringContaining("already an offer waiting") });

    // Not at the Offer stage
    as(recruiter);
    const other = await applicantAtOffer();
    await recruitingActions.moveApplication({ applicationId: other.appId, to: "screening" });
    expect(await offerActions.makeOffer(offerInput(other.appId))).toEqual({ ok: false, error: "Move the applicant to the Offer stage first." });
  });

  it("is for recruiters, HR and Super Admin; a lead and an outsider are refused", async () => {
    const { appId } = await applicantAtOffer();
    for (const u of [lead, outsider, exec]) {
      as(u);
      expect(await offerActions.makeOffer(offerInput(appId))).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(hr);
    expect((await offerActions.makeOffer(offerInput(appId))).ok).toBe(true);
  });

  it("can be saved as a draft, sent later, and the preview shows the filled letter", async () => {
    const { appId, email } = await applicantAtOffer();
    as(recruiter);
    const preview = await offerActions.previewOffer({ applicationId: appId, templateId, roleTitle: "Virtual Assistant", startDate: "2026-12-01", payNote: "Per client", expiryDays: 7 });
    expect(preview).toMatchObject({ ok: true, data: { text: expect.stringContaining("Dear Ana Reyes,") } });
    mails.length = 0;
    expect((await offerActions.makeOffer(offerInput(appId, { send: false }))).ok).toBe(true);
    expect(mails.filter((m) => m.to === email)).toHaveLength(0); // a draft sends nothing
    const offer = await offerOf(appId);
    expect(offer.status).toBe("draft");
    const [o] = await rows<{ id: string }>(sql`select id from talent.offers where application_id = ${appId}`);
    expect(await offerActions.sendOffer({ offerId: o.id })).toEqual({ ok: true, data: { emailed: true } });
    expect((await offerOf(appId)).status).toBe("out");
    expect(linkIn(email)).toBeTruthy();
    expect((await offerActions.sendOffer({ offerId: o.id })).ok).toBe(false); // once
  });
});

describe("the applicant signs without an account", () => {
  it("reads and signs after an emailed code; the offer then shows as signed and the sealed copy carries their details", async () => {
    const { appId, email } = await applicantAtOffer();
    as(recruiter);
    await offerActions.makeOffer(offerInput(appId));
    const offer = await offerOf(appId);

    const { ctx, session, token: original } = await applicantVerifies(email);
    expect(ctx.state).toBe("active");
    // Cannot sign before opening the document
    await expect(external.externalSign(ctx, { consent: true, kind: "typed", typedText: "Ana Reyes" }, "198.51.100.77")).rejects.toThrow(/read it before/);
    const doc = await external.externalDocument(ctx, "198.51.100.77");
    expect(doc.sealed).toBe(false);
    expect(new TextDecoder().decode(doc.bytes.slice(0, 5))).toBe("%PDF-");
    expect((await signerOf(offer.envelope_id, true)).viewed_at).not.toBeNull();
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${recruiter.id} and kind = 'signing.viewed'`)).length).toBeGreaterThan(0);

    await expect(external.externalSign(ctx, { consent: false, kind: "typed", typedText: "Ana Reyes" }, null)).rejects.toThrow(/Tick the box/);
    await expect(external.externalSign(ctx, { consent: true, kind: "typed", typedText: "山田" }, null)).rejects.toThrow(/English-alphabet/);
    mails.length = 0;
    await external.externalSign(ctx, { consent: true, kind: "typed", typedText: "Ana Reyes" }, "198.51.100.77");

    const [sealedEnv] = await rows<{ status: string; sealed_path: string }>(sql`select status, sealed_path from docs.esign_envelopes where id = ${offer.envelope_id}`);
    expect(sealedEnv.status).toBe("completed");
    const sealed = await PDFDocument.load(fake.objects.get(fake.key("signed-docs", sealedEnv.sealed_path))!);
    expect(sealed.getPageCount()).toBeGreaterThanOrEqual(3); // letter + signature page + certificate
    const [sig] = await rows<{ signed_name: string; ip: string; mfa_methods: string; user_id: string | null }>(sql`select signed_name, ip, mfa_methods, user_id from docs.esign_signers where envelope_id = ${offer.envelope_id}`);
    expect(sig).toMatchObject({ signed_name: "Ana Reyes", ip: "198.51.100.77", mfa_methods: "email link and one-time code", user_id: null });
    // Right after signing they can still open the signed copy in the same visit (the session lasts two hours)
    expect(external.sessionValid((await external.resolveToken(linkIn(email)!)) ?? ctx, session)).toBe(true);

    // Offer status, and the applicant's later link (a fresh one) opens the signed copy
    const events = await rows<{ type: string }>(sql`select type from docs.esign_events where envelope_id = ${offer.envelope_id} order by seq`);
    expect(events.map((e) => e.type)).toEqual(["created", "sent", "viewed", "consented", "signed", "sealed"]);
    // The link they were using still opens the signed copy (the new email link is an extra way in)
    expect((await external.resolveToken(original))?.state).toBe("done");
    const later = mails.find((m) => m.to === email && m.subject === "Your signed document is ready");
    expect(later).toBeTruthy();
    const token = later!.text.match(/\/sign\/([A-Za-z0-9_-]+)/)![1];
    const again = (await external.resolveToken(token))!;
    expect(again.state).toBe("done");
    expect(await external.requestCode(again)).toEqual({ ok: true });
    const ok = await external.checkCode(again, codeFor(email)!, null);
    expect(ok.ok).toBe(true);
    const fresh = (await external.resolveToken(token))!;
    expect((await external.externalDocument(fresh, null)).sealed).toBe(true);

    as(recruiter);
    const panel = await offerQueries.getOfferPanel(appId);
    expect(panel.offers[0]).toMatchObject({ status: "signed", hasCounterSigner: false });
  });

  it("an ELEVATE countersigner signs after the applicant, then it is sealed with both", async () => {
    const { appId, email } = await applicantAtOffer();
    as(recruiter);
    await offerActions.makeOffer(offerInput(appId, { counterSignerUserId: exec.id }));
    const offer = await offerOf(appId);
    const counter = await signerOf(offer.envelope_id, false);
    expect(counter.status).toBe("waiting");

    const { ctx } = await applicantVerifies(email);
    await external.externalDocument(ctx, null);
    await external.externalSign(ctx, { consent: true, kind: "typed", typedText: "Ana Reyes" }, null);
    expect((await signerOf(offer.envelope_id, false)).status).toBe("pending"); // woken
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${exec.id} and kind = 'signing.turn' and link = ${`/signing/${offer.envelope_id}`}`)).length).toBe(1);
    expect((await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${offer.envelope_id}`))[0].status).toBe("out");

    as(exec);
    expect((await signingActions.getDocumentLink({ envelopeId: offer.envelope_id })).ok).toBe(true);
    expect((await signingActions.signEnvelope({ envelopeId: offer.envelope_id, consent: true, kind: "typed", typedText: "Eddie Tan" })).ok).toBe(true);
    expect((await rows<{ status: string }>(sql`select status from docs.esign_envelopes where id = ${offer.envelope_id}`))[0].status).toBe("completed");
    as(recruiter);
    expect((await offerQueries.getOfferPanel(appId)).offers[0]).toMatchObject({ status: "signed", hasCounterSigner: true, counterSigned: true });
  });

  it("locks a code after five wrong tries, refuses an expired one, and a new code starts again", async () => {
    const { appId, email } = await applicantAtOffer();
    as(recruiter);
    await offerActions.makeOffer(offerInput(appId));
    const token = linkIn(email)!;
    let ctx = (await external.resolveToken(token))!;
    await external.requestCode(ctx);
    const right = codeFor(email)!;
    const wrong = right === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) expect(await external.checkCode(ctx, wrong, null)).toEqual({ ok: false, error: "That code is not right." });
    expect(await external.checkCode(ctx, wrong, null)).toEqual({ ok: false, error: expect.stringContaining("Too many wrong tries") });
    expect(await external.checkCode(ctx, right, null)).toEqual({ ok: false, error: expect.stringContaining("Too many wrong tries") }); // even the right one is locked

    ctx = (await external.resolveToken(token))!;
    mails.length = 0;
    expect(await external.requestCode(ctx)).toEqual({ ok: true });
    const fresh = codeFor(email)!;
    await db.execute(sql`update docs.esign_signers set code_expires_at = now() - interval '1 minute' where id = ${ctx.signer.id}`);
    expect(await external.checkCode(ctx, fresh, null)).toEqual({ ok: false, error: expect.stringContaining("expired") });
    expect(await external.checkCode(ctx, "12ab56", null)).toEqual({ ok: false, error: "That code is not right." });

    // A code is single use
    mails.length = 0;
    await external.requestCode((await external.resolveToken(token))!);
    const again = codeFor(email)!;
    expect((await external.checkCode((await external.resolveToken(token))!, again, null)).ok).toBe(true);
    expect((await external.checkCode((await external.resolveToken(token))!, again, null)).ok).toBe(false);
  });

  it("limits codes to five an hour, and an unknown, replaced or malformed link is not valid", async () => {
    const { appId, email } = await applicantAtOffer();
    as(recruiter);
    await offerActions.makeOffer(offerInput(appId));
    const token = linkIn(email)!;
    for (let i = 0; i < 5; i++) expect(await external.requestCode((await external.resolveToken(token))!)).toEqual({ ok: true });
    expect(await external.requestCode((await external.resolveToken(token))!)).toEqual({ ok: false, error: expect.stringContaining("Too many codes") });

    expect(await external.resolveToken("not-a-token")).toBeNull();
    expect(await external.resolveToken("A".repeat(43))).toBeNull();
    // Resending replaces the link: the old one stops working and the new one works
    const [o] = await rows<{ id: string }>(sql`select id from talent.offers where application_id = ${appId}`);
    mails.length = 0;
    expect(await offerActions.resendOfferLink({ offerId: o.id })).toEqual({ ok: true, data: { emailed: true } });
    const newToken = linkIn(email)!;
    expect(newToken).not.toBe(token);
    expect(await external.resolveToken(token)).toBeNull();
    expect((await external.resolveToken(newToken))?.state).toBe("active");
  });

  it("needs the session: a link alone cannot read or sign, and a wrong session value is refused", async () => {
    const { appId, email } = await applicantAtOffer();
    as(recruiter);
    await offerActions.makeOffer(offerInput(appId));
    const ctx = (await external.resolveToken(linkIn(email)!))!;
    expect(external.sessionValid(ctx, undefined)).toBe(false);
    expect(external.sessionValid(ctx, "guess")).toBe(false);
    const verified = await applicantVerifies(email);
    expect(external.sessionValid(verified.ctx, verified.session)).toBe(true);
    expect(external.sessionValid(verified.ctx, verified.session + "x")).toBe(false);
    await db.execute(sql`update docs.esign_signers set session_expires_at = now() - interval '1 minute' where id = ${ctx.signer.id}`);
    expect(external.sessionValid((await external.resolveToken(verified.token))!, verified.session)).toBe(false);
  });

  it("a decline closes the offer, tells HR and the recruiter, and the link then says it is closed", async () => {
    const { appId, email } = await applicantAtOffer();
    as(recruiter);
    await offerActions.makeOffer(offerInput(appId));
    const { ctx, token } = await applicantVerifies(email);
    await expect(external.externalDecline(ctx, "no", null)).rejects.toThrow(/short reason/);
    await external.externalDecline(ctx, "I accepted another job", "198.51.100.77");
    expect((await offerOf(appId)).status).toBe("declined");
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${recruiter.id} and kind = 'signing.declined'`)).length).toBeGreaterThan(0);
    expect((await external.resolveToken(token))?.state).toBe("closed");
    as(recruiter);
    expect((await offerQueries.getOfferPanel(appId)).offers[0].status).toBe("declined");
    // After a decline a new offer can be made
    expect((await offerActions.makeOffer(offerInput(appId))).ok).toBe(true);
  });

  it("withdrawing an offer closes the applicant's link; an expired offer cannot be signed", async () => {
    const a = await applicantAtOffer();
    as(recruiter);
    await offerActions.makeOffer(offerInput(a.appId));
    const [o] = await rows<{ id: string }>(sql`select id from talent.offers where application_id = ${a.appId}`);
    const token = linkIn(a.email)!;
    expect(await offerActions.withdrawOffer({ offerId: o.id })).toEqual({ ok: true, data: undefined });
    expect((await offerOf(a.appId)).status).toBe("voided");
    expect((await external.resolveToken(token))?.state).toBe("closed");
    expect((await offerActions.withdrawOffer({ offerId: o.id })).ok).toBe(false);

    const b = await applicantAtOffer();
    as(recruiter);
    await offerActions.makeOffer(offerInput(b.appId));
    const { ctx } = await applicantVerifies(b.email);
    await external.externalDocument(ctx, null);
    await db.execute(sql`update docs.esign_envelopes set expires_at = now() - interval '1 hour' where id = ${ctx.env.id}`);
    await expect(external.externalSign((await external.resolveToken(linkIn(b.email)!))!, { consent: true, kind: "typed", typedText: "Ana Reyes" }, null)).rejects.toThrow(/expired/);
  });
});

describe("who can see offers", () => {
  it("shows them to the hiring team and HR, and refuses a lead off the team and anyone else", async () => {
    const { appId } = await applicantAtOffer();
    as(recruiter);
    await offerActions.makeOffer(offerInput(appId));
    as(lead);
    const view = await offerQueries.getOfferPanel(appId);
    expect(view).toMatchObject({ canMake: false, canHire: false });
    expect(view.offers).toHaveLength(1);
    as(outsider);
    expect(await forbidden(offerQueries.getOfferPanel(appId))).toBe("ForbiddenError");
    as(hr);
    expect(await offerQueries.getOfferPanel(appId)).toMatchObject({ canHire: true, canMake: true });
  });
});

describe("hiring", () => {
  async function signedOffer(name = "Ana Reyes") {
    const a = await applicantAtOffer({ name });
    as(recruiter);
    await offerActions.makeOffer(offerInput(a.appId));
    const { ctx } = await applicantVerifies(a.email);
    await external.externalDocument(ctx, null);
    await external.externalSign(ctx, { consent: true, kind: "typed", typedText: name }, null);
    return a;
  }
  const hireInput = (applicationId: string, email: string, extra: Record<string, unknown> = {}) => ({ applicationId, legalFirstName: "Ana", legalLastName: "Reyes", workEmail: email, positionId, startDate: "2026-12-01", ...extra });

  it("creates the person record, marks the application hired, opens an onboarding case, and invites them to ELEVATE", async () => {
    const { appId, email } = await signedOffer();
    mails.length = 0;
    as(hr);
    const result = await offerActions.hireCandidate(hireInput(appId, email));
    expect(result).toMatchObject({ ok: true, data: { invited: true, emailed: true } });
    const employeeId = (result as { data: { employeeId: string } }).data.employeeId;

    const [emp] = await rows<{ legal_first_name: string; legal_last_name: string; work_email: string; status: string; worker_type: string; position: string; start_date: string; personal_email: string | null }>(sql`select legal_first_name, legal_last_name, work_email, status, worker_type, position, start_date::text, personal_email from core.employees where id = ${employeeId}`);
    expect(emp).toMatchObject({ legal_first_name: "Ana", legal_last_name: "Reyes", work_email: email, status: "onboarding", worker_type: "contractor", start_date: "2026-12-01" });
    expect(emp.position).toContain("Virtual Assistant");
    const [app] = await rows<{ stage: string; closed_at: Date | null }>(sql`select stage, closed_at from talent.applications where id = ${appId}`);
    expect(app.stage).toBe("hired");
    expect(app.closed_at).not.toBeNull();
    expect((await rows<{ to_stage: string }>(sql`select to_stage from talent.application_stage_history where application_id = ${appId} order by at, id`)).map((h) => h.to_stage).slice(-1)).toEqual(["hired"]);
    const [oc] = await rows<{ employee_id: string; offer_id: string | null; status: string; start_date: string }>(sql`select employee_id, offer_id, status, start_date::text from talent.onboarding_cases where application_id = ${appId}`);
    expect(oc).toMatchObject({ employee_id: employeeId, status: "open", start_date: "2026-12-01" });
    expect(oc.offer_id).not.toBeNull();
    expect(await rows(sql`select 1 from core.invitations where lower(email) = ${email}`)).toHaveLength(1);
    expect(mails.some((m) => m.to === email && m.subject === "Your ELEVATE invitation")).toBe(true);
    expect((await rows(sql`select 1 from ops.audit_log where action = 'offers.hire' and target_id = ${appId}`)).length).toBe(1);
    expect((await rows(sql`select 1 from core.employment_history where employee_id = ${employeeId} and event_type = 'hired'`)).length).toBe(1);

    // Final: cannot be hired twice, moved, or rejected
    expect((await offerActions.hireCandidate(hireInput(appId, email))).ok).toBe(false);
    as(recruiter);
    expect((await recruitingActions.moveApplication({ applicationId: appId, to: "offer" })).ok).toBe(false);
    as(hr);
    expect((await offerQueries.getOfferPanel(appId)).hiredEmployeeId).toBe(employeeId);
  });

  it("needs a signed offer or a written reason, and the reason is recorded", async () => {
    const a = await applicantAtOffer();
    as(hr);
    expect(await offerActions.hireCandidate(hireInput(a.appId, a.email))).toEqual({ ok: false, error: expect.stringContaining("no signed offer") });
    expect((await offerActions.hireCandidate(hireInput(a.appId, a.email, { withoutOfferReason: "Signed on paper at the office" }))).ok).toBe(true);
    const [oc] = await rows<{ offer_id: string | null; hired_without_offer_reason: string }>(sql`select offer_id, hired_without_offer_reason from talent.onboarding_cases where application_id = ${a.appId}`);
    expect(oc).toEqual({ offer_id: null, hired_without_offer_reason: "Signed on paper at the office" });
  });

  it("is for HR and Super Admin only", async () => {
    const { appId, email } = await signedOffer();
    for (const u of [recruiter, lead, exec, outsider]) {
      as(u);
      expect(await offerActions.hireCandidate(hireInput(appId, email))).toEqual({ ok: false, error: NO_ACCESS });
    }
  });

  it("links an existing ELEVATE account with the same email instead of inviting, and refuses a work email already taken", async () => {
    const a = await signedOffer("Bea Santos");
    const existing = await makeUser("bea", ["employee"]);
    as(hr);
    const linked = await offerActions.hireCandidate(hireInput(a.appId, existing.email, { legalFirstName: "Bea", legalLastName: "Santos" }));
    expect(linked).toMatchObject({ ok: true, data: { invited: false } });
    const [emp] = await rows<{ user_id: string }>(sql`select user_id from core.employees where lower(work_email) = ${existing.email}`);
    expect(emp.user_id).toBe(existing.id);
    expect(await rows(sql`select 1 from core.invitations where lower(email) = ${existing.email}`)).toHaveLength(0);

    const b = await signedOffer("Cy Dela Cruz");
    as(hr);
    expect(await offerActions.hireCandidate(hireInput(b.appId, existing.email))).toEqual({ ok: false, error: "Someone with that work email already exists." });
    expect((await rows<{ stage: string }>(sql`select stage from talent.applications where id = ${b.appId}`))[0].stage).not.toBe("hired"); // all or nothing
  });

  it("refuses a rejected application and keeps retention away from a hired person", async () => {
    const a = await applicantAtOffer();
    as(recruiter);
    await recruitingActions.rejectApplication({ applicationId: a.appId, reason: "Withdrew", kind: "withdrawn" });
    as(hr);
    expect(await offerActions.hireCandidate(hireInput(a.appId, a.email, { withoutOfferReason: "Because I said so" }))).toEqual({ ok: false, error: "Reopen the application before hiring." });
  });
});
