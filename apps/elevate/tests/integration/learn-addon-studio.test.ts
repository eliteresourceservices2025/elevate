import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Creating a client add-on from the studio (client add-ons, step 2): the first draft, one add-on per client, names that look like web
// addresses, placeholder text blocking publication, and publishing by a second person making it a live course in the catalog.

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const svc = await import("@/modules/learn/studio-service");
const { listLearnCourses } = await import("@/modules/learn/course-catalog");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const tx = <T>(fn: Parameters<typeof db.transaction>[0] extends (t: infer X) => unknown ? (t: X) => Promise<T> : never) => db.transaction(fn as never) as Promise<T>;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function makeUser(label: string) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${`${uniq(label)}@example.com`})`);
  return id;
}
async function makeClient(name: string) {
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${name}) returning id`);
  return c.id;
}

/** Replaces every "TO WRITE:" text with real, unique wording (what an editor does by hand). */
function writeEverything<T>(value: T, counter = { n: 0 }): T {
  if (typeof value === "string") return (value.includes("TO WRITE:") ? `Written content for the client requirements, item number ${++counter.n}` : value) as T;
  if (Array.isArray(value)) return value.map((v) => writeEverything(v, counter)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, writeEverything(v, counter)])) as T;
  return value;
}

describe("client add-on from the studio", () => {
  it("creates the course and a first draft with one module, five questions and a short exam", async () => {
    const editor = await makeUser("addon-editor");
    const name = uniq("Northwind Clinic ");
    const clientId = await makeClient(name);
    const made = await tx((t) => svc.createClientAddon(t, { clientId, actorId: editor }));

    expect(made.slug).toMatch(/^northwind-clinic-[a-z0-9-]+-requirements$/);
    const [course] = await rows<{ kind: string; client_id: string; studio_managed: boolean; fixed_track: string; label: string }>(sql`select kind, client_id::text, studio_managed, fixed_track, label from learn.courses where slug = ${made.slug}`);
    expect(course).toMatchObject({ kind: "client_addon", client_id: clientId, studio_managed: true, fixed_track: "full" });
    expect(course.label).toContain("requirements");

    const [v] = await rows<{ status: string; version: number; exam_config: { passPercent: number; tracks: { full: { questions: number } } } }>(sql`select status, version, exam_config from learn.course_versions where id = ${made.versionId}`);
    expect(v).toMatchObject({ status: "draft", version: 1 });
    expect(v.exam_config.passPercent).toBe(80);
    expect(v.exam_config.tracks.full.questions).toBe(5);
    expect((await rows(sql`select 1 from learn.version_modules where version_id = ${made.versionId}`)).length).toBe(1);
    expect((await rows(sql`select 1 from learn.questions where version_id = ${made.versionId}`)).length).toBe(5);

    expect((await listLearnCourses(db)).find((c) => c.slug === made.slug)).toMatchObject({ kind: "client_addon", clientId });
  });

  it("allows one add-on per client and refuses an archived or unknown client", async () => {
    const editor = await makeUser("addon-editor");
    const clientId = await makeClient(uniq("One Only "));
    await tx((t) => svc.createClientAddon(t, { clientId, actorId: editor }));
    await expect(tx((t) => svc.createClientAddon(t, { clientId, actorId: editor }))).rejects.toThrow(/already has an add-on/);
    await expect(tx((t) => svc.createClientAddon(t, { clientId: randomUUID(), actorId: editor }))).rejects.toThrow(/not found/);
    const gone = await makeClient(uniq("Gone "));
    await db.execute(sql`update core.clients set archived_at = now() where id = ${gone}`);
    await expect(tx((t) => svc.createClientAddon(t, { clientId: gone, actorId: editor }))).rejects.toThrow(/not found/);
  });

  it("keeps a client name that looks like a web address out of the lessons", async () => {
    const editor = await makeUser("addon-editor");
    const clientId = await makeClient(uniq("shop") + ".com Health");
    const made = await tx((t) => svc.createClientAddon(t, { clientId, actorId: editor }));
    const [v] = await rows<{ content: { title: string; modules: { title: string }[]; attestation: { text: string } } }>(sql`select content from learn.course_versions where id = ${made.versionId}`);
    expect(v.content.modules[0].title).toBe("Working with this client");
    expect(v.content.attestation.text).not.toMatch(/\.com/);
    expect(v.content.title).toContain(".com");
  });

  it("gives two clients whose names make the same address different addresses", async () => {
    const editor = await makeUser("addon-editor");
    const u = uniq("twin");
    const c1 = await makeClient(`${u} Co`);
    const c2 = await makeClient(`${u}-Co`);
    const one = await tx((t) => svc.createClientAddon(t, { clientId: c1, actorId: editor }));
    const two = await tx((t) => svc.createClientAddon(t, { clientId: c2, actorId: editor }));
    expect(one.slug).not.toBe(two.slug);
  });

  it("cannot be published while text is unfinished, then goes live when someone else publishes it", async () => {
    const editor = await makeUser("addon-editor");
    const publisher = await makeUser("addon-publisher");
    const reviewer = await makeUser("addon-reviewer");
    const clientId = await makeClient(uniq("Publish Me "));
    const made = await tx((t) => svc.createClientAddon(t, { clientId, actorId: editor }));

    await expect(tx((t) => svc.publishDraft(t, { versionId: made.versionId, actorId: publisher, reviewerUserId: reviewer, counselApprovedOn: "2026-10-15", material: false }))).rejects.toThrow(/TO WRITE/);

    await tx((t) =>
      svc.editDraft(t, {
        versionId: made.versionId,
        stamp: 0,
        actorId: editor,
        apply: (s) => ({ ...s, content: writeEverything(s.content), questions: writeEverything(s.questions) }),
      }),
    );
    // the editor cannot publish their own last save
    await expect(tx((t) => svc.publishDraft(t, { versionId: made.versionId, actorId: editor, reviewerUserId: reviewer, counselApprovedOn: "2026-10-15", material: false }))).rejects.toThrow(/Someone else/);
    const out = await tx((t) => svc.publishDraft(t, { versionId: made.versionId, actorId: publisher, reviewerUserId: reviewer, counselApprovedOn: "2026-10-15", material: false }));
    expect(out.version).toBe(1);
    const [v] = await rows<{ status: string; reviewed_by: string }>(sql`select status, reviewed_by::text from learn.course_versions where id = ${made.versionId}`);
    expect(v).toMatchObject({ status: "published", reviewed_by: reviewer });
  });
});
