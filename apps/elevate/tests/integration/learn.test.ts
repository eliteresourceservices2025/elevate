import { randomUUID, createHash } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./global-setup";

// Real-database tests for the ELEVATE Learn schema (migration 0054): what the app role may read and run, that the answer key never
// reaches it, the frozen versions and append-only evidence, the learning flow (order, screens, server-counted time), the exam
// (selection, tries, wait, deadline, grading, review), attestation and certificate, the public check, and the sign-in handoff.

const APP_PASSWORD = "learn-app-test-password-not-a-secret";
const adminUrl = process.env.TEST_DB_ADMIN_URL!;

function roleUrl(role: string, password: string) {
  const url = new URL(testDatabaseUrl(adminUrl));
  url.username = role;
  url.password = password;
  return url.toString();
}

const admin = postgres(testDatabaseUrl(adminUrl), { max: 2, onnotice: () => {} });
await admin.unsafe(`alter role learn_app login password '${APP_PASSWORD}'`);
const app = postgres(roleUrl("learn_app", APP_PASSWORD), { max: 2, onnotice: () => {} });

afterAll(async () => {
  await app.end();
  await admin.end();
});

let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const sha = (s: string) => createHash("sha256").update(s).digest();

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return "NO ERROR";
}

async function makePerson(first = "Ana", last = "Cruz", status = "active") {
  const id = randomUUID();
  const email = `${uniq("p")}@example.com`;
  await admin`insert into core.users (id, email) values (${id}, ${email})`;
  await admin`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, start_date) values (${first}, ${last}, ${email}, ${status}, ${id}, '2026-01-05')`;
  return { id, email, first, last, fullName: `${first} ${last}` };
}

type CourseOpts = { wait?: number; maxTries?: number; /** minutes of the exam; null = no time limit */ minutes?: number | null; full?: number; essentials?: number; publish?: boolean };

async function makeCourse(o: CourseOpts = {}) {
  const [course] = await admin`insert into learn.courses (slug, title) values (${uniq("hipaa-")}, 'HIPAA test') returning id`;
  const config = {
    passPercent: 85,
    maxTries: o.maxTries ?? 3,
    waitMinutesAfterFail: o.wait ?? 0,
    renewalMonths: 12,
    tracks: {
      full: { questions: o.full ?? 4, ...(o.minutes === null ? {} : { minutes: o.minutes ?? 30 }) },
      essentials: { questions: o.essentials ?? 2, ...(o.minutes === null ? {} : { minutes: o.minutes ?? 30 }) },
    },
  };
  const [version] = await admin`insert into learn.course_versions (course_id, version, exam_config) values (${course.id}, 1, ${admin.json(config)}) returning id`;
  await admin`insert into learn.version_modules (version_id, module_key, position, title, estimated_minutes, min_seconds, screen_count, tracks) values
    (${version.id}, 'm1', 1, 'Module one', 1, 20, 2, ${["full", "essentials"]}),
    (${version.id}, 'm2', 2, 'Module two', 1, 20, 1, ${["full"]})`;
  const options = [
    { id: "a", text: "Right" },
    { id: "b", text: "Wrong" },
    { id: "c", text: "Also wrong" },
  ];
  const questionIds: string[] = [];
  for (const m of ["m1", "m2"]) {
    for (let i = 0; i < 3; i++) {
      const [q] = await admin`insert into learn.questions (version_id, module_key, topic, type, stem, options, correct_ids, rationale)
        values (${version.id}, ${m}, ${`topic-${m}`}, 'single', ${`Question ${m}-${i}?`}, ${admin.json(options)}, ${["a"]}, 'Because a is right.') returning id`;
      questionIds.push(q.id);
    }
  }
  if (o.publish !== false) await admin`update learn.course_versions set status = 'published', published_at = now() where id = ${version.id}`;
  return { courseId: course.id as string, versionId: version.id as string, questionIds };
}

