import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "./global-setup";

// The course studio against the real database, on its OWN test course (so the shared HIPAA and Cybersecurity rows are untouched):
// a draft is a copy that keeps each question's lineage, edits need the current stamp and leave the course valid, a published version
// is frozen, publishing needs someone other than the last editor and a change, and a diff finds what moved.

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const admin = postgres(testDatabaseUrl(process.env.TEST_DB_ADMIN_URL!), { max: 2, onnotice: () => {} });
const { db } = await import("@/lib/db");
const { loadCourse } = await import("@/modules/learn/publish");
const svc = await import("@/modules/learn/studio-service");
const { COURSES } = await import("../../../learn/src/content");

afterAll(async () => {
  await admin.end();
});

const slug = `studio-test-${Date.now().toString(36)}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const tx = <T>(fn: Parameters<typeof db.transaction>[0] extends (t: infer X) => unknown ? (t: X) => Promise<T> : never) => db.transaction(fn as never) as Promise<T>;

let editor: string;
let publisher: string;
let reviewer: string;
let draftId: string;
let stamp: number;

async function makeUser(label: string) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${`${label}${Date.now().toString(36)}@example.com`})`);
  return id;
}

beforeAll(async () => {
  editor = await makeUser("editor");
  publisher = await makeUser("publisher");
  reviewer = await makeUser("reviewer");
  const src = COURSES.cybersecurity;
  await loadCourse(admin, {
    course: { slug, content: structuredClone(src.content), questions: structuredClone(src.questions), examConfig: src.examConfig },
    publish: true,
    reviewerUserId: reviewer,
    counselApprovedOn: "2026-10-01",
    actorUserId: reviewer,
  });
});

describe("drafts", () => {
  it("copies the live version with each question's lineage, rebuilds the modules and marks the course as studio-managed", async () => {
    const made = await tx((t) => svc.createDraft(t, { courseSlug: slug, note: "Wording pass", actorId: editor }));
    draftId = made.versionId;
    expect(made.version).toBe(2);
    const [c] = await rows<{ studio_managed: boolean }>(sql`select studio_managed from learn.courses where slug = ${slug}`);
    expect(c.studio_managed).toBe(true);
    const v1 = await rows<{ lineage: string }>(sql`select q.lineage from learn.questions q join learn.course_versions v on v.id = q.version_id join learn.courses c on c.id = v.course_id where c.slug = ${slug} and v.version = 1`);
    const v2 = await rows<{ lineage: string }>(sql`select lineage from learn.questions where version_id = ${draftId}`);
    expect(v2.length).toBe(v1.length);
    expect(new Set(v2.map((r) => r.lineage))).toEqual(new Set(v1.map((r) => r.lineage)));
    const mods = await rows(sql`select 1 from learn.version_modules where version_id = ${draftId}`);
    expect(mods.length).toBe(COURSES.cybersecurity.content.modules.length);
    // only one draft at a time
    await expect(tx((t) => svc.createDraft(t, { courseSlug: slug, note: "Another", actorId: editor }))).rejects.toThrow(/already a draft/);
    const [v] = await rows<{ edit_stamp: number }>(sql`select edit_stamp from learn.course_versions where id = ${draftId}`);
    stamp = v.edit_stamp;
  });

  it("saves an edit with the right stamp, rebuilds the module row, and refuses a stale stamp", async () => {
    const key = COURSES.cybersecurity.content.modules[0].key;
    stamp = await tx((t) =>
      svc.editContent(t, {
        versionId: draftId,
        stamp,
        actorId: editor,
        change: (c) => {
          const m = c.modules.find((x) => x.key === key)!;
          m.title = "A renamed module";
          m.estimatedMinutes = 7;
          return c;
        },
      }),
    );
    expect(stamp).toBe(1);
    const [m] = await rows<{ title: string; estimated_minutes: number; min_seconds: number }>(sql`select title, estimated_minutes, min_seconds from learn.version_modules where version_id = ${draftId} and module_key = ${key}`);
    expect(m).toMatchObject({ title: "A renamed module", estimated_minutes: 7 });
    expect(m.min_seconds).toBe(Math.round(7 * 60 * 0.4));
    await expect(tx((t) => svc.editContent(t, { versionId: draftId, stamp: 0, actorId: editor, change: (c) => c }))).rejects.toThrow(/saved this draft after you/);
  });

  it("refuses an edit that would leave the course invalid, and saves nothing", async () => {
    const key = COURSES.cybersecurity.content.modules[0].key;
    await expect(
      tx((t) =>
        svc.editContent(t, {
          versionId: draftId,
          stamp,
          actorId: editor,
          change: (c) => {
            const b = c.modules.find((x) => x.key === key)!.screens[0].blocks[0];
            if (b.type === "paragraph") b.text = "Call 555-123-4567 to confirm your details now.";
            return c;
          },
        }),
      ),
    ).rejects.toThrow(/phone number/);
    const [v] = await rows<{ edit_stamp: number }>(sql`select edit_stamp from learn.course_versions where id = ${draftId}`);
    expect(v.edit_stamp).toBe(stamp);
  });

  it("edits one question (key included), and refuses a duplicate wording", async () => {
    const qs = await rows<{ id: string; stem: string; options: { id: string; text: string }[]; correct_ids: string[]; rationale: string; topic: string }>(
      sql`select id, stem, options, correct_ids, rationale, topic from learn.questions where version_id = ${draftId} order by created_at, id limit 2`,
    );
    const [a, b] = qs;
    const patch = { topic: a.topic, stem: `${a.stem} (reworded)`, options: a.options, correctIds: a.correct_ids, rationale: a.rationale };
    stamp = await tx((t) => svc.editQuestion(t, { versionId: draftId, questionId: a.id, stamp, actorId: editor, patch }));
    expect(stamp).toBe(2);
    await expect(tx((t) => svc.editQuestion(t, { versionId: draftId, questionId: b.id, stamp, actorId: editor, patch: { topic: b.topic, stem: patch.stem, options: b.options, correctIds: b.correct_ids, rationale: b.rationale } }))).rejects.toThrow(/same wording/);
  });

  it("freezes a published version at the database", async () => {
    await expect(admin`update learn.course_versions set content = '{}'::jsonb where course_id = (select id from learn.courses where slug = ${slug}) and version = 1`).rejects.toThrow(/frozen/);
  });
});

