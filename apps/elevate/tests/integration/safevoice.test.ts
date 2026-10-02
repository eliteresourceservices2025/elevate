import { randomUUID } from "node:crypto";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { testDatabaseUrl } from "./global-setup";

// Real-database tests for Safe Voice (Phase 4.2): the database roles and what they may touch, the anonymity of what is stored, the
// reporter flow (submit, open, reply) through the real request handlers, wrong code and wrong passphrase looking identical, attachments
// coming out without metadata, and the handler side (who may see cases, replying, status, closing, audit without text, counts with
// small categories hidden, the notification job).

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.200", "user-agent": "HandlerBrowser/1.0" }), cookies: async () => ({ get: () => undefined }) }));

const PEPPER = "integration-test-pepper-integration-test-0123456789";
const APP_PASSWORD = "app-test-password-not-a-secret";
const HANDLER_PASSWORD = "handler-test-password-not-a-secret";
const adminUrl = process.env.TEST_DB_ADMIN_URL!;

function roleUrl(role: string, password: string) {
  const url = new URL(testDatabaseUrl(adminUrl));
  url.username = role;
  url.password = password;
  return url.toString();
}

// The environment must be set before the modules that read it are loaded.
process.env.SAFEVOICE_DATABASE_URL = roleUrl("safevoice_app", APP_PASSWORD);
process.env.SAFEVOICE_HANDLER_DATABASE_URL = roleUrl("safevoice_handler", HANDLER_PASSWORD);
process.env.SAFEVOICE_PEPPER = PEPPER;

const admin = postgres(testDatabaseUrl(adminUrl), { max: 2, onnotice: () => {} });
await admin.unsafe(`alter role safevoice_app login password '${APP_PASSWORD}'`);
await admin.unsafe(`alter role safevoice_handler login password '${HANDLER_PASSWORD}'`);

const { sharp } = await import("../../../safe-voice/tests/helpers");
const { db } = await import("@/lib/db");
const { handleOpen, handleReply, handleSubmit } = await import("../../../safe-voice/src/lib/handlers");
const { getSql } = await import("../../../safe-voice/src/lib/db");
const actions = await import("@/modules/safevoice/actions");
const queries = await import("@/modules/safevoice/queries");
const jobs = await import("@/modules/safevoice/jobs");

const deps = { sql: getSql(), pepper: PEPPER };
type Res = { ok: boolean; error?: string; caseCode?: string; passphrase?: string; case?: { status: string; outcome: string | null; messages: { author: string; body: string; day: string; attachments: number }[]; reportAttachments: number; createdDay: string } };
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: unknown) => {
  current.user = u;
};

const IP = "198.51.100.77";
const AGENT = "ReporterBrowser/9.9 (secret device)";
const COOKIE = "session=SECRET_SESSION_COOKIE_VALUE";
const MARK = "SECRET-CAMERA-OWNER-Dela-Cruz";

const headers = { cookie: COOKIE, "user-agent": AGENT, "x-forwarded-for": IP, referer: "https://elevate.example.com/people" };

async function jpegWithExif() {
  return sharp({ create: { width: 64, height: 32, channels: 3, background: "#336699" } }).withExif({ IFD0: { Copyright: MARK, Artist: MARK } }).jpeg().toBuffer();
}
async function pdfWithInfo() {
  const doc = await PDFDocument.create();
  doc.setAuthor(MARK);
  doc.setTitle(MARK);
  const page = doc.addPage([200, 200]);
  page.drawText("evidence", { x: 20, y: 100 });
  page.node.set(PDFName.of("Annots"), doc.context.obj([doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Text", Rect: [1, 1, 5, 5], T: PDFString.of(MARK) }))]));
  return doc.save({ useObjectStreams: false });
}
const blob = (bytes: Uint8Array, type: string) => new Blob([new Uint8Array(bytes)], { type });

function formRequest(path: string, fields: Record<string, string>, files: { name: string; bytes: Uint8Array; type: string }[] = [], extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const f of files) form.append("files", blob(f.bytes, f.type), f.name);
  return new Request(`http://localhost${path}`, { method: "POST", body: form, headers: { ...headers, ...extra } });
}
const jsonRequest = (path: string, body: unknown) => new Request(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: { ...headers, "content-type": "application/json" } });
const read = async (r: Response) => ({ status: r.status, headers: r.headers, body: (await r.json()) as Res });

async function submit(description = "A manager shouted at the whole team and threatened people's jobs.", category = "management_conduct", files: Parameters<typeof formRequest>[2] = []) {
  const r = await read(await handleSubmit(formRequest("/api/report", { category, description }, files), deps));
  expect(r.status).toBe(200);
  return { code: r.body.caseCode!, pass: r.body.passphrase! };
}
const open = async (caseCode: string, passphrase: string) => read(await handleOpen(jsonRequest("/api/case/open", { caseCode, passphrase }), deps));

type TestUser = { id: string; email: string; roles: RoleSlug[]; isSafevoiceHandler?: boolean };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
async function makeUser(label: string, roles: RoleSlug[], handler = false): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email, is_safevoice_handler) values (${id}, ${email}, ${handler})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles, isSafevoiceHandler: handler };
}