async function assign(userId: string, c: { courseId: string; versionId: string }, track = "full") {
  const [a] = await admin`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on)
    values (${userId}, ${c.courseId}, ${c.versionId}, ${track}, 'new_hire', '2026-12-31') returning id`;
  return a.id as string;
}

async function finishModules(userId: string, asg: string, modules = ["m1", "m2"]) {
  for (const m of modules) {
    const screens = m === "m1" ? 2 : 1;
    for (let s = 0; s < screens; s++) await app`select learn.open_screen(${userId}::uuid, ${asg}::uuid, ${m}, ${s})`;
    await app`select learn.credit_time(${userId}::uuid, ${asg}::uuid, ${m}, 35)`;
    await app`select learn.complete_module(${userId}::uuid, ${asg}::uuid, ${m})`;
  }
}

async function items(attempt: string) {
  return (await admin`select i.position, i.question_id, q.correct_ids, i.option_order from learn.exam_attempt_items i join learn.questions q on q.id = i.question_id where i.attempt_id = ${attempt} order by i.position`) as unknown as { position: number; question_id: string; correct_ids: string[]; option_order: string[] }[];
}

/** Answer every question; `wrong` of them deliberately wrong. */
async function answer(userId: string, attempt: string, wrong = 0) {
  const list = await items(attempt);
  let n = 0;
  for (const it of list) {
    const pick = n++ < wrong ? ["b"] : it.correct_ids;
    await app`select learn.save_answer(${userId}::uuid, ${attempt}::uuid, ${it.question_id}::uuid, ${pick}::text[])`;
  }
}

const startExam = async (userId: string, asg: string) => ((await app`select learn.start_exam(${userId}::uuid, ${asg}::uuid) as id`)[0].id as string);
const grade = async (userId: string, attempt: string) => (await app`select * from learn.grade_attempt(${userId}::uuid, ${attempt}::uuid)`)[0];

describe("the app role", () => {
  it("cannot read the answer key, any other schema, or write a table directly", async () => {
    const c = await makeCourse();
    const p = await makePerson();
    const asg = await assign(p.id, c);
    await finishModules(p.id, asg);
    const attempt = await startExam(p.id, asg);

    // Visible: the question text and options of its own attempt.
    const seen = await app.begin(async (tx) => {
      await tx`select set_config('learn.user_id', ${p.id}, true)`;
      return tx`select id, stem, options from learn.questions`;
    });
    expect(seen.length).toBe(4);

    expect(await failure(app`select correct_ids from learn.questions`)).toMatch(/permission denied/);
    expect(await failure(app`select rationale from learn.questions`)).toMatch(/permission denied/);
    expect(await failure(app`select * from learn.questions`)).toMatch(/permission denied/);
    expect(await failure(app`select * from core.employees`)).toMatch(/permission denied/);
    expect(await failure(app`select * from learn.launch_tokens`)).toMatch(/permission denied/);
    expect(await failure(app`select * from learn.sessions`)).toMatch(/permission denied/);
    expect(await failure(app`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${p.id}, ${c.courseId}, ${c.versionId}, 'full', 'manual', '2026-12-31')`)).toMatch(/permission denied/);
    expect(await failure(app`update learn.exam_attempts set passed = true where id = ${attempt}`)).toMatch(/permission denied/);
    expect(await failure(app`delete from learn.module_completions`)).toMatch(/permission denied/);
  });

  it("sees only its own rows, and nothing when no person is set", async () => {
    const c = await makeCourse();
    const a = await makePerson();
    const b = await makePerson();
    const asgA = await assign(a.id, c);
    await assign(b.id, c);
    const mine = await app.begin(async (tx) => {
      await tx`select set_config('learn.user_id', ${a.id}, true)`;
      return tx`select id from learn.assignments`;
    });
    expect(mine.map((r) => r.id)).toEqual([asgA]);
    expect((await app`select id from learn.assignments`).length).toBe(0);
  });

  it("sees only the signed-in person through the people view, never a list", async () => {
    const a = await makePerson("Maria", "Santos");
    await makePerson("Jose", "Reyes");
    const rows = await app.begin(async (tx) => {
      await tx`select set_config('learn.user_id', ${a.id}, true)`;
      return tx`select user_id, display_name, legal_name, active from learn.v_learners`;
    });
    expect(rows.length).toBe(1);
    expect(rows[0].legal_name).toBe("Maria Santos");
    expect(rows[0].active).toBe(true);
    expect((await app`select * from learn.v_learners`).length).toBe(0);
    expect(await failure(app`select * from learn.v_status`)).toMatch(/permission denied/);
  });

  it("cannot run a function that was not granted to it", async () => {
    expect(await failure(app`select learn.user_is_active(${randomUUID()}::uuid)`)).toMatch(/permission denied/);
  });
});

