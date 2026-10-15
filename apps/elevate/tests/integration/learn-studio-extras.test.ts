import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Release 3 studio items: changing a question's type or module keeps its place in the version history and is checked by the same
// rules; comments between editors are internal notes on a draft that can be resolved once and never change.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const svc = await import("@/modules/learn/studio-service");
const comments = await import("@/modules/learn/studio-comments");
const studio = await import("@/modules/learn/studio-queries");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const tx = <T>(fn: Parameters<typeof db.transaction>[0] extends (t: infer X) => unknown ? (t: X) => Promise<T> : never) => db.transaction(fn as never) as Promise<T>;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function makeUser(label: string) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${`${uniq(label)}@example.com`})`);
  return id;
}

function writeEverything<T>(value: T, counter = { n: 0 }): T {
  if (typeof value === "string") return (value.includes("TO WRITE:") ? `Written content for the client requirements, item number ${++counter.n}` : value) as T;
  if (Array.isArray(value)) return value.map((v) => writeEverything(v, counter)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, writeEverything(v, counter)])) as T;
  return value;
}

/** A draft (version 1 of a new add-on) with every placeholder filled in, so it passes the checks. */
async function draft() {
  const editor = await makeUser("ed");
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Extras Client ")}) returning id`);
  const made = await tx((t) => svc.createClientAddon(t, { clientId: c.id, actorId: editor }));
  const stamp = await tx((t) => svc.editDraft(t, { versionId: made.versionId, stamp: 0, actorId: editor, apply: (s) => ({ ...s, content: writeEverything(s.content), questions: writeEverything(s.questions) }) }));
  const qs = await rows<{ id: string; module_key: string; type: string; options: { id: string; text: string }[]; correct_ids: string[]; topic: string; stem: string; rationale: string }>(sql`
    select id::text as id, module_key, type, options, correct_ids, topic, stem, rationale from learn.questions where version_id = ${made.versionId} order by id`);
  const mods = await rows<{ module_key: string }>(sql`select module_key from learn.version_modules where version_id = ${made.versionId} order by position`);
  return { editor, versionId: made.versionId, slug: made.slug, version: made.version, stamp, qs, mods: mods.map((m) => m.module_key) };
}

describe("changing a question's type or module", () => {
  it("moves it to another module and changes its type under the same rules, keeping the same row", async () => {
    const d = await draft();
    const q = d.qs.find((x) => x.type === "single")!;
    const patch = { topic: q.topic, stem: q.stem, options: q.options, correctIds: q.correct_ids, rationale: q.rationale };
    const other = d.mods.find((m) => m !== q.module_key);

    // an unknown module is refused
    await expect(tx((t) => svc.editQuestion(t, { versionId: d.versionId, questionId: q.id, stamp: d.stamp, actorId: d.editor, patch: { ...patch, moduleKey: "nope" } }))).rejects.toThrow(/module/i);
    // a true/false type needs True and False as its options
    await expect(tx((t) => svc.editQuestion(t, { versionId: d.versionId, questionId: q.id, stamp: d.stamp, actorId: d.editor, patch: { ...patch, type: "true_false" } }))).rejects.toThrow();

    let stamp = d.stamp;
    if (other) {
      stamp = await tx((t) => svc.editQuestion(t, { versionId: d.versionId, questionId: q.id, stamp, actorId: d.editor, patch: { ...patch, moduleKey: other } }));
      const [moved] = await rows<{ module_key: string; id: string }>(sql`select module_key, id::text as id from learn.questions where id = ${q.id}`);
      expect(moved).toEqual({ module_key: other, id: q.id });
    }
    stamp = await tx((t) =>
      svc.editQuestion(t, {
        versionId: d.versionId,
        questionId: q.id,
        stamp,
        actorId: d.editor,
        patch: {
          ...patch,
          type: "true_false",
          options: [
            { id: "a", text: "True" },
            { id: "b", text: "False" },
          ],
          correctIds: ["a"],
        },
      }),
    );
    const [typed] = await rows<{ type: string }>(sql`select type from learn.questions where id = ${q.id}`);
    expect(typed.type).toBe("true_false");
    // a single-answer type cannot be left with two correct options
    await expect(
      tx((t) => svc.editQuestion(t, { versionId: d.versionId, questionId: q.id, stamp, actorId: d.editor, patch: { ...patch, type: "single", correctIds: ["a", "b"] } })),
    ).rejects.toThrow();
  });
});

describe("comments between editors", () => {
  it("are added to a draft, resolved once, never changed, and read only with the studio permission", async () => {
    const d = await draft();
    const other = await makeUser("other");
    const a = await tx((t) => comments.addComment(t, { versionId: d.versionId, authorId: d.editor, target: "course", body: "Please reword the intro." }));
    const b = await tx((t) => comments.addComment(t, { versionId: d.versionId, authorId: d.editor, target: `module:${d.mods[0]}`, body: "Check the examples in this module." }));
    expect(a.slug).toBe(d.slug);
    await expect(tx((t) => comments.addComment(t, { versionId: d.versionId, authorId: d.editor, target: "module:nope", body: "About nothing." }))).rejects.toThrow(/module/i);

    await tx((t) => comments.resolveComment(t, { commentId: a.id, actorId: other }));
    await expect(tx((t) => comments.resolveComment(t, { commentId: a.id, actorId: other }))).rejects.toThrow(/already/i);
    // the text cannot be changed and nothing is deleted
    await expect(db.execute(sql`update learn.studio_comments set body = 'something else' where id = ${b.id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from learn.studio_comments where id = ${b.id}`)).rejects.toThrow();

    // read as HR: open first, resolved after; refused to anyone without the permission
    const hr = await makeUser("hr");
    await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${hr}, 'hr_admin')`);
    current.user = { id: hr, email: "hr@example.com", roles: ["hr_admin"] };
    const list = await studio.getStudioComments(d.slug, d.version);
    expect(list.map((c) => [c.id, c.resolved])).toEqual([
      [b.id, false],
      [a.id, true],
    ]);
    current.user = { id: d.editor, email: "e@example.com", roles: ["employee"] };
    await expect(studio.getStudioComments(d.slug, d.version)).rejects.toThrow();
  });
});
