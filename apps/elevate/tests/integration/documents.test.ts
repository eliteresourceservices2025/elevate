import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { EXE_BYTES, FakeStorage, PDF_BYTES, PNG_BYTES } from "./fake-storage";

// Real-database tests for the document vault (Phase 1.3), with storage replaced by an in-memory fake.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const docs = await import("@/modules/documents/actions");
const docQueries = await import("@/modules/documents/queries");
const jobs = await import("@/modules/documents/jobs");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const notifActions = await import("@/modules/notifications/actions");
const notifQueries = await import("@/modules/notifications/queries");
const { todayInZone } = await import("@/modules/org/service");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const fake = new FakeStorage();
const NO_ACCESS = "You do not have access to do that.";

let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = todayInZone();

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

async function makeEmployee(label: string, opts: { userId?: string; status?: string; sortFirst?: boolean } = {}) {
  const n = (opts.sortFirst ? "0" : "") + uniq(label);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values (${label}, ${n}, ${n + "@example.com"}, ${opts.status ?? "active"}, ${opts.userId ?? null}) returning id`);
  return e.id;
}

const typeId = async (slug: string) => (await rows<{ id: string }>(sql`select id from docs.document_types where slug = ${slug}`))[0].id;

type UploadArgs = {
  actor: TestUser;
  slug?: string;
  employeeId?: string; // omit for company
  bytes?: Uint8Array;
  mime?: string;
  expiresOn?: string;
  clientId?: string;
  folderId?: string;
  audience?: "all_staff" | "hr_only";
  send?: boolean;
  acknowledged?: boolean;
};

/** Runs the real three steps: request, browser upload (fake), finalize. */
async function upload(a: UploadArgs) {
  as(a.actor);
  const bytes = a.bytes ?? PDF_BYTES;
  const company = a.employeeId === undefined;
  const ticket = await docs.requestUpload({
    target: company ? "company" : "employee",
    employeeId: a.employeeId,
    typeId: await typeId(a.slug ?? (company ? "company_policy" : "contract")),
    title: uniq("Doc "),
    clientId: a.clientId,
    folderId: a.folderId,
    expiresOn: a.expiresOn,
    audience: a.audience ?? "all_staff",
    fileName: "../../my file.pdf",
    mimeType: a.mime ?? "application/pdf",
    sizeBytes: bytes.length,
    acknowledged: a.acknowledged ?? true,
  });
  if (!ticket.ok) return { ticket, finalize: null as null };
  if (a.send !== false) fake.put(ticket.data.bucket, ticket.data.path, bytes);
  const finalize = await docs.finalizeUpload({ documentId: ticket.data.documentId });
  return { ticket, finalize };
}

let hr: TestUser;
let hr2: TestUser;
let lead: TestUser;

beforeAll(async () => {
  setDocumentStorage(fake);
  hr = await makeUser("hr", ["employee", "hr_admin"]);
  hr2 = await makeUser("hr2", ["employee", "hr_admin"]);
  lead = await makeUser("lead", ["employee", "team_lead"]);
});

/** sortFirst: the overview lists are ordered by last name and capped, so a test that looks for its own person among them must sort ahead of everyone other test files create. */
async function person(label = "Person", roles: RoleSlug[] = ["employee"], opts: { sortFirst?: boolean } = {}) {
  const user = await makeUser(label, roles);
  const id = await makeEmployee(label, { userId: user.id, sortFirst: opts.sortFirst });
  return { user, id };
}

describe("upload and checks", () => {
  it("HR uploads for a person: checked, fingerprinted, verified, audited, name cleaned", async () => {
    const p = await person();
    const r = await upload({ actor: hr, employeeId: p.id });
    expect(r.finalize).toEqual({ ok: true, data: undefined });

    const [d] = await rows<Record<string, unknown>>(sql`select * from docs.documents where id = ${r.ticket.ok ? r.ticket.data.documentId : ""}`);
    expect(d).toMatchObject({ status: "active", mime_type: "application/pdf", size_bytes: String(PDF_BYTES.length), verified_by: hr.id, original_name: "my file.pdf" });
    expect(d.sha256).toBe(createHash("sha256").update(PDF_BYTES).digest("hex"));
    const storagePath = String(d.storage_path);
    expect(storagePath.startsWith(`${p.id}/`)).toBe(true); // server-chosen path, not the file name
    expect(/^[0-9a-f-]{36}\.pdf$/.test(storagePath.slice(p.id.length + 1))).toBe(true);
    const audit = await rows<{ action: string }>(sql`select action from ops.audit_log where metadata->>'documentId' = ${String(d.id)} order by id`);
    expect(audit.map((a) => a.action)).toEqual(["document.upload_requested", "document.upload"]);
  });

  it("refuses a file that is not what it claims: wrong type, disguised program, empty, missing", async () => {
    const p = await person();

    const mismatch = await upload({ actor: hr, employeeId: p.id, bytes: PNG_BYTES, mime: "application/pdf" });
    expect(mismatch.finalize).toMatchObject({ ok: false, error: expect.stringMatching(/does not match/) });

    const exe = await upload({ actor: hr, employeeId: p.id, bytes: EXE_BYTES, mime: "application/pdf" });
    expect(exe.finalize).toMatchObject({ ok: false, error: expect.stringMatching(/not a PDF, JPG, PNG, WEBP, DOC or DOCX/) });

    // both attempts were discarded: no row, no stored object
    for (const r of [mismatch, exe]) {
      const id = r.ticket.ok ? r.ticket.data.documentId : "";
      expect(await rows(sql`select 1 from docs.documents where id = ${id}`)).toHaveLength(0);
      expect(fake.removed.some((k) => k.includes(id))).toBe(true);
    }
    expect(await rows(sql`select 1 from ops.audit_log where action = 'document.upload_rejected' and target_id = ${p.id}`)).toHaveLength(2);
  });

  it("a missing file can be retried; nobody else can finish someone's upload", async () => {
    const p = await person();
    const first = await upload({ actor: hr, employeeId: p.id, send: false });
    expect(first.finalize).toMatchObject({ ok: false, error: expect.stringMatching(/did not receive/) });
    if (!first.ticket.ok) throw new Error("ticket");
    const { documentId, bucket, path } = first.ticket.data;

    as(hr2);
    expect(await docs.finalizeUpload({ documentId })).toEqual({ ok: false, error: "That upload was not found." });

    as(hr);
    fake.put(bucket, path, PDF_BYTES);
    expect(await docs.finalizeUpload({ documentId })).toEqual({ ok: true, data: undefined });
    expect(await docs.finalizeUpload({ documentId })).toEqual({ ok: false, error: "That upload was not found." }); // already done
  });

  it("validates before issuing a link: type rules, expiry, acknowledgement, file type and size", async () => {
    const p = await person();
    const base = { actor: hr, employeeId: p.id, send: false };

    expect((await upload({ ...base, slug: "nbi_clearance" })).ticket).toMatchObject({ ok: false, error: expect.stringMatching(/expiry date/) });
    expect((await upload({ ...base, slug: "nbi_clearance", expiresOn: addDays(today, -1) })).ticket).toMatchObject({ ok: false, error: expect.stringMatching(/already passed/) });
    expect((await upload({ ...base, acknowledged: false })).ticket).toMatchObject({ ok: false, error: expect.stringMatching(/no client or patient information/) });
    expect((await upload({ ...base, mime: "text/html" })).ticket).toMatchObject({ ok: false, error: expect.stringMatching(/Only PDF, JPG, PNG, WEBP, DOC or DOCX/) });
    expect((await upload({ ...base, slug: "company_policy" })).ticket).toMatchObject({ ok: false, error: "Choose a document type." }); // company type on a person
    expect((await upload({ ...base, slug: "nbi_clearance", expiresOn: addDays(today, 200) })).ticket.ok).toBe(true);

    as(hr);
    const big = await docs.requestUpload({ target: "employee", employeeId: p.id, typeId: await typeId("contract"), title: "Big", fileName: "big.pdf", mimeType: "application/pdf", sizeBytes: 11 * 1024 * 1024, acknowledged: true });
    expect(big).toMatchObject({ ok: false, error: expect.stringMatching(/10 MB/) });
  });

  it("limits unfinished uploads per person", async () => {
    const p = await person();
    const uploader = await makeUser("limit", ["employee", "hr_admin"]);
    for (let i = 0; i < 5; i++) expect((await upload({ actor: uploader, employeeId: p.id, send: false })).ticket.ok).toBe(true);
    expect((await upload({ actor: uploader, employeeId: p.id, send: false })).ticket).toMatchObject({ ok: false, error: expect.stringMatching(/unfinished uploads/) });
  });

  it("a client-linked document only offers the person's own clients (HR may pick any)", async () => {
    const p = await person();
    const [mine] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Mine ")}) returning id`);
    const [other] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Other ")}) returning id`);
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${p.id}, ${mine.id}, '2026-01-01')`);

    expect((await upload({ actor: p.user, employeeId: p.id, slug: "client_confidentiality", send: false })).ticket).toMatchObject({ ok: false, error: expect.stringMatching(/Choose the client/) });
    expect((await upload({ actor: p.user, employeeId: p.id, slug: "client_confidentiality", clientId: other.id, send: false })).ticket).toMatchObject({ ok: false, error: expect.stringMatching(/Choose one of your clients/) });
    expect((await upload({ actor: p.user, employeeId: p.id, slug: "client_confidentiality", clientId: mine.id })).finalize?.ok).toBe(true);
    expect((await upload({ actor: hr, employeeId: p.id, slug: "client_confidentiality", clientId: other.id })).finalize?.ok).toBe(true);

    as(p.user);
    const options = await docQueries.getUploadOptions("employee", p.id);
    expect(options.clients.map((c) => c.id)).toEqual([mine.id]);
  });
});

describe("who can do what", () => {
  it("a person uploads their own (unverified) and downloads it; others and leads cannot", async () => {
    const a = await person("A");
    const b = await person("B");
    const r = await upload({ actor: a.user, employeeId: a.id });
    expect(r.finalize?.ok).toBe(true);
    const id = r.ticket.ok ? r.ticket.data.documentId : "";
    const [d] = await rows<{ verified_at: string | null }>(sql`select verified_at from docs.documents where id = ${id}`);
    expect(d.verified_at).toBeNull();

    as(a.user);
    const url = await docs.getDownloadUrl({ documentId: id });
    expect(url.ok && url.data.url).toMatch(/^fake:\/\/employee-docs\/.+expires=60&name=my%20file\.pdf$/); // 60 seconds, saved as a download
    for (const who of [b.user, lead]) {
      as(who);
      expect(await docs.getDownloadUrl({ documentId: id })).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(hr);
    expect((await docs.getDownloadUrl({ documentId: id })).ok).toBe(true);

    // a person cannot upload for someone else
    expect((await upload({ actor: b.user, employeeId: a.id, send: false })).ticket).toEqual({ ok: false, error: NO_ACCESS });
    // every download is audited, with the document id but no file path
    const audit = await rows<{ metadata: Record<string, string> }>(sql`select metadata from ops.audit_log where action = 'document.download' and target_id = ${a.id}`);
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toContain(".pdf");
  });

  it("HR verifies; nobody verifies on their own record; a verified file can only be removed by HR", async () => {
    const a = await person("Ver", ["employee", "hr_admin"]); // HR with their own record
    const mine = await upload({ actor: a.user, employeeId: a.id });
    const id = mine.ticket.ok ? mine.ticket.data.documentId : "";
    const [auto] = await rows<{ verified_at: string | null }>(sql`select verified_at from docs.documents where id = ${id}`);
    expect(auto.verified_at).toBeNull(); // HR does not auto-verify their own record's documents

    as(a.user);
    expect(await docs.verifyDocument({ documentId: id, verified: true })).toEqual({ ok: false, error: "Another admin must verify documents on your own record." });
    as(hr);
    expect((await docs.verifyDocument({ documentId: id, verified: true })).ok).toBe(true);

    const employee = await person("Emp");
    const emp = await upload({ actor: employee.user, employeeId: employee.id });
    const empDoc = emp.ticket.ok ? emp.ticket.data.documentId : "";
    as(hr);
    await docs.verifyDocument({ documentId: empDoc, verified: true });
    as(employee.user);
    expect(await docs.archiveDocument({ documentId: empDoc })).toEqual({ ok: false, error: "HR has verified this document, so only HR can remove it." });
    as(hr);
    expect((await docs.archiveDocument({ documentId: empDoc })).ok).toBe(true);
  });

  it("a person can archive their own unverified file: hidden from them, kept for HR, file not deleted", async () => {
    const p = await person("Arch");
    const r = await upload({ actor: p.user, employeeId: p.id });
    const id = r.ticket.ok ? r.ticket.data.documentId : "";
    as(p.user);
    expect((await docs.archiveDocument({ documentId: id })).ok).toBe(true);

    expect((await docQueries.listEmployeeDocuments(p.id)).map((d) => d.id)).not.toContain(id);
    as(hr);
    const asHr = await docQueries.listEmployeeDocuments(p.id);
    expect(asHr.find((d) => d.id === id)?.archived).toBe(true);
    expect(fake.removed.some((k) => k.includes(id))).toBe(false); // the file is kept until retention is decided
    as(p.user);
    expect(await docs.getDownloadUrl({ documentId: id })).toEqual({ ok: false, error: "That document was not found." });
  });

  it("company documents: all staff read 'all staff' ones, 'HR only' stays hidden, only HR adds", async () => {
    const staff = await person("Staff");
    const open = await upload({ actor: hr, audience: "all_staff" });
    const closed = await upload({ actor: hr, audience: "hr_only" });
    const openId = open.ticket.ok ? open.ticket.data.documentId : "";
    const closedId = closed.ticket.ok ? closed.ticket.data.documentId : "";

    as(staff.user);
    const seen = (await docQueries.listCompanyDocuments()).map((d) => d.id);
    expect(seen).toContain(openId);
    expect(seen).not.toContain(closedId);
    expect((await docs.getDownloadUrl({ documentId: openId })).ok).toBe(true);
    expect(await docs.getDownloadUrl({ documentId: closedId })).toEqual({ ok: false, error: NO_ACCESS });
    expect((await upload({ actor: staff.user, send: false })).ticket).toEqual({ ok: false, error: NO_ACCESS });

    as(hr);
    expect((await docQueries.listCompanyDocuments()).map((d) => d.id)).toEqual(expect.arrayContaining([openId, closedId]));
    expect((await docs.getDownloadUrl({ documentId: closedId })).ok).toBe(true);
  });
});

describe("HR overview", () => {
  it("lists expiring and expired documents, and who is missing required ones", async () => {
    const p = await person("Over", ["employee"], { sortFirst: true });
    const soon = await upload({ actor: hr, employeeId: p.id, slug: "hipaa_training", expiresOn: addDays(today, 10) });
    const soonId = soon.ticket.ok ? soon.ticket.data.documentId : "";
    // the app refuses past dates, so an already-expired document is set up directly
    const expired = await upload({ actor: hr, employeeId: p.id, slug: "nbi_clearance", expiresOn: addDays(today, 200) });
    const expiredId = expired.ticket.ok ? expired.ticket.data.documentId : "";
    await db.execute(sql`update docs.documents set expires_on = ${addDays(today, -3)}::date where id = ${expiredId}`);

    as(hr);
    let overview = await docQueries.getDocumentOverview();
    const mineAttention = overview.attention.filter((r) => r.employeeId === p.id);
    expect(mineAttention.map((r) => [r.id, r.expiry]).sort()).toEqual([[expiredId, "expired"], [soonId, "expiring"]].sort());
    expect(mineAttention.find((r) => r.id === expiredId)?.daysLeft).toBe(-3);

    const missing = overview.missing.filter((m) => m.employeeId === p.id).map((m) => `${m.typeName}:${m.reason}`).sort();
    expect(missing).toEqual(["Government ID:none", "NBI clearance:expired"]); // required types with no valid copy

    // a valid copy clears it
    await upload({ actor: hr, employeeId: p.id, slug: "nbi_clearance", expiresOn: addDays(today, 365) });
    as(hr);
    overview = await docQueries.getDocumentOverview();
    expect(overview.missing.filter((m) => m.employeeId === p.id).map((m) => m.typeName)).toEqual(["Government ID"]);

    // the person's own unverified upload is on the "to verify" list
    const self = await upload({ actor: p.user, employeeId: p.id, slug: "government_id", expiresOn: addDays(today, 400) });
    as(hr);
    overview = await docQueries.getDocumentOverview();
    expect(overview.unverified.some((u) => u.documentId === (self.ticket.ok ? self.ticket.data.documentId : ""))).toBe(true);
  });

  it("people who left are not chased for documents", async () => {
    const gone = await makeEmployee("Gone", { status: "separated" });
    as(hr);
    const overview = await docQueries.getDocumentOverview();
    expect(overview.missing.some((m) => m.employeeId === gone)).toBe(false);
  });
});

describe("expiry reminders", () => {
  async function docFor(employeeId: string, expiresOn: string) {
    const r = await upload({ actor: hr, employeeId, slug: "hipaa_training", expiresOn: addDays(today, 365) });
    const id = r.ticket.ok ? r.ticket.data.documentId : "";
    await db.execute(sql`update docs.documents set expires_on = ${expiresOn}::date where id = ${id}`);
    return id;
  }
  const countFor = async (userId: string, kind = "document.expiring") =>
    (await rows<{ n: number }>(sql`select count(*)::int as n from ops.notifications where user_id = ${userId} and kind = ${kind}`))[0].n;

  it("sends 30, then 7, then expiry-day reminders once each, and tells HR with one summary", async () => {
    const p = await person("Rem");
    await docFor(p.id, addDays(today, 30));
    const hrBefore = await countFor(hr.id, "document.expiring_summary");

    const first = await jobs.runExpiryReminders(today);
    expect(first.employeeNotices).toBeGreaterThanOrEqual(1);
    expect(await countFor(p.user.id)).toBe(1);
    expect(await countFor(hr.id, "document.expiring_summary")).toBe(hrBefore + 1); // one summary, not one per document

    await jobs.runExpiryReminders(today); // same day again
    expect(await countFor(p.user.id)).toBe(1);

    await jobs.runExpiryReminders(addDays(today, 23)); // 7 days left
    expect(await countFor(p.user.id)).toBe(2);
    await jobs.runExpiryReminders(addDays(today, 24)); // nothing new
    expect(await countFor(p.user.id)).toBe(2);

    await jobs.runExpiryReminders(addDays(today, 30)); // the day itself
    expect(await countFor(p.user.id)).toBe(3);
    const titles = await rows<{ title: string }>(sql`select title from ops.notifications where user_id = ${p.user.id} order by created_at`);
    expect(titles.map((t) => t.title)).toEqual([
      "Your HIPAA training certificate expires in 30 days",
      "Your HIPAA training certificate expires in 7 days",
      "Your HIPAA training certificate expires today",
    ]);
    const [n] = await rows<{ link: string }>(sql`select link from ops.notifications where user_id = ${p.user.id} limit 1`);
    expect(n.link).toBe(`/people/${p.id}?tab=documents`);
  });

  it("a document already inside the 7-day window gets only the 7-day message", async () => {
    const p = await person("Late");
    const id = await docFor(p.id, addDays(today, 5));
    await jobs.runExpiryReminders(today);
    expect(await countFor(p.user.id)).toBe(1);
    const thresholds = await rows<{ days_before: number }>(sql`select days_before from docs.document_reminders where document_id = ${id} order by days_before desc`);
    expect(thresholds.map((t) => t.days_before)).toEqual([30, 7]); // the earlier one is recorded, not sent
    const [n] = await rows<{ title: string }>(sql`select title from ops.notifications where user_id = ${p.user.id}`);
    expect(n.title).toContain("expires in 5 days");
  });

  it("two runs at the same moment send one reminder", async () => {
    const p = await person("Race");
    await docFor(p.id, addDays(today, 20));
    await Promise.all([jobs.runExpiryReminders(today), jobs.runExpiryReminders(today)]);
    expect(await countFor(p.user.id)).toBe(1);
  });

  it("skips archived documents and people who left", async () => {
    const archived = await person("Arc");
    const docId = await docFor(archived.id, addDays(today, 10));
    await db.execute(sql`update docs.documents set archived_at = now() where id = ${docId}`);
    const left = await person("Left");
    await docFor(left.id, addDays(today, 10));
    await db.execute(sql`update core.employees set status = 'separated' where id = ${left.id}`);

    await jobs.runExpiryReminders(today);
    expect(await countFor(archived.user.id)).toBe(0);
    expect(await countFor(left.user.id)).toBe(0);
  });
});

describe("cleanup of unfinished uploads", () => {
  it("removes pending uploads older than 24 hours with their files, and leaves recent ones", async () => {
    const p = await person("Clean");
    const stale = await upload({ actor: hr, employeeId: p.id, send: true, bytes: PDF_BYTES });
    const staleFinal = stale.ticket.ok ? stale.ticket.data : null;
    // turn a finished upload into a stale pending one for the test
    await db.execute(sql`update docs.documents set status = 'pending', created_at = now() - interval '25 hours' where id = ${staleFinal!.documentId}`);
    const recent = await upload({ actor: hr, employeeId: p.id, send: false });
    const recentId = recent.ticket.ok ? recent.ticket.data.documentId : "";

    const result = await jobs.cleanupPendingUploads();
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(await rows(sql`select 1 from docs.documents where id = ${staleFinal!.documentId}`)).toHaveLength(0);
    expect(fake.objects.has(fake.key(staleFinal!.bucket, staleFinal!.path))).toBe(false);
    expect(await rows(sql`select 1 from docs.documents where id = ${recentId}`)).toHaveLength(1);
  });
});

describe("notifications", () => {
  it("everyone sees only their own and can only clear their own", async () => {
    const a = await person("NotifA");
    const b = await person("NotifB");
    await db.execute(sql`insert into ops.notifications (user_id, kind, title, link) values (${a.user.id}, 'test', 'For A', '/documents'), (${b.user.id}, 'test', 'For B', null)`);

    as(a.user);
    expect((await notifQueries.listMyNotifications()).map((n) => n.title)).toEqual(["For A"]);
    expect(await notifQueries.countMyUnread()).toBe(1);

    const [bn] = await rows<{ id: string }>(sql`select id from ops.notifications where user_id = ${b.user.id}`);
    await notifActions.markNotificationRead({ id: bn.id }); // A tries to clear B's
    expect((await rows<{ read_at: string | null }>(sql`select read_at from ops.notifications where id = ${bn.id}`))[0].read_at).toBeNull();

    await notifActions.markAllNotificationsRead();
    expect(await notifQueries.countMyUnread()).toBe(0);
    as(b.user);
    expect(await notifQueries.countMyUnread()).toBe(1);
  });
});

describe("folders", () => {
  const docId = (r: Awaited<ReturnType<typeof upload>>) => (r.ticket.ok ? r.ticket.data.documentId : "");
  const folderOf = async (id: string) => (await rows<{ folder_id: string | null }>(sql`select folder_id from docs.documents where id = ${id}`))[0].folder_id;

  it("a person makes their own folders, HR can too, nobody else can, and names are checked", async () => {
    const p = await person("FolderOwner");
    const stranger = await person("FolderStranger");
    as(p.user);
    const made = await docs.createFolder({ employeeId: p.id, name: "  Contracts " });
    expect(made.ok).toBe(true);
    expect(await docs.createFolder({ employeeId: p.id, name: "contracts" })).toEqual({ ok: false, error: "There is already a folder with that name." });
    expect((await docs.createFolder({ employeeId: p.id, name: "   " })).ok).toBe(false);
    expect((await docs.createFolder({ employeeId: p.id, name: "x".repeat(61) })).ok).toBe(false);
    as(hr);
    expect((await docs.createFolder({ employeeId: p.id, name: "IDs" })).ok).toBe(true);
    for (const outsider of [stranger.user, lead]) {
      as(outsider);
      expect(await docs.createFolder({ employeeId: p.id, name: "Mine now" })).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(p.user);
    expect((await docQueries.listEmployeeFolders(p.id)).map((f) => f.name)).toEqual(["Contracts", "IDs"]);
    as(stranger.user);
    await expect(docQueries.listEmployeeFolders(p.id)).rejects.toThrow();
    // The audit entry names the folder by id only
    const audit = await rows<{ metadata: Record<string, string> }>(sql`select metadata from ops.audit_log where action = 'document.folder_create' and target_id = ${p.id}`);
    expect(audit.length).toBe(2);
    expect(JSON.stringify(audit.map((a) => a.metadata))).not.toContain("Contracts");
  });

  it("limits a person to 30 folders", async () => {
    const p = await person("FolderLimit");
    as(hr);
    for (let i = 0; i < 30; i++) expect((await docs.createFolder({ employeeId: p.id, name: `Folder ${i}` })).ok).toBe(true);
    expect(await docs.createFolder({ employeeId: p.id, name: "One too many" })).toEqual({ ok: false, error: "A person can have 30 folders at most." });
  });

  it("uploads into a folder, moves between folders, and only within the same person", async () => {
    const p = await person("Mover");
    const other = await person("OtherOwner");
    as(p.user);
    const a = await docs.createFolder({ employeeId: p.id, name: "A" });
    const b = await docs.createFolder({ employeeId: p.id, name: "B" });
    as(other.user);
    const foreign = await docs.createFolder({ employeeId: other.id, name: "Foreign" });
    if (!a.ok || !b.ok || !foreign.ok) throw new Error("setup");

    const filed = await upload({ actor: p.user, employeeId: p.id, folderId: a.data.id });
    expect(filed.finalize).toEqual({ ok: true, data: undefined });
    expect(await folderOf(docId(filed))).toBe(a.data.id);
    // A folder of someone else cannot be chosen at upload
    expect((await upload({ actor: p.user, employeeId: p.id, folderId: foreign.data.id })).ticket).toMatchObject({ ok: false, error: "Choose one of this person's folders." });

    as(p.user);
    expect((await docs.moveDocument({ documentId: docId(filed), folderId: b.data.id })).ok).toBe(true);
    expect(await folderOf(docId(filed))).toBe(b.data.id);
    expect(await docs.moveDocument({ documentId: docId(filed), folderId: foreign.data.id })).toEqual({ ok: false, error: "Choose one of this person's folders." });
    expect((await docs.moveDocument({ documentId: docId(filed), folderId: null })).ok).toBe(true);
    expect(await folderOf(docId(filed))).toBeNull();

    as(other.user);
    expect(await docs.moveDocument({ documentId: docId(filed), folderId: foreign.data.id })).toEqual({ ok: false, error: NO_ACCESS });
    as(hr);
    expect((await docs.moveDocument({ documentId: docId(filed), folderId: a.data.id })).ok).toBe(true);

    const listed = await (as(p.user), docQueries.listEmployeeDocuments(p.id));
    expect(listed.find((d) => d.id === docId(filed))?.folderId).toBe(a.data.id);
  });

  it("removing a folder keeps its documents (they go back to no folder) and frees the name", async () => {
    const p = await person("Remover");
    as(p.user);
    const f = await docs.createFolder({ employeeId: p.id, name: "Old" });
    if (!f.ok) throw new Error("setup");
    const filed = await upload({ actor: p.user, employeeId: p.id, folderId: f.data.id });
    as(p.user);
    expect((await docs.archiveFolder({ folderId: f.data.id })).ok).toBe(true);
    expect(await folderOf(docId(filed))).toBeNull();
    expect((await docQueries.listEmployeeFolders(p.id)).length).toBe(0);
    expect((await docs.archiveFolder({ folderId: f.data.id })).ok).toBe(false); // already gone
    expect((await docs.createFolder({ employeeId: p.id, name: "Old" })).ok).toBe(true);
    const [row] = await rows<{ status: string; archived_at: string | null }>(sql`select status, archived_at from docs.documents where id = ${docId(filed)}`);
    expect(row).toMatchObject({ status: "active", archived_at: null });
  });

  it("renaming checks the name and the owner", async () => {
    const p = await person("Renamer");
    const stranger = await person("RenameStranger");
    as(p.user);
    const f = await docs.createFolder({ employeeId: p.id, name: "First" });
    const g = await docs.createFolder({ employeeId: p.id, name: "Second" });
    if (!f.ok || !g.ok) throw new Error("setup");
    expect((await docs.renameFolder({ folderId: f.data.id, name: "Renamed" })).ok).toBe(true);
    expect(await docs.renameFolder({ folderId: f.data.id, name: "second" })).toEqual({ ok: false, error: "There is already a folder with that name." });
    as(stranger.user);
    expect(await docs.renameFolder({ folderId: f.data.id, name: "Hijacked" })).toEqual({ ok: false, error: NO_ACCESS });
  });
});