describe("frozen versions and append-only evidence", () => {
  it("freezes a published version, its modules and its questions", async () => {
    const c = await makeCourse();
    expect(await failure(admin`update learn.course_versions set content = '{"x":1}'::jsonb where id = ${c.versionId}`)).toMatch(/frozen/);
    expect(await failure(admin`update learn.course_versions set status = 'draft' where id = ${c.versionId}`)).toMatch(/only be retired|frozen/);
    expect(await failure(admin`delete from learn.course_versions where id = ${c.versionId}`)).toMatch(/cannot be deleted/);
    expect(await failure(admin`update learn.questions set stem = 'changed stem' where id = ${c.questionIds[0]}`)).toMatch(/frozen/);
    expect(await failure(admin`insert into learn.questions (version_id, module_key, topic, type, stem, options, correct_ids, rationale)
      values (${c.versionId}, 'm1', 't', 'single', 'A new question?', ${admin.json([{ id: "a", text: "x" }, { id: "b", text: "y" }])}, ${["a"]}, 'Because.')`)).toMatch(/frozen/);
    expect(await failure(admin`delete from learn.version_modules where version_id = ${c.versionId}`)).toMatch(/frozen/);
    // it can be retired, and then cannot come back
    await admin`update learn.course_versions set status = 'retired', retired_at = now() where id = ${c.versionId}`;
    expect(await failure(admin`update learn.course_versions set status = 'published' where id = ${c.versionId}`)).toMatch(/retired|frozen/);
  });

  it("allows only one published version per course, and edits to a draft", async () => {
    const c = await makeCourse({ publish: false });
    await admin`update learn.questions set stem = 'Edited while a draft?' where id = ${c.questionIds[0]}`;
    await admin`update learn.course_versions set status = 'published', published_at = now() where id = ${c.versionId}`;
    const config = { passPercent: 85, maxTries: 3, waitMinutesAfterFail: 0, renewalMonths: 12, tracks: {} };
    const [v2] = await admin`insert into learn.course_versions (course_id, version, exam_config) values (${c.courseId}, 2, ${admin.json(config)}) returning id`;
    expect(await failure(admin`update learn.course_versions set status = 'published', published_at = now() where id = ${v2.id}`)).toMatch(/duplicate key|published_idx/);
  });

  it("never rewrites or deletes progress, grants, attestations or certificates", async () => {
    const c = await makeCourse();
    const p = await makePerson();
    const asg = await assign(p.id, c);
    await finishModules(p.id, asg);
    expect(await failure(admin`update learn.module_completions set module_key = 'm9' where assignment_id = ${asg}`)).toMatch(/append-only/);
    expect(await failure(admin`delete from learn.module_screens where assignment_id = ${asg}`)).toMatch(/append-only/);
    await admin`insert into learn.retry_grants (assignment_id, user_id, kind, extra_tries, reason, granted_by) values (${asg}, ${p.id}, 'tries', 1, 'Connection dropped', ${p.id})`;
    expect(await failure(admin`delete from learn.retry_grants where assignment_id = ${asg}`)).toMatch(/append-only/);
    // time can grow but never shrink or vanish
    expect(await failure(admin`update learn.module_time set seconds = 1 where assignment_id = ${asg} and module_key = 'm1'`)).toMatch(/only grow/);
    expect(await failure(admin`delete from learn.module_time where assignment_id = ${asg}`)).toMatch(/cannot be deleted/);
    // an assignment never goes backwards or loses its identity
    expect(await failure(admin`update learn.assignments set user_id = ${randomUUID()} where id = ${asg}`)).toMatch(/rewritten|foreign key/);
    expect(await failure(admin`update learn.assignments set status = 'assigned' where id = ${asg}`)).toMatch(/cannot go from/);
    expect(await failure(admin`delete from learn.assignments where id = ${asg}`)).toMatch(/never deleted/);
  });
});

