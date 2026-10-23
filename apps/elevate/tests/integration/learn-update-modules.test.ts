import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Update modules (Release 3): a version published as "material" gives people already certified a short assignment that covers only
// the modules whose content changed, due in 30 days, ending with a few questions from them. Their certificate keeps its own dates,
// finishing records their acceptance and issues nothing, and a change that is not material (or that they already have) assigns nothing.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const svc = await import("@/modules/learn/studio-service");
const jobs = await import("@/modules/learn/jobs");

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
  const id = await makeUser("up");
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, start_date)
    values (${first}, 'Updater', ${`${uniq("upe")}@example.com`}, 'active', ${id}, '2024-02-01') returning id`);
  return { id, employeeId: e.id, fullName: `${first} Updater` };
}

function writeEverything<T>(value: T, counter = { n: 0 }): T {
  if (typeof value === "string") return (value.includes("TO WRITE:") ? `Written content for the client requirements, item number ${++counter.n}` : value) as T;
  if (Array.isArray(value)) return value.map((v) => writeEverything(v, counter)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, writeEverything(v, counter)])) as T;
  return value;
}

/** A client with a published first version of its add-on (the studio makes the course; one module and its questions come from the scaffold). */
async function liveAddon() {
  const editor = await makeUser("ed");
  const publisher = await makeUser("pub");
  const reviewer = await makeUser("rev");
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Update Client ")}) returning id`);
  const made = await tx((t) => svc.createClientAddon(t, { clientId: c.id, actorId: editor }));
  await tx((t) => svc.editDraft(t, { versionId: made.versionId, stamp: 0, actorId: editor, apply: (s) => ({ ...s, content: writeEverything(s.content), questions: writeEverything(s.questions) }) }));
  await tx((t) => svc.publishDraft(t, { versionId: made.versionId, actorId: publisher, reviewerUserId: reviewer, counselApprovedOn: TODAY, material: false }));
  const [course] = await rows<{ id: string }>(sql`select id from learn.courses where slug = ${made.slug}`);
  await db.execute(sql`update learn.assignment_rules set mode = 'all' where course_id = ${course.id}`);
  return { clientId: c.id, slug: made.slug, courseId: course.id, v1: made.versionId, editor, publisher, reviewer };
}