let handler: TestUser;
let handler2: TestUser;
let superAdmin: TestUser;
let hr: TestUser;
let executive: TestUser;
let employee: TestUser;

beforeAll(async () => {
  handler = await makeUser("handler", ["employee"], true);
  handler2 = await makeUser("handler2", ["hr_admin"], true);
  superAdmin = await makeUser("super", ["super_admin"]);
  hr = await makeUser("hr", ["hr_admin"]);
  executive = await makeUser("exec", ["executive"]);
  employee = await makeUser("emp", ["employee"]);
});

afterAll(async () => {
  await admin.end();
  await getSql().end();
});

describe("database roles", () => {
  const denied = async (client: ReturnType<typeof postgres>, query: string) => {
    try {
      await client.unsafe(query);
      return "allowed";
    } catch (e) {
      return (e as { code?: string }).code ?? "error";
    }
  };
  const PERMISSION_DENIED = "42501";

  it("both roles have no login until operations sets a password, and cannot create anything", async () => {
    const [r] = await admin`select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls, rolreplication from pg_roles where rolname = 'safevoice_app'`;
    expect(r).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolreplication: false });
    const [h] = await admin`select rolsuper, rolbypassrls from pg_roles where rolname = 'safevoice_handler'`;
    expect(h).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("the reporter-facing role reaches nothing but the three Safe Voice tables, and cannot rewrite or delete", async () => {
    const app = postgres(process.env.SAFEVOICE_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      expect(await denied(app, "select * from core.users")).toBe(PERMISSION_DENIED);
      expect(await denied(app, "select * from ops.audit_log")).toBe(PERMISSION_DENIED);
      expect(await denied(app, "select * from ops.notifications")).toBe(PERMISSION_DENIED);
      expect(await denied(app, "select description from ops.safevoice_reports")).toBe(PERMISSION_DENIED);
      expect(await denied(app, "select category from ops.safevoice_reports")).toBe(PERMISSION_DENIED);
      expect(await denied(app, "select data from ops.safevoice_attachments")).toBe(PERMISSION_DENIED);
      expect(await denied(app, "update ops.safevoice_reports set status = 'closed'")).toBe(PERMISSION_DENIED);
      expect(await denied(app, "delete from ops.safevoice_reports")).toBe(PERMISSION_DENIED);
      expect(await denied(app, "delete from ops.safevoice_messages")).toBe(PERMISSION_DENIED);
      expect(await denied(app, "update ops.safevoice_messages set body = 'x'")).toBe(PERMISSION_DENIED);
      expect(await denied(app, "create table public.x (a int)")).not.toBe("allowed");
      // What it is for works:
      expect(await denied(app, "select id, code_hash, status from ops.safevoice_reports limit 1")).toBe("allowed");
    } finally {
      await app.end();
    }
  });

  it("row-level security only lets the app write a reporter's message and a new, open report", async () => {
    const app = postgres(process.env.SAFEVOICE_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      const { code, pass } = await submit();
      void code;
      void pass;
      const [r] = await admin`select id from ops.safevoice_reports order by id limit 1`;
      expect(await denied(app, `insert into ops.safevoice_messages (report_id, author, body) values ('${r.id}', 'handler', 'I am a handler')`)).not.toBe("allowed");
      expect(await denied(app, `insert into ops.safevoice_reports (code_hash, pass_salt, pass_hash, category, description, status, outcome, closed_day) values ('\\x01', '\\x01', '\\x01', 'other', 'x', 'closed', 'no_action', now()::date)`)).not.toBe("allowed");
      expect(await denied(app, `insert into ops.safevoice_messages (report_id, author, body) values ('${r.id}', 'reporter', 'fine')`)).toBe("allowed");
    } finally {
      await app.end();
    }
  });

  it("the handler role never sees the code or passphrase hashes, cannot rewrite text, and cannot write as a reporter", async () => {
    const h = postgres(process.env.SAFEVOICE_HANDLER_DATABASE_URL!, { max: 1, onnotice: () => {} });
    try {
      expect(await denied(h, "select code_hash from ops.safevoice_reports")).toBe(PERMISSION_DENIED);
      expect(await denied(h, "select pass_hash from ops.safevoice_reports")).toBe(PERMISSION_DENIED);
      expect(await denied(h, "select pass_salt from ops.safevoice_reports")).toBe(PERMISSION_DENIED);
      expect(await denied(h, "select * from core.users")).toBe(PERMISSION_DENIED);
      expect(await denied(h, "update ops.safevoice_reports set description = 'edited'")).toBe(PERMISSION_DENIED);
      expect(await denied(h, "update ops.safevoice_messages set body = 'edited'")).toBe(PERMISSION_DENIED);
      expect(await denied(h, "delete from ops.safevoice_reports")).toBe(PERMISSION_DENIED);
      expect(await denied(h, "select id, category, description, status from ops.safevoice_reports limit 1")).toBe("allowed");
      const [r] = await admin`select id from ops.safevoice_reports limit 1`;
      expect(await denied(h, `insert into ops.safevoice_messages (report_id, author, body) values ('${r.id}', 'reporter', 'forged')`)).not.toBe("allowed");
    } finally {
      await h.end();
    }
  });

  it("even the owner cannot rewrite a report's text or delete a report or message (triggers)", async () => {
    await expect(admin.unsafe("update ops.safevoice_reports set description = 'rewritten'")).rejects.toThrow(/cannot be rewritten/);
    await expect(admin.unsafe("delete from ops.safevoice_reports")).rejects.toThrow(/cannot be deleted/);
    await expect(admin.unsafe("update ops.safevoice_messages set body = 'rewritten'")).rejects.toThrow(/cannot be rewritten/);
    await expect(admin.unsafe("delete from ops.safevoice_messages")).rejects.toThrow(/cannot be deleted/);
  });
});

