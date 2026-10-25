import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, EXE_BYTES, PDF_BYTES } from "./fake-storage";

// Real-database tests for documents that go straight to storage (request, the browser's direct upload, finalize with the real type
// judged from the stored bytes), their signed download, and the retry of storage removals that failed.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/announcements/actions");
const uploadActions = await import("@/modules/announcements/upload-actions");
const content = await import("@/modules/announcements/content-files");
const { setDocumentStorage, BUCKETS } = await import("@/modules/documents/storage");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const fake = new FakeStorage();
setDocumentStorage(fake);

let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
async function person(label: string) {
  const user = await makeUser(label, ["employee"]);
  const n = uniq(label);
  await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${label}, ${n}, ${n + "@example.com"}, 'active', ${user.id})`);
  return user;
}

const request = { fileName: "Rules.pdf", mimeType: "application/pdf", sizeBytes: 5_000_000 };

/** Requests a ticket and plays the browser's part: sends bytes to exactly the path it was issued for. */
async function upload(bytes: Uint8Array | null, over: Partial<typeof request> = {}) {
  const ticket = await uploadActions.requestAnnouncementFileUpload({ ...request, ...over });
  if (!ticket.ok) return { ticket, done: null };
  if (bytes) fake.put(ticket.data.bucket, ticket.data.path, bytes);
  return { ticket, done: await uploadActions.finalizeAnnouncementFileUpload({ id: ticket.data.id }) };
}
const queued = async (path: string) => (await rows(sql`select 1 from docs.storage_deletions where path = ${path}`)).length;

describe("documents sent straight to storage", () => {
  it("lets HR upload, bind and download a PDF through a signed link; only the addressed people can open it", async () => {
    const hr = await makeUser("hr", ["hr_admin"]);
    const reader = await person("Reader");
    as(hr);

    const { ticket, done } = await upload(PDF_BYTES);
    if (!ticket.ok || !done?.ok) throw new Error(`setup: ${JSON.stringify({ ticket, done })}`);
    expect(ticket.data.bucket).toBe(BUCKETS.company);
    expect(ticket.data.path).toMatch(/^content\/.+\.pdf$/);
    expect(done.data).toMatchObject({ kind: "file", fileName: "Rules.pdf", sizeBytes: PDF_BYTES.length });

    // Pending: only its author can open it
    expect(await content.openContentFile(reader as never, done.data.id)).toBeNull();
    const own = await content.openContentFile(hr as never, done.data.id);
    expect(own?.kind).toBe("file");
    expect(own && "downloadUrl" in own ? own.downloadUrl : "").toContain(ticket.data.path);

    const created = await actions.createAnnouncement({ title: uniq("Rules "), body: "Read the file.", audience: "all", requiresAck: false, attachmentIds: [done.data.id] });
    expect(created.ok).toBe(true);
    const opened = await content.openContentFile(reader as never, done.data.id);
    expect(opened).toMatchObject({ kind: "file", fileName: "Rules.pdf" });
    expect(opened && "downloadUrl" in opened ? opened.downloadUrl : "").toContain(`name=${encodeURIComponent("Rules.pdf")}`);

    const [{ n }] = await rows<{ n: number }>(sql`select count(*)::int as n from ops.audit_log where action = 'content.file_add' and target_id = ${done.data.id}`);
    expect(n).toBe(1);
  });

  it("refuses non-HR roles, wrong types, oversize, a missing upload and a file that is not a document", async () => {
    const worker = await person("Worker");
    as(worker);
    expect((await uploadActions.requestAnnouncementFileUpload(request)).ok).toBe(false);

    const hr = await makeUser("hr", ["hr_admin"]);
    as(hr);
    expect((await uploadActions.requestAnnouncementFileUpload({ ...request, mimeType: "application/zip" })).ok).toBe(false);
    expect((await uploadActions.requestAnnouncementFileUpload({ ...request, sizeBytes: 11 * 1024 * 1024 })).ok).toBe(false);

    // Never sent to storage
    const missing = await upload(null);
    expect(missing.ticket.ok).toBe(true);
    expect(missing.done?.ok).toBe(false);

    // A program renamed to .pdf passes the request but fails the check of its bytes, and is removed
    const { ticket, done } = await upload(EXE_BYTES);
    expect(ticket.ok).toBe(true);
    expect(done?.ok).toBe(false);
    if (ticket.ok) expect(fake.objects.has(fake.key(ticket.data.bucket, ticket.data.path))).toBe(false);
  });

  it("will not save an announcement while a document is still uploading", async () => {
    const hr = await makeUser("hr", ["hr_admin"]);
    as(hr);
    const unfinished = await uploadActions.requestAnnouncementFileUpload(request);
    if (!unfinished.ok) throw new Error("setup");
    const early = await actions.createAnnouncement({ title: uniq("Early "), body: "x", audience: "all", requiresAck: false, attachmentIds: [unfinished.data.id] });
    expect(early.ok).toBe(false);
  });
});

describe("storage removals that fail are retried", () => {
  it("keeps a queue entry when storage fails, and removes the file on the next clean-up", async () => {
    const hr = await makeUser("hr", ["hr_admin"]);
    as(hr);
    const { ticket, done } = await upload(PDF_BYTES);
    if (!ticket.ok || !done?.ok) throw new Error("setup");
    const created = await actions.createAnnouncement({ title: uniq("Retry "), body: "Read the file.", audience: "all", requiresAck: false, attachmentIds: [done.data.id] });
    if (!created.ok) throw new Error("setup");
    const key = fake.key(ticket.data.bucket, ticket.data.path);

    // Take the file off the announcement while storage is down: the row goes, the stored file stays, and a retry entry is kept
    fake.failRemovals = 1;
    const edited = await actions.updateAnnouncement({ announcementId: created.data.id, title: uniq("Retry "), body: "Read the file.", pinned: false, attachmentIds: [] });
    expect(edited.ok).toBe(true);
    expect(fake.objects.has(key)).toBe(true);
    expect(await queued(ticket.data.path)).toBe(1);

    const result = await content.retryStorageDeletions();
    expect(result.retried).toBeGreaterThanOrEqual(1);
    expect(fake.objects.has(key)).toBe(false);
    expect(await queued(ticket.data.path)).toBe(0);
  });

  it("drops the queue entry without deleting a file that is in use again", async () => {
    const hr = await makeUser("hr", ["hr_admin"]);
    as(hr);
    const { ticket, done } = await upload(PDF_BYTES);
    if (!ticket.ok || !done?.ok) throw new Error("setup");
    const created = await actions.createAnnouncement({ title: uniq("Shared "), body: "Read the file.", audience: "all", requiresAck: false, attachmentIds: [done.data.id] });
    if (!created.ok) throw new Error("setup");

    await db.transaction(async (tx) => content.queueStorageDeletion(tx, [ticket.data.path]));
    await content.retryStorageDeletions();
    expect(fake.objects.has(fake.key(ticket.data.bucket, ticket.data.path))).toBe(true);
    expect(await queued(ticket.data.path)).toBe(0);
  });
});