describe("learning flow", () => {
  it("keeps modules in order and needs every screen and the minimum time", async () => {
    const c = await makeCourse();
    const p = await makePerson();
    const asg = await assign(p.id, c);

    expect(await failure(app`select learn.open_screen(${p.id}::uuid, ${asg}::uuid, 'm2', 0)`)).toMatch(/module_locked/);
    expect(await failure(app`select learn.open_screen(${p.id}::uuid, ${asg}::uuid, 'm1', 5)`)).toMatch(/no_such_screen/);
    expect(await failure(app`select learn.open_screen(${p.id}::uuid, ${asg}::uuid, 'nope', 0)`)).toMatch(/no_such_module/);
    await app`select learn.open_screen(${p.id}::uuid, ${asg}::uuid, 'm1', 0)`;
    expect((await admin`select status from learn.assignments where id = ${asg}`)[0].status).toBe("in_progress");

    expect(await failure(app`select learn.complete_module(${p.id}::uuid, ${asg}::uuid, 'm1')`)).toMatch(/screens_missing/);
    await app`select learn.open_screen(${p.id}::uuid, ${asg}::uuid, 'm1', 1)`;
    expect(await failure(app`select learn.complete_module(${p.id}::uuid, ${asg}::uuid, 'm1')`)).toMatch(/time_missing/);

    // The server decides what counts: a request for more than 35 seconds is capped, and a second one straight away gives nothing.
    expect((await app`select learn.credit_time(${p.id}::uuid, ${asg}::uuid, 'm1', 9999) as c`)[0].c).toBe(35);
    expect((await app`select learn.credit_time(${p.id}::uuid, ${asg}::uuid, 'm1', 35) as c`)[0].c).toBe(0);
    await app`select learn.complete_module(${p.id}::uuid, ${asg}::uuid, 'm1')`;
    // completing twice changes nothing
    await app`select learn.complete_module(${p.id}::uuid, ${asg}::uuid, 'm1')`;
    expect((await admin`select count(*)::int as n from learn.module_completions where assignment_id = ${asg}`)[0].n).toBe(1);
  });

  it("never lets someone else work on or read another person's assignment", async () => {
    const c = await makeCourse();
    const a = await makePerson();
    const b = await makePerson();
    const asg = await assign(a.id, c);
    expect(await failure(app`select learn.open_screen(${b.id}::uuid, ${asg}::uuid, 'm1', 0)`)).toMatch(/not_found/);
    expect(await failure(app`select learn.start_exam(${b.id}::uuid, ${asg}::uuid)`)).toMatch(/not_found/);
  });

  it("stops everything for a person who is no longer active", async () => {
    const c = await makeCourse();
    const p = await makePerson();
    const asg = await assign(p.id, c);
    await admin`update core.users set archived_at = now() where id = ${p.id}`;
    expect(await failure(app`select learn.open_screen(${p.id}::uuid, ${asg}::uuid, 'm1', 0)`)).toMatch(/inactive/);
  });
});

