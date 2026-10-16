import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// A new hire in onboarding who was invited and has not signed in has no account, so training cannot be assigned to them yet. HR can
// still queue it (the list shows "Queued"); once their record is linked to an account the nightly run turns it into a real assignment.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const svc = await import("@/modules/learn/studio-service");
const jobs = await import("@/modules/learn/jobs");
const queries = await import("@/modules/learn/queries");
const actions = await import("@/modules/learn/actions");

const TODAY = "2026-10-12";
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

async function liveAddon() {
  const editor = await makeUser("ed");
  const publisher = await makeUser("pub");
  const reviewer = await makeUser("rev");
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Pending Client ")}) returning id`);
  const made = await tx((t) => svc.createClientAddon(t, { clientId: c.id, actorId: editor }));
  await tx((t) => svc.editDraft(t, { versionId: made.versionId, stamp: 0, actorId: editor, apply: (s) => ({ ...s, content: writeEverything(s.content), questions: writeEverything(s.questions) }) }));
  await tx((t) => svc.publishDraft(t, { versionId: made.versionId, actorId: publisher, reviewerUserId: reviewer, counselApprovedOn: "2026-10-12", material: false }));
  const [course] = await rows<{ id: string }>(sql`select id from learn.courses where slug = ${made.slug}`);
  return { clientId: c.id, slug: made.slug, courseId: course.id };
}

describe("training for a new hire who has not signed in", () => {
  it("queues the assignment, lists it, refuses other roles, and assigns after first sign-in", async () => {
    const a = await liveAddon();
    const hrId = await makeUser("hr");
    const hr = { id: hrId, email: "hr@example.com", roles: ["hr_admin"], employeeId: null };

    const email = `${uniq("hire")}@example.com`;
    const [emp] = await rows<{ id: string }>(sql`
      insert into core.employees (legal_first_name, legal_last_name, work_email, status, start_date)
      values ('Newly', 'Hired', ${email}, 'onboarding', '2026-10-14') returning id`);
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${emp.id}, ${a.clientId}, '2026-10-14')`);

    // Listed with no account: "Not signed in yet"
    current.user = hr;
    const before = await queries.listTrainingStatus({ course: a.slug }, { page: 1, pageSize: 50 });
    const row0 = before.rows.find((r) => r.employeeId === emp.id);
    expect(row0).toMatchObject({ userId: null, state: "no_account", label: "Not signed in yet" });

    // An employee cannot queue it
    current.user = { id: await makeUser("emp"), email: "e@example.com", roles: ["employee"], employeeId: null };
    expect((await actions.assignLearnTraining({ employeeId: emp.id, track: "full", course: a.slug })).ok).toBe(false);
    expect(await rows(sql`select 1 from learn.pending_assignments where employee_id = ${emp.id}`)).toHaveLength(0);

    // HR queues it (twice is harmless)
    current.user = hr;
    const first = await actions.assignLearnTraining({ employeeId: emp.id, track: "full", course: a.slug });
    expect(first).toMatchObject({ ok: true, data: { queued: true, created: false } });
    expect(await actions.assignLearnTraining({ employeeId: emp.id, track: "full", course: a.slug })).toMatchObject({ ok: true, data: { queued: false } });
    expect(await rows(sql`select 1 from learn.pending_assignments where employee_id = ${emp.id}`)).toHaveLength(1);
    const queued = await queries.listTrainingStatus({ course: a.slug }, { page: 1, pageSize: 50 });
    expect(queued.rows.find((r) => r.employeeId === emp.id)).toMatchObject({ state: "queued", label: "Queued" });

    // Both userId and employeeId, or neither, is refused
    expect((await actions.assignLearnTraining({ track: "full", course: a.slug })).ok).toBe(false);

    // The person signs in: their record is linked to an account. The nightly run makes the real assignment and clears the queue.
    const userId = await makeUser("signedin");
    await db.execute(sql`update core.employees set user_id = ${userId} where id = ${emp.id}`);
    const run = await jobs.runLearnAssign(TODAY, { userIds: [userId] }, a.slug);
    expect(run.assigned).toBe(1);
    const [asg] = await rows<{ track: string; reason: string; due_on: string }>(sql`select track, reason, due_on::text as due_on from learn.assignments where user_id = ${userId} and course_id = ${a.courseId}`);
    expect(asg).toMatchObject({ track: "full", reason: "new_hire", due_on: "2026-11-13" });
    expect(await rows(sql`select 1 from learn.pending_assignments where employee_id = ${emp.id}`)).toHaveLength(0);

    // Running again changes nothing
    expect((await jobs.runLearnAssign(TODAY, { userIds: [userId] }, a.slug)).assigned).toBe(0);
  });
});