describe("what is stored is anonymous", () => {
  it("has no timestamp, address, device, user or file name column in any Safe Voice table", async () => {
    const cols = await admin`select table_name, column_name, data_type from information_schema.columns where table_schema = 'ops' and table_name like 'safevoice_%'`;
    expect(cols.length).toBeGreaterThan(15);
    for (const c of cols) {
      expect(c.data_type).not.toMatch(/timestamp|time/);
      expect(c.column_name).not.toMatch(/(^|_)(ip|user|agent|email|file_?name|name|cookie|session|created_at|updated_at)(_|$)/);
    }
  });

  it("a report with files stores none of the request details, and only the day", async () => {
    const { code, pass } = await submit("Details that I am comfortable sharing about a coworker.", "harassment", [
      { name: "holiday-photo-from-my-phone.jpg", bytes: await jpegWithExif(), type: "image/jpeg" },
      { name: "evidence-by-maria-santos.pdf", bytes: await pdfWithInfo(), type: "application/pdf" },
    ]);
    expect(code).toMatch(/^SV-/);
    expect(pass.length).toBeGreaterThan(20);
    const dump = (await admin`select row_to_json(r)::text as t from ops.safevoice_reports r union all select row_to_json(m)::text from ops.safevoice_messages m union all select (to_jsonb(a) - 'data')::text from ops.safevoice_attachments a`).map((r) => r.t as string).join("\n");
    for (const secret of [IP, AGENT, COOKIE, "SECRET_SESSION", "holiday-photo", "maria-santos", ".jpg", "elevate.example.com", code, pass, code.replace(/-/g, ""), "ReporterBrowser"]) expect(dump).not.toContain(secret);
    // The code and the passphrase are stored only as keyed hashes.
    const [r] = await admin`select created_day::text as day, octet_length(code_hash) as c, octet_length(pass_hash) as p, octet_length(pass_salt) as s from ops.safevoice_reports order by created_day desc limit 1`;
    expect(r.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect([r.c, r.p, r.s]).toEqual([32, 32, 16]);
  });

  it("stored attachments have no EXIF, no PDF Info, no annotations and no author", async () => {
    await submit("A report with files again.", "harassment", [
      { name: "a.jpg", bytes: await jpegWithExif(), type: "image/jpeg" },
      { name: "b.pdf", bytes: await pdfWithInfo(), type: "application/pdf" },
    ]);
    const files = await admin`select content_type, data from ops.safevoice_attachments order by content_type`;
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const f of files) {
      const bytes = f.data as Buffer;
      expect(bytes.includes(Buffer.from(MARK))).toBe(false);
      if (f.content_type === "image/jpeg") expect((await sharp(bytes).metadata()).exif).toBeUndefined();
      if (f.content_type === "application/pdf") {
        expect(bytes.includes(Buffer.from("/Annots"))).toBe(false);
        const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
        expect([pdf.getAuthor(), pdf.getTitle(), pdf.getProducer(), pdf.getCreator(), pdf.getCreationDate()]).toEqual([undefined, undefined, undefined, undefined, undefined]);
      }
    }
  });
});