describe("the exam", () => {
  it("needs every module of the track first, and the Essentials track needs only its own", async () => {
    const c = await makeCourse();
    const p = await makePerson();
    const asg = await assign(p.id, c);
    expect(await failure(app`select learn.start_exam(${p.id}::uuid, ${asg}::uuid)`)).toMatch(/modules_incomplete/);

    const q = await makePerson();
    const asgE = await assign(q.id, c, "essentials");
    await finishModules(q.id, asgE, ["m1"]);
    const attempt = await startExam(q.id, asgE);
    const list = await items(attempt);
    expect(list.length).toBe(2);
    // an Essentials exam only draws from the Essentials modules
    const mods = await admin`select distinct module_key from learn.questions where id = any(${list.map((i) => i.question_id)})`;
    expect(mods.map((m) => m.module_key)).toEqual(["m1"]);
  });

  it("spreads the questions across modules, shuffles options, and resumes the same attempt", async () => {
    const c = await makeCourse({ full: 4 });
    const p = await makePerson();
    const asg = await assign(p.id, c);
    await finishModules(p.id, asg);
    const attempt = await startExam(p.id, asg);
    expect(await startExam(p.id, asg)).toBe(attempt);
    const list = await items(attempt);
    expect(list.length).toBe(4);
    const rows = await admin`select q.module_key, count(*)::int as n from learn.exam_attempt_items i join learn.questions q on q.id = i.question_id where i.attempt_id = ${attempt} group by q.module_key`;
    expect(Object.fromEntries(rows.map((r) => [r.module_key, r.n]))).toEqual({ m1: 2, m2: 2 });
    for (const it of list) expect([...it.option_order].sort()).toEqual(["a", "b", "c"]);
  });

  it("grades on the server, hides the key after a fail, shows the review after a pass", async () => {
    const c = await makeCourse({ full: 4 });
    const p = await makePerson();
    const asg = await assign(p.id, c);
    await finishModules(p.id, asg);

    const first = await startExam(p.id, asg);
    await answer(p.id, first, 1); // 3 of 4 right = 75%
    const failed = await grade(p.id, first);
    expect(Number(failed.score_percent)).toBe(75);
    expect(failed.passed).toBe(false);
    expect(failed.missed_modules.length).toBe(1);
    // grading again returns the same stored result and changes nothing
    expect(Number((await grade(p.id, first)).score_percent)).toBe(75);

    // after a fail: topics only, never the answer or the reason
    const review = await app`select * from learn.attempt_review(${p.id}::uuid, ${first}::uuid)`;
    expect(review.length).toBe(1);
    expect(review[0].is_correct).toBe(false);
    expect(review[0].correct_ids).toBeNull();
    expect(review[0].rationale).toBeNull();
    expect(await failure(admin`update learn.exam_answers set selected_ids = ${["a"]}::text[] where attempt_id = ${first}`)).toMatch(/submitted exam cannot be changed/);
    expect(await failure(admin`update learn.exam_attempts set passed = true where id = ${first}`)).toMatch(/cannot change/);

    // second try: unseen questions are preferred (bank of 6, 4 per exam, so at least the 2 unseen are in it)
    const second = await startExam(p.id, asg);
    expect(second).not.toBe(first);
    const seenBefore = new Set((await items(first)).map((i) => i.question_id));
    const secondItems = await items(second);
    const unseen = secondItems.filter((i) => !seenBefore.has(i.question_id)).length;
    expect(unseen).toBeGreaterThanOrEqual(2);

    await answer(p.id, second, 0);
    const passed = await grade(p.id, second);
    expect(Number(passed.score_percent)).toBe(100);
    expect(passed.passed).toBe(true);
    expect((await admin`select status from learn.assignments where id = ${asg}`)[0].status).toBe("passed");
    const full = await app`select * from learn.attempt_review(${p.id}::uuid, ${second}::uuid)`;
    expect(full.length).toBe(4);
    expect(full[0].rationale).toBe("Because a is right.");
  });

  it("limits tries, lets HR grant more, and waits after a fail", async () => {
    const c = await makeCourse({ maxTries: 2, full: 2 });
    const p = await makePerson();
    const asg = await assign(p.id, c);
    await finishModules(p.id, asg);
    for (let i = 0; i < 2; i++) {
      const a = await startExam(p.id, asg);
      await answer(p.id, a, 2);
      await grade(p.id, a);
    }
    expect(await failure(app`select learn.start_exam(${p.id}::uuid, ${asg}::uuid)`)).toMatch(/no_tries_left/);
    await admin`insert into learn.retry_grants (assignment_id, user_id, kind, extra_tries, reason, granted_by) values (${asg}, ${p.id}, 'tries', 1, 'Approved by HR after coaching', ${p.id})`;
    expect(await startExam(p.id, asg)).toBeTruthy();

    const w = await makeCourse({ wait: 60, full: 2 });
    const q = await makePerson();
    const asgW = await assign(q.id, w);
    await finishModules(q.id, asgW);
    const a = await startExam(q.id, asgW);
    await answer(q.id, a, 2);
    await grade(q.id, a);
    expect(await failure(app`select learn.start_exam(${q.id}::uuid, ${asgW}::uuid)`)).toMatch(/wait_after_fail/);
  });

  it("has no deadline at all when the exam sets no time limit, and answers can be saved at any time", async () => {
    const c = await makeCourse({ minutes: null, full: 2 });
    const p = await makePerson();
    const asg = await assign(p.id, c);
    await finishModules(p.id, asg);
    const attempt = await startExam(p.id, asg);
    const [row] = await admin`select deadline_at from learn.exam_attempts where id = ${attempt}`;
    expect(row.deadline_at).toBeNull();
    await answer(p.id, attempt, 0);
    const graded = await grade(p.id, attempt);
    expect(graded.passed).toBe(true);
  });

  it("refuses answers after the deadline, unknown questions and unknown options", async () => {
    const c = await makeCourse({ minutes: 0, full: 2 });
    const p = await makePerson();
    const asg = await assign(p.id, c);
    await finishModules(p.id, asg);
    const attempt = await startExam(p.id, asg);
    const [first] = await items(attempt);
    expect(await failure(app`select learn.save_answer(${p.id}::uuid, ${attempt}::uuid, ${first.question_id}::uuid, ${["a"]}::text[])`)).toMatch(/time_up/);

    const d = await makeCourse({ full: 2 });
    const q = await makePerson();
    const asg2 = await assign(q.id, d);
    await finishModules(q.id, asg2);
    const a2 = await startExam(q.id, asg2);
    const inAttempt = await items(a2);
    const [it] = inAttempt;
    // a question of the same bank that is NOT one of this attempt's
    const outside = d.questionIds.find((id) => !inAttempt.some((i) => i.question_id === id))!;
    expect(await failure(app`select learn.save_answer(${q.id}::uuid, ${a2}::uuid, ${it.question_id}::uuid, ${["zzz"]}::text[])`)).toMatch(/bad_option/);
    expect(await failure(app`select learn.save_answer(${q.id}::uuid, ${a2}::uuid, ${outside}::uuid, ${["a"]}::text[])`)).toMatch(/not_in_attempt|not_found/);
    // the answer can be changed before submitting
    await app`select learn.save_answer(${q.id}::uuid, ${a2}::uuid, ${it.question_id}::uuid, ${["b"]}::text[])`;
    await app`select learn.save_answer(${q.id}::uuid, ${a2}::uuid, ${it.question_id}::uuid, ${["a"]}::text[])`;
    expect((await admin`select selected_ids from learn.exam_answers where attempt_id = ${a2} and question_id = ${it.question_id}`)[0].selected_ids).toEqual(["a"]);
    // someone else cannot grade or read it
    const other = await makePerson();
    expect(await failure(app`select * from learn.grade_attempt(${other.id}::uuid, ${a2}::uuid)`)).toMatch(/not_found/);
  });
});

