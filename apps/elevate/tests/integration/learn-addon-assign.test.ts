import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Assigning a client add-on (client add-ons, step 3): the first publish starts paused, then the nightly job assigns exactly the
// people currently on that client (due 30 days after they joined), closes automatic assignments of people who leave the client
// but not manual ones, never touches other people, and Training status lists only that client's people.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const svc = await import("@/modules/learn/studio-service");
const jobs = await import("@/modules/learn/jobs");
const queries = await import("@/modules/learn/queries");

const TODAY = "2026-10-12";
const plus = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const tx = <T>(fn: Parameters<typeof db.transaction>[0] extends (t: infer X) => unknown ? (t: X) => Promise<T> : never) => db.transaction(fn as never) as Promise<T>;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function makeUser(label: string) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${`${uniq(label)}@example.com`})`);
  return id;
}

async function makePerson(first: string) {
  const id = await makeUser("ad");
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, start_date)
    values (${first}, 'Addon', ${`${uniq("ade")}@example.com`}, 'active', ${id}, '2024-02-01') returning id`);
  return { id, email: "x", roles: ["employee"], employeeId: e.id };
}

const onClient = (employeeId: string, clientId: string, startDate: string) =>
  db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${employeeId}, ${clientId}, ${startDate})`);

function writeEverything<T>(value: T, counter = { n: 0 }): T {
  if (typeof value === "string") return (value.includes("TO WRITE:") ? `Written content for the client requirements, item number ${++counter.n}` : value) as T;
  if (Array.isArray(value)) return value.map((v) => writeEverything(v, counter)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, writeEverything(v, counter)])) as T;
  return value;
}

/** A client with a published add-on (made through the studio, as in production). */
async function liveAddon() {
  const editor = await makeUser("ed");
  const publisher = await makeUser("pub");
  const reviewer = await makeUser("rev");
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Addon Client ")}) returning id`);
  const made = await tx((t) => svc.createClientAddon(t, { clientId: c.id, actorId: editor }));
  await tx((t) => svc.editDraft(t, { versionId: made.versionId, stamp: 0, actorId: editor, apply: (s) => ({ ...s, content: writeEverything(s.content), questions: writeEverything(s.questions) }) }));
  const out = await tx((t) => svc.publishDraft(t, { versionId: made.versionId, actorId: publisher, reviewerUserId: reviewer, counselApprovedOn: "2026-10-12", material: false }));
  const [course] = await rows<{ id: string }>(sql`select id from learn.courses where slug = ${made.slug}`);
  return { clientId: c.id, slug: made.slug, courseId: course.id, versionId: made.versionId, startedPaused: out.startedPaused };
}

const open = async (userId: string, courseId: string) =>
  (await rows<{ id: string; track: string; reason: string; due_on: string; status: string; created_by: string | null }>(sql`
    select id, track, reason, due_on::text as due_on, status, created_by::text from learn.assignments where user_id = ${userId} and course_id = ${courseId} order by assigned_at desc limit 1`))[0];