describe("diff, publish and the code publish command", () => {
  it("shows what changed against the live version", async () => {
    const live = (await tx((t) => svc.loadVersion(t, slug, 1)))!;
    const draft = (await tx((t) => svc.loadVersion(t, slug, 2)))!;
    const d = svc.diffLoaded(live, draft);
    expect(d.unchanged).toBe(false);
    expect(d.modules.changed[0].changes.join(" ")).toContain("A renamed module");
    expect(d.questions.changed.length).toBe(1);
    expect(d.questions.changed[0].what).toContain("wording");
    expect(d.questions.added).toEqual([]);
  });

  it("will not let the last editor publish, then lets someone else, retiring the old version", async () => {
    await expect(tx((t) => svc.publishDraft(t, { versionId: draftId, actorId: editor, reviewerUserId: reviewer, counselApprovedOn: "2026-10-13", material: false }))).rejects.toThrow(/Someone else/);
    const r = await tx((t) => svc.publishDraft(t, { versionId: draftId, actorId: publisher, reviewerUserId: reviewer, counselApprovedOn: "2026-10-13", material: true }));
    expect(r.version).toBe(2);
    const vs = await rows<{ version: number; status: string; counsel: string | null; reviewed_by: string | null; material: boolean }>(
      sql`select v.version, v.status, v.counsel_approved_on::text as counsel, v.reviewed_by, v.material from learn.course_versions v join learn.courses c on c.id = v.course_id where c.slug = ${slug} order by v.version`,
    );
    expect(vs.map((v) => [v.version, v.status])).toEqual([[1, "retired"], [2, "published"]]);
    expect(vs[1]).toMatchObject({ counsel: "2026-10-13", reviewed_by: reviewer, material: true });
    // the published version is frozen now
    await expect(tx((t) => svc.editContent(t, { versionId: draftId, stamp: 3, actorId: editor, change: (c) => c }))).rejects.toThrow(/Only a draft/);
  });

  it("will not publish a draft that changes nothing", async () => {
    const made = await tx((t) => svc.createDraft(t, { courseSlug: slug, note: "No change", actorId: editor }));
    await expect(tx((t) => svc.publishDraft(t, { versionId: made.versionId, actorId: publisher, reviewerUserId: reviewer, counselApprovedOn: "2026-10-14", material: false }))).rejects.toThrow(/Nothing has changed/);
    // and a draft can be discarded
    await tx((t) => svc.discardDraft(t, { versionId: made.versionId, stamp: 0 }));
    expect((await rows(sql`select 1 from learn.course_versions where id = ${made.versionId}`)).length).toBe(0);
  });

  it("makes the code publish command refuse a studio-managed course", async () => {
    const [existing] = await rows<{ studio_managed: boolean }>(sql`select studio_managed from learn.courses where slug = 'hipaa'`);
    if (!existing) return; // the shared course has not been loaded in this database
    await db.execute(sql`update learn.courses set studio_managed = true where slug = 'hipaa'`);
    try {
      await expect(loadCourse(admin, { courseSlug: "hipaa" })).rejects.toThrow(/course studio/);
    } finally {
      await db.execute(sql`update learn.courses set studio_managed = ${existing.studio_managed} where slug = 'hipaa'`);
    }
  });
});