describe("attestation, certificate and the public check", () => {
  async function passed(first = "Ana", last = "Cruz") {
    const c = await makeCourse({ full: 2 });
    const p = await makePerson(first, last);
    const asg = await assign(p.id, c);
    await finishModules(p.id, asg);
    const attempt = await startExam(p.id, asg);
    await answer(p.id, attempt, 0);
    await grade(p.id, attempt);
    return { p, asg, c };
  }

  it("needs a pass and the right name, then issues one certificate that never changes", async () => {
    const c = await makeCourse({ full: 2 });
    const early = await makePerson();
    const asgEarly = await assign(early.id, c);
    expect(await failure(app`select * from learn.accept_and_certify(${early.id}::uuid, ${asgEarly}::uuid, 'v1', ${early.fullName}, '203.0.113.5', ${["password", "totp"]}::text[])`)).toMatch(/not_passed/);

    const { p, asg } = await passed("Ana", "Cruz");
    expect(await failure(app`select * from learn.accept_and_certify(${p.id}::uuid, ${asg}::uuid, 'v1', 'Someone Else', '203.0.113.5', ${["password"]}::text[])`)).toMatch(/name_mismatch/);
    const cert = (await app`select * from learn.accept_and_certify(${p.id}::uuid, ${asg}::uuid, 'v1', '  ana   CRUZ ', '203.0.113.5', ${["password", "totp"]}::text[])`)[0];
    expect(cert.reference).toMatch(/^(HC|ERSHC|ERSLN)-\d{4}-[A-Z2-9]{6}$/);
    const issued = new Date(`${cert.issued_on instanceof Date ? cert.issued_on.toISOString().slice(0, 10) : cert.issued_on}T00:00:00Z`);
    const ends = new Date(`${cert.ends_on instanceof Date ? cert.ends_on.toISOString().slice(0, 10) : cert.ends_on}T00:00:00Z`);
    expect(ends.getUTCFullYear() - issued.getUTCFullYear()).toBe(1);

    // asking again returns the same certificate and adds nothing
    const again = (await app`select * from learn.accept_and_certify(${p.id}::uuid, ${asg}::uuid, 'v1', ${p.fullName}, null, ${["password"]}::text[])`)[0];
    expect(again.reference).toBe(cert.reference);
    expect((await admin`select count(*)::int as n from learn.attestations where assignment_id = ${asg}`)[0].n).toBe(1);
    expect(await failure(admin`update learn.certificates set holder_name = 'Changed' where reference = ${cert.reference}`)).toMatch(/append-only/);
    expect(await failure(admin`delete from learn.certificates where reference = ${cert.reference}`)).toMatch(/append-only/);
    const att = (await admin`select typed_name, auth_methods, ip from learn.attestations where assignment_id = ${asg}`)[0];
    expect(att.auth_methods).toEqual(["password", "totp"]);
  });

  it("checks a certificate only with both the reference and the full name, and shows revoked", async () => {
    const { p, asg } = await passed("Luz", "Navarro");
    const cert = (await app`select * from learn.accept_and_certify(${p.id}::uuid, ${asg}::uuid, 'v1', 'Luz Navarro', null, ${["password"]}::text[])`)[0];
    const ok = (await app`select * from learn.verify_certificate(${cert.reference}, 'luz  navarro')`)[0];
    expect(ok.status).toBe("valid");
    expect((await app`select * from learn.verify_certificate(${cert.reference}, 'Luz Navarroo')`)[0].status).toBe("not_found");
    expect((await app`select * from learn.verify_certificate('HC-2026-AAAAAA', 'Luz Navarro')`)[0].status).toBe("not_found");
    expect((await app`select * from learn.verify_certificate(${cert.reference}, '')`)[0].status).toBe("not_found");

    const [row] = await admin`select id from learn.certificates where reference = ${cert.reference}`;
    await admin`insert into learn.certificate_revocations (certificate_id, revoked_by, reason) values (${row.id}, ${p.id}, 'Test of revocation')`;
    expect((await app`select * from learn.verify_certificate(${cert.reference}, 'Luz Navarro')`)[0].status).toBe("revoked");
    // the status view carries dates and state, never a score
    const view = await admin`select * from learn.v_status where user_id = ${p.id}`;
    expect(Object.keys(view[0])).not.toContain("score_percent");
    expect(view[0].certificate_revoked).toBe(true);
  });
});

