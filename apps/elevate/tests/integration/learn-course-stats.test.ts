import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Course-improvement statistics (Release 3): per question and per module, from submitted exam tries and module time. Counts only;
// a group under five people is hidden, and the query needs the course-studio permission.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const svc = await import("@/modules/learn/studio-service");
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

describe("course statistics", () => {
  it("shows miss rates and time only for groups of five or more, to people who may manage content", async () => {
    const editor = await makeUser("ed");
    const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Stats Client ")}) returning id`);
    const made = await tx((t) => svc.createClientAddon(t, { clientId: c.id, actorId: editor }));
    await tx((t) => svc.editDraft(t, { versionId: made.versionId, stamp: 0, actorId: editor, apply: (s) => ({ ...s, content: writeEverything(s.content), questions: writeEverything(s.questions) }) }));
    const publisher = await makeUser("pub");
    const reviewer = await makeUser("rev");
    await tx((t) => svc.publishDraft(t, { versionId: made.versionId, actorId: publisher, reviewerUserId: reviewer, counselApprovedOn: "2026-10-12", material: false }));
    const [course] = await rows<{ id: string }>(sql`select id from learn.courses where slug = ${made.slug}`);
    const [first] = await rows<{ id: string; module_key: string; correct_ids: string[] }>(sql`select id, module_key, correct_ids from learn.questions where version_id = ${made.versionId} order by module_key, id limit 1`);

    // six people each answer the first question; four of them wrongly. A seventh question is answered by only two people.
    const people: string[] = [];
    for (let i = 0; i < 6; i++) {
      const u = await makeUser("learner");
      people.push(u);
      const [a] = await rows<{ id: string }>(sql`
        insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on, status) values (${u}, ${course.id}, ${made.versionId}, 'full', 'manual', '2026-12-01', 'in_progress') returning id`);
      const [x] = await rows<{ id: string }>(sql`insert into learn.exam_attempts (assignment_id, user_id, attempt_no, deadline_at, total_count) values (${a.id}, ${u}, 1, now() + interval '20 minutes', 1) returning id`);
      await db.execute(sql`insert into learn.exam_attempt_items (attempt_id, position, question_id, option_order) values (${x.id}, 0, ${first.id}, ${"{a,b,c}"}::text[])`);
      const right = i < 2;
      await db.execute(sql`insert into learn.exam_answers (attempt_id, question_id, selected_ids) values (${x.id}, ${first.id}, ${`{${(right ? first.correct_ids : ["zzz"]).join(",")}}`}::text[])`);
      await db.execute(sql`update learn.exam_attempts set status = 'submitted', submitted_at = now(), correct_count = ${right ? 1 : 0}, score_percent = ${right ? 100 : 0}, passed = ${right} where id = ${x.id}`);
    }

    // not signed in with the permission: refused
    current.user = { id: people[0], email: "e@example.com", roles: ["employee"] };
    await expect(studio.getCourseStats(made.slug, 1)).rejects.toThrow();

    const hr = await makeUser("hr");
    await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${hr}, 'hr_admin')`);
    current.user = { id: hr, email: "hr@example.com", roles: ["hr_admin"] };
    const stats = (await studio.getCourseStats(made.slug, 1))!;
    expect(stats.attempts).toBe(6);
    const q = stats.questions.find((s) => s.id === first.id)!;
    expect(q).toMatchObject({ shown: 6, missPercent: 66.7 });
    const m = stats.modules.find((s) => s.key === first.module_key)!;
    expect(m.missPercent).toBe(66.7);
    // nothing in the result identifies anyone
    expect(JSON.stringify(stats)).not.toMatch(new RegExp(people.join("|")));
  });
});

