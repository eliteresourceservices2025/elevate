import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, EXE_BYTES, PDF_BYTES } from "./fake-storage";

// Real-database tests for pictures and files on announcements and policies: upload and cleaning, binding when saved, who may open
// them, the frozen files of a published policy version, and the clean-up of files nobody saved.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/announcements/actions");
const queries = await import("@/modules/announcements/queries");
const content = await import("@/modules/announcements/content-files");
const { setDocumentStorage } = await import("@/modules/documents/storage");

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
async function person(label: string, teamId?: string) {
  const user = await makeUser(label, ["employee"]);
  const n = uniq(label);
  await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, team_id) values (${label}, ${n}, ${n + "@example.com"}, 'active', ${user.id}, ${teamId ?? null})`);
  return user;
}
async function makeTeam() {
  const [d] = await rows<{ id: string }>(sql`insert into core.departments (name) values (${uniq("Dept ")}) returning id`);
  const [t] = await rows<{ id: string }>(sql`insert into core.teams (department_id, name) values (${d.id}, ${uniq("Team ")}) returning id`);
  return t.id;
}

const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
const SECRET = "GPS-secret-location";
const jpeg = (size = 300) =>
  new Uint8Array([0xff, 0xd8, ...seg(0xe1, [...Buffer.from(`Exif\0\0${SECRET}`)]), ...seg(0xdb, [0, ...new Array<number>(64).fill(8)]), ...seg(0xc0, [8, size >> 8, size & 0xff, size >> 8, size & 0xff, 1, 1, 0x11, 0]), ...seg(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0x34, 0xff, 0xd9]);
const DOCX = (() => {
  const head = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  const body = new TextEncoder().encode("[Content_Types].xml word/document.xml");
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
})();

let hr: TestUser;
beforeAll(async () => {
  hr = await makeUser("cfhr", ["hr_admin", "employee"]);
});

const upload = async (actor: TestUser, kind: "image" | "file", bytes: Uint8Array, fileName: string) => {
  const result = await content.uploadContentFile(actor as never, { kind, bytes, fileName });
  if (!result.ok) throw new Error(result.error);
  return result.file;
};
const pathOf = async (id: string) => (await rows<{ storage_path: string }>(sql`select storage_path from docs.content_files where id = ${id}`))[0]?.storage_path;

describe("uploading", () => {
  it("cleans a picture (no camera or location data), checks a document by its bytes, and refuses the rest", async () => {
    const photo = await upload(hr, "image", jpeg(), "../../team photo.jpg");
    expect(photo).toMatchObject({ kind: "image", fileName: "team photo.jpg" });
    const stored = await fake.read("company-docs", (await pathOf(photo.id))!);
    expect(Buffer.from(stored!).includes(Buffer.from(SECRET))).toBe(false);

    const pdf = await upload(hr, "file", PDF_BYTES, "Handbook.pdf");
    expect(pdf).toMatchObject({ kind: "file", fileName: "Handbook.pdf" });
    expect(await upload(hr, "file", DOCX, "memo.docx")).toMatchObject({ kind: "file" });

    expect(await content.uploadContentFile(hr as never, { kind: "file", bytes: EXE_BYTES, fileName: "x.pdf" })).toMatchObject({ ok: false });
    expect(await content.uploadContentFile(hr as never, { kind: "image", bytes: PDF_BYTES, fileName: "x.jpg" })).toMatchObject({ ok: false });
    expect(await content.uploadContentFile(hr as never, { kind: "image", bytes: jpeg(20), fileName: "tiny.jpg" })).toMatchObject({ ok: false });

    // Only people who write announcements may upload
    const employee = await makeUser("cfemp", ["employee"]);
    await expect(content.uploadContentFile(employee as never, { kind: "file", bytes: PDF_BYTES, fileName: "x.pdf" })).rejects.toThrow();
  });
});

describe("announcements with pictures and files", () => {
  it("shows them to the people it is for, keeps pending files private to their author, and removes unshared files when taken off", async () => {
    const teamA = await makeTeam();
    const inTeam = await person("cfin", teamA);
    const outside = await person("cfout");
    const photo = await upload(hr, "image", jpeg(), "banner.jpg");
    const doc = await upload(hr, "file", PDF_BYTES, "Schedule.pdf");

    // Pending: only the author opens it
    expect(await content.openContentFile(hr as never, photo.id)).not.toBeNull();
    expect(await content.openContentFile(inTeam as never, photo.id)).toBeNull();

    as(hr);
    const body = `Welcome!\n\n![The team](file:${photo.id})\n`;
    const created = await actions.createAnnouncement({ title: uniq("Notice "), body, audience: "teams", teamIds: [teamA], requiresAck: false, attachmentIds: [photo.id, doc.id] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.id;

    // Bound now: the addressed team opens them, an outsider does not, HR does
    expect((await content.openContentFile(inTeam as never, photo.id))?.kind).toBe("image");
    expect((await content.openContentFile(inTeam as never, doc.id))?.fileName).toBe("Schedule.pdf");
    expect(await content.openContentFile(outside as never, photo.id)).toBeNull();
    expect(await content.openContentFile(hr as never, doc.id)).not.toBeNull();

    // The detail lists the files for the reader
    as(inTeam);
    const detail = await queries.getAnnouncement(id);
    expect(detail?.files.map((f) => f.fileName).sort()).toEqual(["Schedule.pdf", "banner.jpg"]);

    // A picture the text no longer points at is dropped on save, and a removed document goes with its stored file
    as(hr);
    const photoPath = (await pathOf(photo.id))!;
    const docPath = (await pathOf(doc.id))!;
    const updated = await actions.updateAnnouncement({ announcementId: id, title: uniq("Notice "), body: "Welcome!", pinned: false, attachmentIds: [photo.id] });
    expect(updated.ok).toBe(true);
    expect(await pathOf(photo.id)).toBeUndefined(); // not in the text: dropped
    expect(await pathOf(doc.id)).toBeUndefined(); // not attached: removed
    expect(await fake.read("company-docs", photoPath)).toBeNull();
    expect(await fake.read("company-docs", docPath)).toBeNull();
  });

  it("refuses text that points at a picture that does not exist, and someone else's pending file", async () => {
    const other = await makeUser("cfhr2", ["hr_admin", "employee"]);
    const theirs = await upload(other, "file", PDF_BYTES, "Theirs.pdf");
    as(hr);
    const missing = await actions.createAnnouncement({ title: uniq("Notice "), body: `![x](file:${randomUUID()})`, audience: "all", teamIds: [], attachmentIds: [] });
    expect(missing.ok).toBe(false);
    const stolen = await actions.createAnnouncement({ title: uniq("Notice "), body: "Hello there", audience: "all", teamIds: [], attachmentIds: [theirs.id] });
    expect(stolen.ok).toBe(false);
  });

  it("does not let pictures or files change once people have acknowledged", async () => {
    const reader = await person("cfack");
    const doc = await upload(hr, "file", PDF_BYTES, "Rules.pdf");
    as(hr);
    const created = await actions.createAnnouncement({ title: uniq("Notice "), body: "Read this.", audience: "all", teamIds: [], requiresAck: true, attachmentIds: [doc.id] });
    if (!created.ok) throw new Error(created.error);
    as(reader);
    expect((await actions.acknowledge({ kind: "announcement", id: created.data.id })).ok).toBe(true);
    as(hr);
    const more = await upload(hr, "file", PDF_BYTES, "More.pdf");
    const changed = await actions.updateAnnouncement({ announcementId: created.data.id, title: "x", body: "Read this.", pinned: false, attachmentIds: [doc.id, more.id] });
    expect(changed).toMatchObject({ ok: false });
  });
});

describe("policies with pictures and files", () => {
  it("keeps a draft's files for HR, freezes them with the published version, and a new draft starts from them", async () => {
    const reader = await person("cfpol");
    const photo = await upload(hr, "image", jpeg(), "diagram.jpg");
    const doc = await upload(hr, "file", PDF_BYTES, "Form.pdf");
    as(hr);
    const created = await actions.createPolicy({ title: uniq("Policy "), body: `Our rule.\n\n![Diagram](file:${photo.id})`, requiresAck: false, attachmentIds: [photo.id, doc.id] });
    if (!created.ok) throw new Error(created.error);
    const policyId = created.data.id;
    const [version] = await rows<{ id: string }>(sql`select id from docs.policy_versions where policy_id = ${policyId} and status = 'draft'`);

    // A draft is HR only
    expect(await content.openContentFile(reader as never, doc.id)).toBeNull();
    expect(await content.openContentFile(hr as never, doc.id)).not.toBeNull();

    // Published: everyone reads it, and its files can no longer change, even with direct database access
    expect((await actions.publishDraft({ policyId })).ok).toBe(true);
    expect(await content.openContentFile(reader as never, doc.id)).not.toBeNull();
    as(reader);
    expect((await queries.getPolicy(policyId))?.current?.files.map((f) => f.fileName).sort()).toEqual(["Form.pdf", "diagram.jpg"]);
    await expect(db.execute(sql`delete from docs.content_files where id = ${doc.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update docs.content_files set file_name = 'x' where id = ${doc.id}`)).rejects.toThrow();
    await expect(db.execute(sql`insert into docs.content_files (owner_id, policy_version_id, kind, file_name, mime_type, size_bytes, sha256, storage_path) values (${hr.id}, ${version.id}, 'file', 'x.pdf', 'application/pdf', 1, 'x', 'content/x.pdf')`)).rejects.toThrow();

    // A new draft starts from the published version's files (a copy sharing the stored file); removing one from the draft keeps the published one
    as(hr);
    const body = `Our rule, updated.\n\n![Diagram](file:${photo.id})`;
    expect((await actions.saveDraft({ policyId, body, changeNote: "Updated", requiresAck: false, attachmentIds: [photo.id, doc.id] })).ok).toBe(true);
    const draftFiles = await rows<{ file_name: string }>(sql`select f.file_name from docs.content_files f join docs.policy_versions v on v.id = f.policy_version_id where v.policy_id = ${policyId} and v.status = 'draft'`);
    expect(draftFiles.map((f) => f.file_name).sort()).toEqual(["Form.pdf", "diagram.jpg"]);
    expect((await actions.saveDraft({ policyId, body, changeNote: "Updated", requiresAck: false, attachmentIds: [photo.id] })).ok).toBe(true);
    expect((await rows(sql`select 1 from docs.content_files f join docs.policy_versions v on v.id = f.policy_version_id where v.policy_id = ${policyId} and v.status = 'draft' and f.kind = 'file'`))).toHaveLength(0);
    const publishedPath = (await pathOf(doc.id))!;
    expect(await fake.read("company-docs", publishedPath)).not.toBeNull(); // still used by the published version

    // Discarding the draft leaves the published files alone
    expect((await actions.discardDraft({ policyId })).ok).toBe(true);
    expect(await fake.read("company-docs", publishedPath)).not.toBeNull();
    expect(await content.openContentFile(reader as never, doc.id)).not.toBeNull();
  });
});

describe("clean-up", () => {
  it("removes pictures and files nobody saved after a day, with their stored files", async () => {
    const stray = await upload(hr, "file", PDF_BYTES, "Forgotten.pdf");
    const path = (await pathOf(stray.id))!;
    await db.execute(sql`update docs.content_files set created_at = now() - interval '2 days' where id = ${stray.id}`);
    const run = await content.purgeOrphanContentFiles();
    expect(run.removed).toBeGreaterThanOrEqual(1);
    expect(await pathOf(stray.id)).toBeUndefined();
    expect(await fake.read("company-docs", path)).toBeNull();
  });
});