describe("sign-in handoff and sessions", () => {
  it("uses a launch token once, and only before it expires", async () => {
    const p = await makePerson();
    const token = sha(`token-${uniq("t")}`);
    await admin`insert into learn.launch_tokens (token_hash, user_id, auth_methods, expires_at) values (${token}, ${p.id}, ${["password", "totp"]}, now() + interval '60 seconds')`;
    const used = (await app`select * from learn.consume_launch_token(${token})`)[0];
    expect(used.user_id).toBe(p.id);
    expect(used.auth_methods).toEqual(["password", "totp"]);
    expect(await failure(app`select * from learn.consume_launch_token(${token})`)).toMatch(/token_invalid/);

    const expired = sha(`token-${uniq("e")}`);
    await admin`insert into learn.launch_tokens (token_hash, user_id, expires_at) values (${expired}, ${p.id}, now() - interval '1 second')`;
    expect(await failure(app`select * from learn.consume_launch_token(${expired})`)).toMatch(/token_invalid/);
    expect(await failure(app`select * from learn.consume_launch_token(${sha("never-issued")})`)).toMatch(/token_invalid/);
  });

  it("refuses a token for an account that was deactivated", async () => {
    const p = await makePerson();
    const token = sha(`token-${uniq("d")}`);
    await admin`insert into learn.launch_tokens (token_hash, user_id, expires_at) values (${token}, ${p.id}, now() + interval '60 seconds')`;
    await admin`update core.users set archived_at = now() where id = ${p.id}`;
    expect(await failure(app`select * from learn.consume_launch_token(${token})`)).toMatch(/inactive/);
  });

  it("keeps a session until it is idle, ended, expired, or the account is deactivated", async () => {
    const p = await makePerson();
    const hash = sha(`session-${uniq("s")}`);
    await app`select learn.create_session(${p.id}::uuid, ${hash}, ${["password", "totp"]}::text[], 8)`;
    const seen = (await app`select * from learn.resolve_session(${hash}, 30)`)[0];
    expect(seen.user_id).toBe(p.id);
    expect(seen.auth_methods).toEqual(["password", "totp"]);
    expect((await app`select * from learn.resolve_session(${sha("unknown")}, 30)`).length).toBe(0);

    // idle: pretend it was last seen 31 minutes ago
    await admin`update learn.sessions set last_seen_at = now() - interval '31 minutes' where token_hash = ${hash}`;
    expect((await app`select * from learn.resolve_session(${hash}, 30)`).length).toBe(0);
    // once ended it stays ended
    expect((await app`select * from learn.resolve_session(${hash}, 30)`).length).toBe(0);

    const h2 = sha(`session-${uniq("s")}`);
    await app`select learn.create_session(${p.id}::uuid, ${h2}, ${["password"]}::text[], 8)`;
    await app`select learn.end_session(${h2})`;
    expect((await app`select * from learn.resolve_session(${h2}, 30)`).length).toBe(0);

    const h3 = sha(`session-${uniq("s")}`);
    await app`select learn.create_session(${p.id}::uuid, ${h3}, ${["password"]}::text[], 8)`;
    await admin`update core.users set archived_at = now() where id = ${p.id}`;
    expect((await app`select * from learn.resolve_session(${h3}, 30)`).length).toBe(0);
    expect(await failure(app`select learn.create_session(${p.id}::uuid, ${sha("x")}, ${["password"]}::text[], 8)`)).toMatch(/inactive/);
  });
});

beforeAll(async () => {
  // a sanity check that the migration really created what these tests rely on
  const [r] = await admin`select count(*)::int as n from pg_roles where rolname = 'learn_app'`;
  expect(r.n).toBe(1);
});