/** Someone certified on version 1: a passed assignment with its certificate. */
async function certifiedOn(a: { courseId: string; v1: string }, clientId: string, endsOn: string) {
  const p = await makePerson("Cert");
  await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${p.employeeId}, ${clientId}, '2025-01-10')`);
  const [asg] = await rows<{ id: string }>(sql`
    insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on, status, passed_at)
    values (${p.id}, ${a.courseId}, ${a.v1}, 'full', 'manual', '2026-01-31', 'passed', now()) returning id`);
  const ref = `ERSCL-2026-${Array.from({ length: 6 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("")}`;
  await db.execute(sql`
    insert into learn.certificates (reference, user_id, assignment_id, version_id, track, holder_name, issued_on, ends_on)
    values (${ref}, ${p.id}, ${asg.id}, ${a.v1}, 'full', ${p.fullName}, '2026-01-20', ${endsOn}::date)`);
  return { ...p, assignmentId: asg.id, reference: ref };
}

/** A new version of the add-on: `change` edits the content, `material` says whether people must relearn what changed. */
async function publishVersion2(a: Awaited<ReturnType<typeof liveAddon>>, change: (c: { modules: { key: string; summary?: string; screens?: { id: string; title: string }[] }[] }) => void, material: boolean) {
  const draft = await tx((t) => svc.createDraft(t, { courseSlug: a.slug, note: "Changed wording", actorId: a.editor }));
  await tx((t) =>
    svc.editContent(t, {
      versionId: draft.versionId,
      stamp: 0,
      actorId: a.editor,
      change: (content) => {
        const next = structuredClone(content) as unknown as { modules: { key: string; summary?: string; screens?: { id: string; title: string }[] }[] };
        change(next);
        return next as never;
      },
    }),
  );
  await tx((t) => svc.publishDraft(t, { versionId: draft.versionId, actorId: a.publisher, reviewerUserId: a.reviewer, counselApprovedOn: TODAY, material }));
  return draft;
}

const updateFor = async (userId: string, courseId: string) =>
  (await rows<{ id: string; status: string; track: string; due_on: string; version_id: string; module_keys: string[] | null; question_count: number | null }>(sql`
    select a.id, a.status, a.track, a.due_on::text as due_on, a.version_id::text, s.module_keys, s.question_count
    from learn.assignments a left join learn.update_scopes s on s.assignment_id = a.id
    where a.user_id = ${userId} and a.course_id = ${courseId} and a.reason = 'update'`))[0];

describe("update modules", () => {
  it("a material change assigns a short update covering only the modules that changed, once", async () => {
    const a = await liveAddon();
    const person = await certifiedOn(a, a.clientId, "2027-01-20");
    const scope = { userIds: [person.id] };

    const mods = await rows<{ module_key: string }>(sql`select module_key from learn.version_modules where version_id = ${a.v1} order by position`);
    expect(mods.length).toBeGreaterThan(0);
    const changedKey = mods[0].module_key;

    // nothing yet: the published version is the one they hold
    expect(await jobs.runLearnAssign(TODAY, scope, a.slug)).toMatchObject({ updates: 0 });

    const v2 = await publishVersion2(a, (c) => { c.modules.find((m) => m.key === changedKey)!.screens![0].title = "A reworded first screen"; }, true);
    const run = await jobs.runLearnAssign(TODAY, scope, a.slug);
    expect(run).toMatchObject({ updates: 1 });

    const up = await updateFor(person.id, a.courseId);
    expect(up).toMatchObject({ status: "assigned", track: "full", due_on: plus(TODAY, 30), version_id: v2.versionId });
    expect(up.module_keys).toEqual([changedKey]);
    // and only the screen that changed (the first), not the whole module
    const [scoped] = await rows<{ screens: Record<string, number[]> }>(sql`select screens from learn.update_scopes where assignment_id = ${up.id}`);
    expect(scoped.screens).toEqual({ [changedKey]: [0] });
    expect(up.question_count).toBeGreaterThanOrEqual(1);
    expect(up.question_count).toBeLessThanOrEqual(5);

    // the certificate is untouched
    const [cert] = await rows<{ ends_on: string }>(sql`select ends_on::text as ends_on from learn.certificates where reference = ${person.reference}`);
    expect(cert.ends_on).toBe("2027-01-20");
    // they were told, and a second run assigns nothing more
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${person.id} and kind = 'learn.update_assigned'`)).length).toBe(1);
    expect(await jobs.runLearnAssign(TODAY, scope, a.slug)).toMatchObject({ updates: 0 });
  });

  it("finishing a scoped module needs only its changed screens and a share of the reading time", async () => {
    const a = await liveAddon();
    const person = await certifiedOn(a, a.clientId, "2027-01-20");
    const scope = { userIds: [person.id] };
    const [first] = await rows<{ module_key: string; min_seconds: number; screen_count: number }>(sql`select module_key, min_seconds, screen_count from learn.version_modules where version_id = ${a.v1} order by position limit 1`);
    await publishVersion2(a, (c) => { c.modules.find((m) => m.key === first.module_key)!.screens![0].title = "A reworded first screen"; }, true);
    await jobs.runLearnAssign(TODAY, scope, a.slug);
    const up = await updateFor(person.id, a.courseId);

    const [{ n: need }] = await rows<{ n: number }>(sql`select learn.assignment_min_seconds(${up.id}::uuid, ${first.module_key}) as n`);
    expect(need).toBeLessThanOrEqual(first.min_seconds);
    const complete = () => db.execute(sql`select learn.complete_module(${person.id}::uuid, ${up.id}::uuid, ${first.module_key})`);
    const refused = async (re: RegExp) => {
      try {
        await complete();
      } catch (e) {
        expect(String((e as { cause?: { message?: string } }).cause?.message ?? e)).toMatch(re);
        return;
      }
      throw new Error("it was not refused");
    };
    // nothing opened yet: refused
    await refused(/screens_missing/);
    // the changed screen opened, but not enough reading time for it: refused
    await db.execute(sql`insert into learn.module_screens (assignment_id, user_id, module_key, screen_index) values (${up.id}, ${person.id}, ${first.module_key}, 0)`);
    if (need > 0) await refused(/time_missing/);
    // the share of the time that matches the changed screens is enough: no need to open the other screens
    await db.execute(sql`insert into learn.module_time (assignment_id, user_id, module_key, day, seconds) values (${up.id}, ${person.id}, ${first.module_key}, ${TODAY}::date, ${need})`);
    await complete();
    expect((await rows(sql`select 1 from learn.module_completions where assignment_id = ${up.id} and module_key = ${first.module_key}`)).length).toBe(1);
  });

  it("a change that is not marked material, or that touches nothing in the person's track, assigns nothing", async () => {
    const a = await liveAddon();
    const person = await certifiedOn(a, a.clientId, "2027-01-20");
    const scope = { userIds: [person.id] };
    const [first] = await rows<{ module_key: string }>(sql`select module_key from learn.version_modules where version_id = ${a.v1} order by position limit 1`);

    await publishVersion2(a, (c) => { c.modules.find((m) => m.key === first.module_key)!.screens![0].title = "A reworded first screen"; }, false);
    expect(await jobs.runLearnAssign(TODAY, scope, a.slug)).toMatchObject({ updates: 0 });
    expect(await updateFor(person.id, a.courseId)).toBeUndefined();
  });

  it("leaves people with an open assignment, an expired certificate or no certificate alone", async () => {
    const a = await liveAddon();
    const openOne = await certifiedOn(a, a.clientId, "2027-01-20");
    const expired = await certifiedOn(a, a.clientId, "2026-08-01");
    const never = await makePerson("Never");
    // the open one is mid-way through a renewal on version 1
    await db.execute(sql`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on, status) values (${openOne.id}, ${a.courseId}, ${a.v1}, 'full', 'renewal', ${plus(TODAY, 20)}::date, 'in_progress')`);
    const [first] = await rows<{ module_key: string }>(sql`select module_key from learn.version_modules where version_id = ${a.v1} order by position limit 1`);
    await publishVersion2(a, (c) => { c.modules.find((m) => m.key === first.module_key)!.screens![0].title = "A reworded first screen"; }, true);

    await jobs.runLearnAssign(TODAY, { userIds: [openOne.id, expired.id, never.id] }, a.slug);
    expect(await updateFor(openOne.id, a.courseId)).toBeUndefined();
    expect(await updateFor(expired.id, a.courseId)).toBeUndefined();
    expect(await updateFor(never.id, a.courseId)).toBeUndefined();
  });

  it("the update's exam draws only from the changed modules, and accepting it issues no certificate", async () => {
    const a = await liveAddon();
    const person = await certifiedOn(a, a.clientId, "2027-01-20");
    const [first] = await rows<{ module_key: string }>(sql`select module_key from learn.version_modules where version_id = ${a.v1} order by position limit 1`);
    await publishVersion2(a, (c) => { c.modules.find((m) => m.key === first.module_key)!.screens![0].title = "A reworded first screen"; }, true);
    await jobs.runLearnAssign(TODAY, { userIds: [person.id] }, a.slug);
    const up = (await updateFor(person.id, a.courseId))!;

    // the player's module list for this assignment is the scope
    const listed = await rows<{ module_key: string }>(sql`select module_key from learn.assignment_modules(${up.id}::uuid)`);
    expect(listed.map((r) => r.module_key)).toEqual([first.module_key]);

    // finish the module, then start the exam
    await db.execute(sql`update learn.assignments set status = 'in_progress' where id = ${up.id}`);
    await db.execute(sql`insert into learn.module_completions (assignment_id, user_id, module_key) values (${up.id}, ${person.id}, ${first.module_key})`);
    const [{ start_exam: attemptId }] = await rows<{ start_exam: string }>(sql`select learn.start_exam(${person.id}::uuid, ${up.id}::uuid)`);
    const items = await rows<{ module_key: string }>(sql`
      select q.module_key from learn.exam_attempt_items i join learn.questions q on q.id = i.question_id where i.attempt_id = ${attemptId}::uuid`);
    expect(items.length).toBe(up.question_count);
    expect(new Set(items.map((i) => i.module_key))).toEqual(new Set([first.module_key]));

    // pass it and accept: acceptance is recorded, no new certificate, the old one is unchanged
    await db.execute(sql`update learn.exam_attempts set status = 'submitted', submitted_at = now(), passed = true, correct_count = total_count, score_percent = 100 where id = ${attemptId}::uuid`);
    await db.execute(sql`update learn.assignments set status = 'passed', passed_at = now() where id = ${up.id}`);
    const accepted = await rows(sql`select * from learn.accept_and_certify(${person.id}::uuid, ${up.id}::uuid, 'v1', ${person.fullName}, '203.0.113.9', ${"{password,totp}"}::text[])`);
    expect(accepted).toHaveLength(0);
    expect((await rows(sql`select 1 from learn.attestations where assignment_id = ${up.id}`)).length).toBe(1);
    expect((await rows(sql`select 1 from learn.certificates where user_id = ${person.id}`)).length).toBe(1);
    // a repeat is harmless
    await rows(sql`select * from learn.accept_and_certify(${person.id}::uuid, ${up.id}::uuid, 'v1', ${person.fullName}, '203.0.113.9', ${"{password,totp}"}::text[])`);
    expect((await rows(sql`select 1 from learn.attestations where assignment_id = ${up.id}`)).length).toBe(1);
  });
});