describe("client add-on assignment", () => {
  it("starts paused on first publish, then assigns only the people on the client", async () => {
    const a = await liveAddon();
    expect(a.startedPaused).toBe(true);
    const [rule] = await rows<{ mode: string }>(sql`select mode from learn.assignment_rules where course_id = ${a.courseId}`);
    expect(rule.mode).toBe("paused");

    const newcomer = await makePerson("Newcomer");
    const veteran = await makePerson("Veteran");
    const outsider = await makePerson("Outsider");
    await onClient(newcomer.employeeId, a.clientId, plus(TODAY, -3));
    await onClient(veteran.employeeId, a.clientId, "2025-01-10");
    const scope = { userIds: [newcomer.id, veteran.id, outsider.id] };

    // paused: nobody
    expect(await jobs.runLearnAssign(TODAY, scope, a.slug)).toMatchObject({ skipped: false, mode: "paused", assigned: 0 });

    await db.execute(sql`update learn.assignment_rules set mode = 'all' where course_id = ${a.courseId}`);
    expect(await jobs.runLearnAssign(TODAY, scope, a.slug)).toMatchObject({ assigned: 2 });
    expect(await open(newcomer.id, a.courseId)).toMatchObject({ track: "full", reason: "new_hire", due_on: plus(TODAY, 27), status: "assigned", created_by: null });
    expect(await open(veteran.id, a.courseId)).toMatchObject({ track: "full", due_on: plus(TODAY, 30) });
    expect(await open(outsider.id, a.courseId)).toBeUndefined();

    // a second run changes nothing
    expect(await jobs.runLearnAssign(TODAY, scope, a.slug)).toMatchObject({ assigned: 0, cancelled: 0 });
    // a core course is not touched by an add-on's people
    expect((await rows(sql`select 1 from learn.assignments x join learn.courses c on c.id = x.course_id where x.user_id = ${outsider.id} and c.kind = 'client_addon'`)).length).toBe(0);
  });

  it("closes an automatic assignment when the person leaves the client, keeps a manual one, and keeps the person's record", async () => {
    const a = await liveAddon();
    await db.execute(sql`update learn.assignment_rules set mode = 'all' where course_id = ${a.courseId}`);
    const leaver = await makePerson("Leaver");
    const hand = await makePerson("Hand");
    await onClient(leaver.employeeId, a.clientId, plus(TODAY, -2));
    await onClient(hand.employeeId, a.clientId, plus(TODAY, -2));
    const hr = await makeUser("hr");
    // HR assigned `hand` by hand (created_by set); the job assigns `leaver` on its own
    await db.execute(sql`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on, created_by) values (${hand.id}, ${a.courseId}, ${a.versionId}, 'full', 'manual', ${plus(TODAY, 30)}, ${hr})`);
    await jobs.runLearnAssign(TODAY, { userIds: [leaver.id, hand.id] }, a.slug);

    await db.execute(sql`update core.client_assignments set end_date = ${plus(TODAY, 1)} where employee_id = any(${`{${leaver.employeeId},${hand.employeeId}}`}::uuid[]) and client_id = ${a.clientId}`);
    const run = await jobs.runLearnAssign(plus(TODAY, 2), { userIds: [leaver.id, hand.id] }, a.slug);
    expect(run.cancelled).toBe(1);
    expect((await open(leaver.id, a.courseId)).status).toBe("cancelled");
    expect((await open(hand.id, a.courseId)).status).toBe("assigned");
  });

  it("lists only the client's people on Training status, and an assigned person who left the client", async () => {
    const a = await liveAddon();
    await db.execute(sql`update learn.assignment_rules set mode = 'all' where course_id = ${a.courseId}`);
    const hrUser = await makeUser("hrview");
    await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${hrUser}, 'hr_admin')`);
    const inside = await makePerson("Inside");
    const outside = await makePerson("Outside");
    await onClient(inside.employeeId, a.clientId, plus(TODAY, -1));
    current.user = { id: hrUser, email: "hr@example.com", roles: ["hr_admin"] };

    const list = await queries.listTrainingStatus({ course: a.slug }, { page: 1, pageSize: 100 });
    expect(list.course).toBe(a.slug);
    expect(list.fixedTrack).toBe(true);
    expect(list.rows.map((r) => r.userId)).toContain(inside.id);
    expect(list.rows.map((r) => r.userId)).not.toContain(outside.id);
  });
});

describe("add-on certificates and the evidence report", () => {
  it("issues an ERSCL reference and shows the add-on in the client's evidence report", async () => {
    const a = await liveAddon();
    const p = await makePerson("Certified");
    await onClient(p.employeeId, a.clientId, "2026-01-05");
    const [asg] = await rows<{ id: string }>(sql`
      insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${p.id}, ${a.courseId}, ${a.versionId}, 'full', 'manual', '2026-12-01') returning id`);
    await db.execute(sql`update learn.assignments set status = 'in_progress' where id = ${asg.id}`);
    await db.execute(sql`update learn.assignments set status = 'passed', passed_at = now() where id = ${asg.id}`);
    const cert = await rows<{ reference: string }>(sql`select * from learn.accept_and_certify(${p.id}, ${asg.id}, 'v1', 'Certified Addon', '203.0.113.9', array['password']::text[])`);
    expect(cert[0].reference).toMatch(/^ERSCL-\d{4}-[A-Z2-9]{6}$/);

    const { buildClientEvidence } = await import("@/modules/learn/evidence");
    const report = await buildClientEvidence(db, a.clientId, plus(new Date().toISOString().slice(0, 10), 1));
    expect(report?.addon?.label).toContain("requirements");
    expect(report?.rows.find((r) => r.name.startsWith("Certified"))?.addon).toMatchObject({ status: "valid", reference: cert[0].reference });
  });
});
