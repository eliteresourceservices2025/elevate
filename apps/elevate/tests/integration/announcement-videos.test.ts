import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, MP4_BYTES, PDF_BYTES } from "./fake-storage";

// Real-database tests for announcement videos: request, the browser's direct upload, finalize (type judged by the first bytes,
// size), binding to an announcement, who may play it, and the clean-up of uploads nobody saved.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/announcements/actions");
const videoActions = await import("@/modules/announcements/video-actions");
const content = await import("@/modules/announcements/content-files");
const { setDocumentStorage, BUCKETS } = await import("@/modules/documents/storage");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const fake = new FakeStorage();
setDocumentStorage(fake);

let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
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

const request = { fileName: "Welcome.mp4", mimeType: "video/mp4", sizeBytes: 5_000_000 };

/** Requests a ticket and plays the browser's part: sends bytes to exactly the path it was issued for. */
async function upload(bytes: Uint8Array, over: Partial<typeof request> = {}) {
  const ticket = await videoActions.requestAnnouncementVideoUpload({ ...request, ...over });
  if (!ticket.ok) return { ticket, done: null };
  fake.put(ticket.data.bucket, ticket.data.path, bytes);
  return { ticket, done: await videoActions.finalizeAnnouncementVideoUpload({ id: ticket.data.id }) };
}

describe("announcement videos", () => {
  it("lets HR upload, bind and play a video; only the addressed people can play it", async () => {
    const hr = await makeUser("hr", ["hr_admin"]);
    const reader = await person("Reader");
    as(hr);

    const { ticket, done } = await upload(MP4_BYTES);
    expect(ticket.ok && done?.ok).toBe(true);
    if (!ticket.ok || !done?.ok) return;
    expect(ticket.data.bucket).toBe(BUCKETS.videos);
    expect(ticket.data.path).toMatch(/^videos\/.+\.mp4$/);
    expect(done.data.kind).toBe("video");

    // Pending: only its author can open it
    as(reader);
    expect(await content.openContentFile(reader as never, done.data.id)).toBeNull();
    as(hr);
    expect((await content.openContentFile(hr as never, done.data.id))?.kind).toBe("video");

    const created = await actions.createAnnouncement({ title: uniq("Video "), body: "Please watch.", audience: "all", requiresAck: false, attachmentIds: [done.data.id] });
    expect(created.ok).toBe(true);

    const opened = await content.openContentFile(reader as never, done.data.id);
    expect(opened?.kind).toBe("video");
    expect(opened && "playbackUrl" in opened ? opened.playbackUrl : "").toContain(ticket.data.path);

    const [{ n }] = (await db.execute(sql`select count(*)::int as n from ops.audit_log where action = 'content.video_add' and target_id = ${done.data.id}`)) as unknown as { n: number }[];
    expect(n).toBe(1);
  });

  it("refuses non-HR roles, wrong types, oversize and a file that is not a video", async () => {
    const worker = await person("Worker");
    as(worker);
    const denied = await videoActions.requestAnnouncementVideoUpload(request);
    expect(denied.ok).toBe(false);

    const hr = await makeUser("hr", ["hr_admin"]);
    as(hr);
    expect((await videoActions.requestAnnouncementVideoUpload({ ...request, mimeType: "video/quicktime" })).ok).toBe(false);
    expect((await videoActions.requestAnnouncementVideoUpload({ ...request, sizeBytes: 101 * 1024 * 1024 })).ok).toBe(false);

    // A PDF renamed to .mp4 passes the request but fails the check of its bytes, and is removed
    const { ticket, done } = await upload(PDF_BYTES);
    expect(ticket.ok).toBe(true);
    expect(done?.ok).toBe(false);
    if (ticket.ok) expect(fake.objects.has(fake.key(ticket.data.bucket, ticket.data.path))).toBe(false);
  });

  it("allows one video per announcement and none on a file that was never finalized", async () => {
    const hr = await makeUser("hr", ["hr_admin"]);
    as(hr);
    const a = await upload(MP4_BYTES);
    const b = await upload(MP4_BYTES);
    if (!a.done?.ok || !b.done?.ok) throw new Error("setup");
    const two = await actions.createAnnouncement({ title: uniq("Two "), body: "x", audience: "all", requiresAck: false, attachmentIds: [a.done.data.id, b.done.data.id] });
    expect(two.ok).toBe(false);

    const unfinished = await videoActions.requestAnnouncementVideoUpload(request);
    if (!unfinished.ok) throw new Error("setup");
    const early = await actions.createAnnouncement({ title: uniq("Early "), body: "x", audience: "all", requiresAck: false, attachmentIds: [unfinished.data.id] });
    expect(early.ok).toBe(false);
  });

  it("removes an upload nobody saved, and its stored file, after a day", async () => {
    const hr = await makeUser("hr", ["hr_admin"]);
    as(hr);
    const { ticket, done } = await upload(MP4_BYTES);
    if (!ticket.ok || !done?.ok) throw new Error("setup");
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const result = await content.purgeOrphanContentFiles(later);
    expect(result.removed).toBeGreaterThanOrEqual(1);
    expect(fake.objects.has(fake.key(ticket.data.bucket, ticket.data.path))).toBe(false);
  });
});