describe("the reporter flow (request handlers)", () => {
  it("sets no cookie, whatever cookies and headers the request carries, and replies are never cacheable", async () => {
    const response = await handleSubmit(formRequest("/api/report", { category: "safety", description: "The fire exit is blocked every night." }), deps);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    const opened = await handleOpen(jsonRequest("/api/case/open", { caseCode: "SV-AAAA-AAAA-AAAA", passphrase: "x" }), deps);
    expect(opened.headers.get("set-cookie")).toBeNull();
    expect(opened.headers.get("cache-control")).toBe("no-store");
  });

  it("opens a case with its code and passphrase, forgiving of case, spaces and dashes", async () => {
    const { code, pass } = await submit();
    const ok = await open(code, pass);
    expect(ok.status).toBe(200);
    expect(ok.body.case).toMatchObject({ status: "new", outcome: null, messages: [], reportAttachments: 0 });
    expect(ok.body.case!.createdDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await open(code.toLowerCase().replace(/-/g, " "), pass.toLowerCase().replace(/-/g, ""))).status).toBe(200);
  });

  it("a wrong passphrase, an unknown code, a malformed code and a broken request all answer identically", async () => {
    const { code, pass } = await submit();
    const wrongPass = await open(code, "AAAAA-AAAAA-AAAAA-AAAAA");
    const unknownCode = await open("SV-AAAA-AAAA-AAAA", pass);
    const malformed = await open("not a code", "not a passphrase");
    const empty = await open("", "");
    const broken = await read(await handleOpen(new Request("http://localhost/api/case/open", { method: "POST", body: "{not json", headers }), deps));
    for (const r of [unknownCode, malformed, empty, broken]) {
      expect(r.status).toBe(wrongPass.status);
      expect(r.body).toEqual(wrongPass.body);
    }
    expect(wrongPass.status).toBe(401);
    expect(wrongPass.body.error).toBeTruthy();
    // And replying with wrong credentials looks the same, whether or not the message is valid.
    const replyWrong = await read(await handleReply(formRequest("/api/case/reply", { caseCode: code, passphrase: "AAAAA-AAAAA-AAAAA-AAAAA", message: "hello" }), deps));
    const replyUnknown = await read(await handleReply(formRequest("/api/case/reply", { caseCode: "SV-AAAA-AAAA-AAAA", passphrase: pass, message: "" }), deps));
    expect(replyWrong.status).toBe(401);
    expect(replyUnknown.status).toBe(401);
    expect(replyUnknown.body).toEqual(replyWrong.body);
    expect(replyWrong.body).toEqual(wrongPass.body);
  });

  it("the reporter can reply with a file and sees the thread", async () => {
    const { code, pass } = await submit();
    const sent = await read(await handleReply(formRequest("/api/case/reply", { caseCode: code, passphrase: pass, message: "One more thing: it happened again." }, [{ name: "proof.jpg", bytes: await jpegWithExif(), type: "image/jpeg" }]), deps));
    expect(sent.status).toBe(200);
    expect(sent.body.case!.messages).toHaveLength(1);
    expect(sent.body.case!.messages[0]).toMatchObject({ author: "reporter", body: "One more thing: it happened again.", attachments: 1 });
    expect(sent.body.case!.messages[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("validates the form and refuses disguised, too many or oversized files, with nothing saved", async () => {
    const before = await rows<{ n: number }>(sql`select count(*)::int as n from ops.safevoice_reports`);
    const bad = async (fields: Record<string, string>, files: Parameters<typeof formRequest>[2] = [], extra: Record<string, string> = {}) => (await read(await handleSubmit(formRequest("/api/report", fields, files, extra), deps))).status;
    expect(await bad({ category: "made-up", description: "A long enough description." })).toBe(400);
    expect(await bad({ category: "other", description: "short" })).toBe(400);
    expect(await bad({ category: "other", description: "x".repeat(8001) })).toBe(400);
    const fake = { name: "invoice.pdf", bytes: new TextEncoder().encode("MZ this is a program"), type: "application/pdf" };
    expect(await bad({ category: "other", description: "A long enough description." }, [fake])).toBe(400);
    const jpeg = { name: "a.jpg", bytes: await jpegWithExif(), type: "image/jpeg" };
    expect(await bad({ category: "other", description: "A long enough description." }, [jpeg, jpeg, jpeg, jpeg])).toBe(400);
    expect(await bad({ category: "other", description: "A long enough description." }, [], { "content-length": "9999999" })).toBe(413);
    const after = await rows<{ n: number }>(sql`select count(*)::int as n from ops.safevoice_reports`);
    expect(after[0].n).toBe(before[0].n);
  });

  it("the hidden field catches robots: they get a believable answer and nothing is saved", async () => {
    const before = await rows<{ n: number }>(sql`select count(*)::int as n from ops.safevoice_reports`);
    const r = await read(await handleSubmit(formRequest("/api/report", { category: "other", description: "Buy cheap watches now now now", website: "http://spam.example" }), deps));
    expect(r.status).toBe(200);
    expect(r.body.caseCode).toMatch(/^SV-/);
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from ops.safevoice_reports`))[0].n).toBe(before[0].n);
  });

  it("control characters are removed from stored text", async () => {
    const { code, pass } = await submit("Line one\u0000\u0007 and\nline two\u001b are fine.");
    void code;
    void pass;
    const [r] = await admin`select description from ops.safevoice_reports where description like 'Line one%'`;
    expect(r.description).toBe("Line one and\nline two are fine.");
  });
});

describe("handlers", () => {
  it("only a designated handler sees cases; Super Admin, HR, Executive and employees do not (no role grants it)", async () => {
    for (const u of [superAdmin, hr, executive, employee]) {
      as(u);
      await expect(queries.listCases({ filter: "all", page: 1, pageSize: 25 })).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(queries.getCase(randomUUID())).rejects.toMatchObject({ name: "ForbiddenError" });
      expect(await actions.closeSafevoiceCase({ caseId: randomUUID(), outcome: "no_action" })).toEqual({ ok: false, error: "You do not have access to do that." });
    }
    as(handler);
    const list = await queries.listCases({ filter: "all", page: 1, pageSize: 25 });
    expect(list.info.total).toBeGreaterThan(3);
  });

  it("the list is paged, filtered, and shows no codes or times", async () => {
    as(handler);
    const page = await queries.listCases({ filter: "all", page: 1, pageSize: 10 });
    expect(page.rows.length).toBeLessThanOrEqual(10);
    expect(Object.keys(page.rows[0]).sort()).toEqual(["category", "createdDay", "id", "lastActivityDay", "messageCount", "needsReply", "outcome", "status"]);
    const closed = await queries.listCases({ filter: "closed", page: 1, pageSize: 10 });
    expect(closed.rows.every((r) => r.status === "closed")).toBe(true);
  });

  it("full handling: read, reply, status, close with an outcome, reporter sees it; audit never holds report text", async () => {
    const secretText = "UNIQUE-REPORT-TEXT-about-the-night-supervisor";
    const { code, pass } = await submit(`${secretText} kept threatening staff.`, "retaliation", [{ name: "x.jpg", bytes: await jpegWithExif(), type: "image/jpeg" }]);
    const [{ id }] = await admin`select id from ops.safevoice_reports where description like ${secretText + "%"}`;

    as(handler);
    const detail = await queries.getCase(id);
    expect(detail).toMatchObject({ id, category: "retaliation", status: "new", outcome: null });
    expect(detail!.description).toContain(secretText);
    expect(detail!.attachments).toHaveLength(1);
    expect(JSON.stringify(detail)).not.toContain(code);
    const file = await queries.getAttachment(detail!.attachments[0].id);
    expect(file!.contentType).toBe("image/jpeg");
    expect((await sharp(file!.data).metadata()).exif).toBeUndefined();

    // reply, expecting an answer
    expect(await actions.replyToSafevoiceCase({ caseId: id, body: "Thank you. Can you tell us which shift this was?", expectReply: true })).toEqual({ ok: true, data: undefined });
    let seen = await open(code, pass);
    expect(seen.body.case).toMatchObject({ status: "awaiting_reporter" });
    expect(seen.body.case!.messages.at(-1)).toMatchObject({ author: "handler", body: "Thank you. Can you tell us which shift this was?" });

    // the reporter answers; the case is waiting on a handler again
    await handleReply(formRequest("/api/case/reply", { caseCode: code, passphrase: pass, message: "The late shift." }), deps);
    const list = await queries.listCases({ filter: "awaiting_reporter", page: 1, pageSize: 100 });
    expect(list.rows.find((r) => r.id === id)).toMatchObject({ needsReply: true });

    // status change and close
    expect(await actions.setSafevoiceCaseStatus({ caseId: id, status: "in_review" })).toEqual({ ok: true, data: undefined });
    expect((await open(code, pass)).body.case!.status).toBe("in_review");
    expect(await actions.closeSafevoiceCase({ caseId: id, outcome: "substantiated", message: "We have acted on this. Thank you for speaking up." })).toEqual({ ok: true, data: undefined });
    seen = await open(code, pass);
    expect(seen.body.case).toMatchObject({ status: "closed", outcome: "substantiated" });
    expect(seen.body.case!.messages.at(-1)!.body).toBe("We have acted on this. Thank you for speaking up.");

    // a closed case takes no more reporter messages, and no more handler replies until reopened
    const late = await read(await handleReply(formRequest("/api/case/reply", { caseCode: code, passphrase: pass, message: "One more" }), deps));
    expect(late.status).toBe(409);
    expect(await actions.replyToSafevoiceCase({ caseId: id, body: "Hello?", expectReply: false })).toMatchObject({ ok: false, error: "This case is closed. Reopen it before replying." });
    expect(await actions.closeSafevoiceCase({ caseId: id, outcome: "no_action" })).toMatchObject({ ok: false, error: "This case is already closed." });
    expect(await actions.setSafevoiceCaseStatus({ caseId: id, status: "in_review" })).toEqual({ ok: true, data: undefined });
    const reopened = await open(code, pass);
    expect(reopened.body.case).toMatchObject({ status: "in_review", outcome: null });

    // audit: who did what to which case, never any text; the day only is stored for the case itself
    const audit = await rows<{ action: string; actor_user_id: string; target_id: string; before: unknown; after: unknown; metadata: unknown }>(
      sql`select action, actor_user_id, target_id, before, after, metadata from ops.audit_log where target_type = 'safevoice_case' and target_id = ${id} order by id`,
    );
    expect(audit.map((a) => a.action)).toEqual(["safevoice.case_view", "safevoice.reply", "safevoice.status", "safevoice.close", "safevoice.reopen"]);
    expect(audit.every((a) => a.actor_user_id === handler.id)).toBe(true);
    const auditText = JSON.stringify(audit);
    for (const secret of [secretText, "late shift", "Thank you", "kept threatening", "We have acted", code, pass]) expect(auditText).not.toContain(secret);
    const [attachmentAudit] = await rows<{ n: number }>(sql`select count(*)::int as n from ops.audit_log where action = 'safevoice.attachment_view' and target_id = ${id}`);
    expect(attachmentAudit.n).toBe(0); // the route audits the download; the query itself does not (see the route)
  });

  it("refuses bad input and unknown cases", async () => {
    as(handler);
    expect(await actions.replyToSafevoiceCase({ caseId: randomUUID(), body: "hello", expectReply: true })).toEqual({ ok: false, error: "That case was not found." });
    expect(await actions.replyToSafevoiceCase({ caseId: randomUUID(), body: "   ", expectReply: true })).toMatchObject({ ok: false });
    expect(await queries.getCase(randomUUID())).toBeNull();
    expect(await queries.getCase("not-a-uuid")).toBeNull();
  });
});

describe("counts only", () => {
  it("hides any category with fewer than 5 reports, and the Executive sees the same counts and nothing else", async () => {
    // Start from a known state for two categories: client_conduct gets exactly 2, discrimination exactly 5.
    for (let i = 0; i < 2; i++) await submit(`Counting report ${i} about a client's behaviour.`, "client_conduct");
    for (let i = 0; i < 5; i++) await submit(`Counting report ${i} about discrimination.`, "discrimination");
    const total = (c: string) => admin`select count(*)::int as n from ops.safevoice_reports where category = ${c}`.then((r) => r[0].n as number);
    const smallN = await total("client_conduct");
    const bigN = await total("discrimination");
    expect(smallN).toBeLessThan(5);
    expect(bigN).toBeGreaterThanOrEqual(5);

    as(executive);
    const stats = await queries.getStats();
    expect(stats.rows.find((r) => r.category === "discrimination")?.count).toBe(bigN);
    expect(stats.rows.find((r) => r.category === "client_conduct")).toBeUndefined();
    expect(stats.someHidden).toBe(true);
    for (const r of stats.rows) expect(r.count).toBeGreaterThanOrEqual(5);
    // the Executive can read no case
    await expect(queries.listCases({ filter: "all", page: 1, pageSize: 25 })).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(queries.getCase(randomUUID())).rejects.toMatchObject({ name: "ForbiddenError" });

    as(handler);
    expect(await queries.getStats()).toEqual(stats);
    as(employee);
    await expect(queries.getStats()).rejects.toMatchObject({ name: "ForbiddenError" });
    as(superAdmin);
    await expect(queries.getStats()).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

describe("handler notifications", () => {
  it("tells every designated handler once, with counts and a link and no content, then marks everything told", async () => {
    await admin`update ops.safevoice_reports set handler_notified = true`;
    await admin`update ops.safevoice_messages set handler_notified = true where author = 'reporter'`;
    const { code, pass } = await submit("Notification test report that must never be quoted.", "other");
    await handleReply(formRequest("/api/case/reply", { caseCode: code, passphrase: pass, message: "Notification test reply that must never be quoted." }), deps);

    const first = await jobs.runSafevoiceNotify();
    expect(first).toMatchObject({ newReports: 1, newReplies: 1 });
    expect(first.told).toBeGreaterThanOrEqual(2);
    const notes = await rows<{ user_id: string; kind: string; title: string; body: string; link: string }>(sql`select user_id, kind, title, body, link from ops.notifications where kind = 'safevoice.activity' and user_id in (${handler.id}, ${handler2.id})`);
    expect(new Set(notes.map((n) => n.user_id))).toEqual(new Set([handler.id, handler2.id]));
    for (const n of notes) {
      expect(n.link).toBe("/safe-voice-cases");
      expect(`${n.title} ${n.body}`).toContain("1 new report and 1 new reply");
      expect(`${n.title} ${n.body}`).not.toMatch(/quoted|Notification test|other/i);
    }
    // Not told: Super Admin, Executive, plain HR
    const others = await rows<{ n: number }>(sql`select count(*)::int as n from ops.notifications where kind = 'safevoice.activity' and user_id in (${superAdmin.id}, ${executive.id}, ${hr.id})`);
    expect(others[0].n).toBe(0);
    expect(await jobs.runSafevoiceNotify()).toEqual({ newReports: 0, newReplies: 0, told: 0 });
  });

  it("with nobody designated, warns the Super Admins once a day and keeps the reports unmarked for later", async () => {
    await admin`update ops.safevoice_reports set handler_notified = true`;
    await admin`update ops.safevoice_messages set handler_notified = true where author = 'reporter'`;
    await admin`update core.users set is_safevoice_handler = false where id in (${handler.id}, ${handler2.id})`;
    try {
      await submit("A report while nobody is designated.", "other");
      const first = await jobs.runSafevoiceNotify();
      expect(first.newReports).toBe(1);
      expect(first.told).toBeGreaterThanOrEqual(1);
      const warn = await rows<{ user_id: string; title: string; body: string }>(sql`select user_id, title, body from ops.notifications where kind = 'safevoice.no_handlers' and user_id = ${superAdmin.id}`);
      expect(warn).toHaveLength(1);
      expect(warn[0].body).not.toMatch(/A report while/);
      const again = await jobs.runSafevoiceNotify();
      expect(again.told).toBe(0); // not repeated within a day
      expect((await admin`select count(*)::int as n from ops.safevoice_reports where not handler_notified`)[0].n).toBe(1); // still waiting for a handler
    } finally {
      await admin`update core.users set is_safevoice_handler = true where id in (${handler.id}, ${handler2.id})`;
    }
  });
});
