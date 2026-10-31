import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./global-setup";

// Moving an old account's training history to the account now in use (a merge, or a reviewed repair). The evidence tables stay
// append-only for everything else: only learn.transfer_history() may change an owner, and it logs each transfer.

const admin = postgres(testDatabaseUrl(process.env.TEST_DB_ADMIN_URL!), { max: 2, onnotice: () => {} });
afterAll(async () => {
  await admin.end();
});
const { db } = await import("@/lib/db");
const { moveLearnHistory } = await import("@/modules/people/duplicates-service");
const { loadCourse, assignCourse } = await import("@/modules/learn/publish");
const { COURSES } = await import("../../../learn/src/content");

let n = 0;
const makeUser = async () => {
  const id = randomUUID();
  await admin`insert into core.users (id, email) values (${id}, ${`mv${Date.now().toString(36)}${n++}@example.com`})`;
  return id;
};
const fail = async (p: PromiseLike<unknown>) => {
  try {
    await p;
    return "no error";
  } catch (e) {
    return String((e as { message?: string }).message);
  }
};

async function course() {
  const reviewer = await makeUser();
  const slug = `move-test-${Date.now().toString(36)}${n++}`;
  const src = COURSES.cybersecurity;
  const v = await loadCourse(admin, { course: { slug, content: structuredClone(src.content), questions: structuredClone(src.questions), examConfig: src.examConfig }, publish: true, reviewerUserId: reviewer, counselApprovedOn: "2026-10-23", actorUserId: reviewer });
  const [mod] = await admin`select module_key from learn.version_modules where version_id = ${v.versionId} order by position limit 1`;
  return { slug, versionId: v.versionId as string, moduleKey: mod.module_key as string, actor: reviewer };
}

describe("moving learning history between accounts", () => {
  it("moves a finished assignment with its progress, attempt, acceptance and certificate, and logs it", async () => {
    const c = await course();
    const from = await makeUser();
    const to = await makeUser();
    const a = await assignCourse(admin, { userId: from, track: "full", courseSlug: c.slug });
    await admin`update learn.assignments set status = 'in_progress' where id = ${a.assignmentId}`;
    await admin`insert into learn.module_completions (assignment_id, user_id, module_key) values (${a.assignmentId}, ${from}, ${c.moduleKey})`;
    await admin`insert into learn.exam_attempts (assignment_id, user_id, attempt_no, deadline_at, total_count) values (${a.assignmentId}, ${from}, 1, now() + interval '1 hour', 10)`;
    await admin`update learn.exam_attempts set status = 'submitted', submitted_at = now(), passed = true, correct_count = 10, score_percent = 100 where assignment_id = ${a.assignmentId}`;
    await admin`update learn.assignments set status = 'passed', passed_at = now() where id = ${a.assignmentId}`;
    await admin`insert into learn.attestations (assignment_id, user_id, statement_version, typed_name, ip, auth_methods) values (${a.assignmentId}, ${from}, 'v1', 'Test Person', '203.0.113.9', '{password}')`;
    await admin`insert into learn.certificates (reference, user_id, assignment_id, version_id, track, holder_name, issued_on, ends_on) values (${`HC-2026-${String(200000 + (Date.now() % 700000)).replace(/[01]/g, "7")}`}, ${from}, ${a.assignmentId}, ${c.versionId}, 'full', 'Test Person', '2026-10-01', '2027-10-01')`;

    const result = await db.transaction((tx) => moveLearnHistory(tx, { fromUserId: from, toUserId: to, actorId: c.actor, reason: "Verified the same person" }));
    expect(result).toEqual({ assignmentsMoved: 1, assignmentsSkipped: 0, certificatesMoved: 1 });

    for (const table of ["assignments", "module_completions", "exam_attempts", "attestations", "certificates"]) {
      const rows = await admin.unsafe(`select user_id from learn.${table} where ${table === "assignments" ? "id" : "assignment_id"} = $1`, [a.assignmentId]);
      expect(rows.map((r) => r.user_id), table).toEqual([to]);
    }
    const [log] = await admin`select * from learn.history_transfers where from_user_id = ${from}`;
    expect(log).toMatchObject({ to_user_id: to, actor_id: c.actor, reason: "Verified the same person", assignments_moved: 1, certificates_moved: 1 });
  });

  it("leaves an open assignment alone when the target already has one open for the same course", async () => {
    const c = await course();
    const from = await makeUser();
    const to = await makeUser();
    const old = await assignCourse(admin, { userId: from, track: "full", courseSlug: c.slug });
    await assignCourse(admin, { userId: to, track: "full", courseSlug: c.slug });
    const result = await db.transaction((tx) => moveLearnHistory(tx, { fromUserId: from, toUserId: to, actorId: c.actor, reason: "Merged" }));
    expect(result).toEqual({ assignmentsMoved: 0, assignmentsSkipped: 1, certificatesMoved: 0 });
    const [row] = await admin`select user_id from learn.assignments where id = ${old.assignmentId}`;
    expect(row.user_id).toBe(from);
  });

  it("keeps every record append-only outside the transfer, and the app role cannot run it", async () => {
    const c = await course();
    const from = await makeUser();
    const to = await makeUser();
    const a = await assignCourse(admin, { userId: from, track: "full", courseSlug: c.slug });
    await admin`insert into learn.module_completions (assignment_id, user_id, module_key) values (${a.assignmentId}, ${from}, ${c.moduleKey})`;

    // changing an owner directly is still refused
    expect(await fail(admin`update learn.assignments set user_id = ${to} where id = ${a.assignmentId}`)).toMatch(/cannot be rewritten/);
    expect(await fail(admin`update learn.module_completions set user_id = ${to} where assignment_id = ${a.assignmentId}`)).toMatch(/append-only/);
    // the flag alone does not allow any other change
    expect(await fail(admin.begin(async (t) => {
      await t`select set_config('learn.history_transfer', 'on', true)`;
      await t`update learn.module_completions set completed_at = now() - interval '1 day' where assignment_id = ${a.assignmentId}`;
    }))).toMatch(/append-only/);
    // the log cannot be edited or removed
    await db.transaction((tx) => moveLearnHistory(tx, { fromUserId: from, toUserId: to, actorId: c.actor, reason: "Merged" }));
    expect(await fail(admin`delete from learn.history_transfers where from_user_id = ${from}`)).toMatch(/append-only/);
    // the app role has no right to run the transfer or to write these tables
    const [priv] = await admin`select has_function_privilege('learn_app', 'learn.transfer_history(uuid, uuid, uuid, text)', 'execute') as run, has_table_privilege('learn_app', 'learn.assignments', 'update') as upd`;
    expect(priv).toEqual({ run: false, upd: false });
  });
});
