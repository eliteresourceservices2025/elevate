import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./global-setup";

// Real-database tests for the graded mock call (docs/learn/14-mock-call.md): the app role never reads the key, steps are recorded in
// order and once, the score and pass mark are computed in the database, tries and wait follow the exam, and an assignment becomes
// "passed" only when the exam AND (when the course requires it) the call are passed.

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
const { loadCourse, assignCourse } = await import("@/modules/learn/publish");
const { handleApi } = await import("../../../learn/src/lib/api");
const { getCallView, getOverview } = await import("../../../learn/src/lib/queries");
const { sessionCookie } = await import("../../../learn/src/lib/cookie");
const { hashValue, newSessionValue } = await import("../../../learn/src/lib/tokens");
const { cybersecurityCourse, cybersecurityQuestions, cybersecurityExamConfig } = await import("../../../learn/src/content/cybersecurity");

afterAll(async () => {
  await app.end();
  await admin.end();
});

let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return "NO ERROR";
}

async function makePerson() {
  const id = randomUUID();
  const email = `${uniq("p")}@example.com`;
  await admin`insert into core.users (id, email) values (${id}, ${email})`;
  await admin`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, start_date) values ('Ana', 'Cruz', ${email}, 'active', ${id}, '2026-01-05')`;
  return id;
}

type Opts = { scenarios?: number; medical?: number; maxTries?: number; wait?: number; requiresCall?: boolean; withCallConfig?: boolean };

/** A published course with a 4-question exam (module m1) and a pool of calls. Each call: two caller steps and a note, 9 points at most. */
async function makeCourse(o: Opts = {}) {
  const [course] = await admin`insert into learn.courses (slug, title, requires_call) values (${uniq("cs-")}, 'Customer service test', ${o.requiresCall ?? true}) returning id`;
  const config = {
    passPercent: 85,
    maxTries: 3,
    waitMinutesAfterFail: 0,
    renewalMonths: 24,
    tracks: { full: { questions: 2 } },
    ...(o.withCallConfig === false ? {} : { call: { passPercent: 85, scenarios: 3, maxTries: o.maxTries ?? 3, waitMinutesAfterFail: o.wait ?? 0 } }),
  };
  const [version] = await admin`insert into learn.course_versions (course_id, version, exam_config, content) values (${course.id}, 1, ${admin.json(config)}, ${admin.json({ title: "Customer service test", attestation: { version: "v1", text: "I will follow the rules." }, modules: [{ key: "m1", summary: "Module one." }] })}) returning id`;
  await admin`insert into learn.version_modules (version_id, module_key, position, title, estimated_minutes, min_seconds, screen_count, tracks) values (${version.id}, 'm1', 1, 'Module one', 1, 20, 1, ${["full"]})`;
  for (let i = 0; i < 3; i++) {
    await admin`insert into learn.questions (version_id, module_key, topic, type, stem, options, correct_ids, rationale)
      values (${version.id}, 'm1', 'topic', 'single', ${`Question ${i}?`}, ${admin.json([{ id: "a", text: "Right" }, { id: "b", text: "Wrong" }, { id: "c", text: "Also wrong" }])}, ${["a"]}, 'Because a is right.')`;
  }
  const n = o.scenarios ?? 5;
  for (let i = 0; i < n; i++) await makeScenario(version.id, `call${i}`, i < (o.medical ?? 2));
  await admin`update learn.course_versions set status = 'published', published_at = now() where id = ${version.id}`;
  return { courseId: course.id as string, versionId: version.id as string };
}

const choice = (id: string, text: string) => ({ id, text });
const pubChoices = [choice("a", "Best reply"), choice("b", "Fair reply"), choice("c", "Harmful reply")];
const keyChoices = (cat: string) => [
  { id: "a", points: 3, mood: 10, reply: `Caller is calmer (${cat})`, why: "Best." },
  { id: "b", points: 1, mood: 0, reply: "Caller is unsure", why: "Fair." },
  { id: "c", points: 0, mood: -20, reply: "Caller is upset", why: "Harmful." },
];

async function makeScenario(versionId: string, key: string, medical: boolean) {
  const steps = [
    { kind: "caller", id: "s1", caller: "Caller says hello", choices: pubChoices },
    { kind: "caller", id: "s2", caller: "Caller asks what happens next", choices: pubChoices },
    { kind: "note", id: "n1", label: "Follow-up", choices: pubChoices },
  ];
  const keySteps = [
    { id: "s1", category: "listening", choices: keyChoices("listening") },
    { id: "s2", category: "resolution", choices: keyChoices("resolution") },
    { id: "n1", category: "documentation", choices: keyChoices("documentation") },
  ];
  const [s] = await admin`insert into learn.call_scenarios (version_id, key, title, module_key, medical, intro, start_mood, record, steps)
    values (${versionId}, ${key}, ${`Call ${key}`}, 'm1', ${medical}, 'An invented caller phones.', 40, ${admin.json({ title: "Customer record", rows: [{ label: "Caller", value: "Maria (invented)" }] })}, ${admin.json(steps)}) returning id`;
  await admin`insert into learn.call_scenario_keys (scenario_id, steps) values (${s.id}, ${admin.json(keySteps)})`;
  return s.id as string;
}

async function assign(userId: string, c: { courseId: string; versionId: string }) {
  const [a] = await admin`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${userId}, ${c.courseId}, ${c.versionId}, 'full', 'new_hire', '2026-12-31') returning id`;
  return a.id as string;
}
async function finishModules(userId: string, asg: string) {
  await app`select learn.open_screen(${userId}::uuid, ${asg}::uuid, 'm1', 0)`;
  await app`select learn.credit_time(${userId}::uuid, ${asg}::uuid, 'm1', 35)`;
  await app`select learn.complete_module(${userId}::uuid, ${asg}::uuid, 'm1')`;
}
async function setup(o: Opts = {}) {
  const c = await makeCourse(o);
  const user = await makePerson();
  const asg = await assign(user, c);
  await finishModules(user, asg);
  return { c, user, asg };
}

const startCall = async (user: string, asg: string) => (await app`select learn.start_call(${user}::uuid, ${asg}::uuid) as id`)[0].id as string;
const answer = async (user: string, attempt: string, scenario: string, step: string, option: string) =>
  (await app`select * from learn.answer_call_step(${user}::uuid, ${attempt}::uuid, ${scenario}::uuid, ${step}, ${option})`)[0];
const gradeCall = async (user: string, attempt: string) => (await app`select * from learn.grade_call(${user}::uuid, ${attempt}::uuid)`)[0];

/** Plays a whole attempt; `pick(n)` gives the option for the n-th step (0-based across all three calls). */
async function play(user: string, attempt: string, pick: (n: number) => string = () => "a") {
  const [row] = await admin`select scenario_ids from learn.call_attempts where id = ${attempt}`;
  let n = 0;
  for (const sid of row.scenario_ids as string[]) {
    const [sc] = await admin`select steps from learn.call_scenarios where id = ${sid}`;
    for (const st of sc.steps as { id: string }[]) await answer(user, attempt, sid, st.id, pick(n++));
  }
}

async function passExam(user: string, asg: string) {
  const [{ id }] = await app`select learn.start_exam(${user}::uuid, ${asg}::uuid) as id`;
  const items = await admin`select i.question_id, q.correct_ids from learn.exam_attempt_items i join learn.questions q on q.id = i.question_id where i.attempt_id = ${id}`;
  for (const it of items) await app`select learn.save_answer(${user}::uuid, ${id}::uuid, ${it.question_id}::uuid, ${it.correct_ids}::text[])`;
  return (await app`select * from learn.grade_attempt(${user}::uuid, ${id}::uuid)`)[0];
}
const statusOf = async (asg: string) => (await admin`select status from learn.assignments where id = ${asg}`)[0].status as string;

describe("what the app role can see", () => {
  it("cannot read the scoring key, and the scenario text carries no points or reasons", async () => {
    const { user, asg } = await setup();
    const attempt = await startCall(user, asg);
    expect(await failure(app`select * from learn.call_scenario_keys`)).toMatch(/permission denied/);
    expect(await failure(app`select steps from learn.call_scenario_keys`)).toMatch(/permission denied/);
    expect(await failure(app`insert into learn.call_attempt_steps (attempt_id, scenario_id, step_id, option_id, points, mood_after) values (${attempt}, ${randomUUID()}, 's1', 'a', 3, 50)`)).toMatch(/permission denied/);

    const seen = await app.begin(async (tx) => {
      await tx`select set_config('learn.user_id', ${user}, true)`;
      return tx`select id, title, medical, intro, start_mood, record, steps from learn.call_scenarios`;
    });
    expect(seen.length).toBe(3); // only the calls of its own attempt
    const text = JSON.stringify(seen);
    expect(text).not.toMatch(/"points"|"mood"|"why"|"reply"|"category"/);
    expect(await failure(app`select * from learn.call_scenarios`)).toMatch(/permission denied/);
    expect(await failure(app`select points from learn.call_attempt_steps`)).toMatch(/permission denied/);
  });
});

describe("starting a call", () => {
  it("needs the modules finished, a configured call and a big enough pool", async () => {
    const c = await makeCourse();
    const user = await makePerson();
    const asg = await assign(user, c);
    expect(await failure(startCall(user, asg))).toMatch(/learn:modules_incomplete/);

    const none = await setup({ withCallConfig: false });
    expect(await failure(startCall(none.user, none.asg))).toMatch(/learn:calls_not_configured/);
    const small = await setup({ scenarios: 2, medical: 1 });
    expect(await failure(startCall(small.user, small.asg))).toMatch(/learn:bank_too_small/);
    const noMedical = await setup({ scenarios: 4, medical: 0 });
    expect(await failure(startCall(noMedical.user, noMedical.asg))).toMatch(/learn:bank_too_small/);
  });

  it("draws three calls with at least one medical, and returns the open attempt on a second start", async () => {
    for (let i = 0; i < 6; i++) {
      const { user, asg } = await setup({ scenarios: 5, medical: 1 });
      const attempt = await startCall(user, asg);
      const [row] = await admin`select a.scenario_ids, (select count(*) from learn.call_scenarios s where s.id = any (a.scenario_ids) and s.medical) as med from learn.call_attempts a where a.id = ${attempt}`;
      expect((row.scenario_ids as string[]).length).toBe(3);
      expect(Number(row.med)).toBeGreaterThanOrEqual(1);
      expect(await startCall(user, asg)).toBe(attempt);
    }
  });

  it("does not start another person's call", async () => {
    const { asg } = await setup();
    const other = await makePerson();
    expect(await failure(startCall(other, asg))).toMatch(/learn:not_found/);
  });
});

describe("answering steps", () => {
  it("returns only the reply, the mood and the finished flags, and moves the mood", async () => {
    const { user, asg } = await setup();
    const attempt = await startCall(user, asg);
    const [{ scenario_ids }] = await admin`select scenario_ids from learn.call_attempts where id = ${attempt}`;
    const first = (scenario_ids as string[])[0];
    const r = await answer(user, attempt, first, "s1", "a");
    expect(Object.keys(r).sort()).toEqual(["attempt_done", "call_done", "mood", "reply"]);
    expect(r.mood).toBe(50); // 40 + 10
    expect(r.call_done).toBe(false);
    expect(r.attempt_done).toBe(false);
    const r2 = await answer(user, attempt, first, "s2", "c");
    expect(r2.mood).toBe(30); // 50 - 20
    const r3 = await answer(user, attempt, first, "n1", "b");
    expect(r3.call_done).toBe(true);
    expect(r3.attempt_done).toBe(false);
  });

  it("refuses a repeat, a step out of order, a call not in the attempt, another person and an unknown option", async () => {
    const { user, asg } = await setup();
    const attempt = await startCall(user, asg);
    const [{ scenario_ids }] = await admin`select scenario_ids from learn.call_attempts where id = ${attempt}`;
    const [first, second] = scenario_ids as string[];
    expect(await failure(answer(user, attempt, first, "s2", "a"))).toMatch(/learn:step_out_of_order/);
    expect(await failure(answer(user, attempt, second, "s1", "a"))).toMatch(/learn:step_out_of_order/);
    await answer(user, attempt, first, "s1", "a");
    expect(await failure(answer(user, attempt, first, "s1", "a"))).toMatch(/learn:step_out_of_order/);
    expect(await failure(answer(user, attempt, first, "s2", "z"))).toMatch(/learn:bad_option/);
    expect(await failure(answer(user, attempt, randomUUID(), "s1", "a"))).toMatch(/learn:step_out_of_order/);
    expect(await failure(answer(await makePerson(), attempt, first, "s2", "a"))).toMatch(/learn:not_found/);
    expect((await admin`select count(*)::int as n from learn.call_attempt_steps where attempt_id = ${attempt}`)[0].n).toBe(1);
  });

  it("keeps picks final: no update or delete, even by the owner role's triggers", async () => {
    const { user, asg } = await setup();
    const attempt = await startCall(user, asg);
    const [{ scenario_ids }] = await admin`select scenario_ids from learn.call_attempts where id = ${attempt}`;
    await answer(user, attempt, (scenario_ids as string[])[0], "s1", "a");
    expect(await failure(admin`update learn.call_attempt_steps set points = 0 where attempt_id = ${attempt}`)).toMatch(/append-only/);
    expect(await failure(admin`delete from learn.call_attempt_steps where attempt_id = ${attempt}`)).toMatch(/append-only/);
  });
});

describe("grading", () => {
  it("scores 100 for all best replies and the category scores are percentages", async () => {
    const { user, asg } = await setup();
    const attempt = await startCall(user, asg);
    await play(user, attempt, () => "a");
    const g = await gradeCall(user, attempt);
    expect(Number(g.score_percent)).toBe(100);
    expect(g.passed).toBe(true);
    expect(g.categories).toEqual({ listening: 100, resolution: 100, documentation: 100 });
  });

  it("fails all harmful replies and passes exactly at the 85% line (23 of 27 points)", async () => {
    const zero = await setup();
    const a0 = await startCall(zero.user, zero.asg);
    await play(zero.user, a0, () => "c");
    const g0 = await gradeCall(zero.user, a0);
    expect(Number(g0.score_percent)).toBe(0);
    expect(g0.passed).toBe(false);

    const pass = await setup(); // two "fair" replies lose 4 points: 23 of 27 = 85.19%
    const ap = await startCall(pass.user, pass.asg);
    await play(pass.user, ap, (n) => (n === 0 || n === 1 ? "b" : "a"));
    const gp = await gradeCall(pass.user, ap);
    expect(Number(gp.score_percent)).toBe(85.19);
    expect(gp.passed).toBe(true);

    const fail = await setup(); // a harmful and a fair reply lose 5 points: 22 of 27 = 81.48%
    const af = await startCall(fail.user, fail.asg);
    await play(fail.user, af, (n) => (n === 0 ? "c" : n === 1 ? "b" : "a"));
    const gf = await gradeCall(fail.user, af);
    expect(Number(gf.score_percent)).toBe(81.48);
    expect(gf.passed).toBe(false);
  });

  it("refuses to grade an unfinished attempt, and grading twice returns the stored result", async () => {
    const { user, asg } = await setup();
    const attempt = await startCall(user, asg);
    expect(await failure(gradeCall(user, attempt))).toMatch(/learn:call_unfinished/);
    await play(user, attempt, () => "a");
    const g1 = await gradeCall(user, attempt);
    await admin`select 1`;
    const g2 = await gradeCall(user, attempt);
    expect(g2.score_percent).toBe(g1.score_percent);
    expect(g2.passed).toBe(g1.passed);
    expect((await admin`select count(*)::int as n from learn.call_attempts where assignment_id = ${asg} and status = 'submitted'`)[0].n).toBe(1);
    expect(await failure(answer(user, attempt, randomUUID(), "s1", "a"))).toMatch(/learn:already_submitted|learn:step_out_of_order/);
  });

  it("allows only another person's grading call to fail with not_found", async () => {
    const { user, asg } = await setup();
    const attempt = await startCall(user, asg);
    await play(user, attempt);
    expect(await failure(gradeCall(await makePerson(), attempt))).toMatch(/learn:not_found/);
  });
});

describe("tries and waiting", () => {
  it("allows the configured number of tries, then no more, and then a grant adds one", async () => {
    const { user, asg } = await setup({ maxTries: 1 });
    const a1 = await startCall(user, asg);
    await play(user, a1, () => "c");
    await gradeCall(user, a1);
    expect(await failure(startCall(user, asg))).toMatch(/learn:no_tries_left/);
    await admin`insert into learn.retry_grants (assignment_id, user_id, kind, extra_tries, reason, granted_by) values (${asg}, ${user}, 'tries', 1, 'test', ${user})`;
    const a2 = await startCall(user, asg);
    expect(a2).not.toBe(a1);
  });

  it("makes a person wait after a failed try", async () => {
    const { user, asg } = await setup({ wait: 60 });
    const a1 = await startCall(user, asg);
    await play(user, a1, () => "c");
    await gradeCall(user, a1);
    expect(await failure(startCall(user, asg))).toMatch(/learn:wait_after_fail/);
  });
});

describe("the review", () => {
  it("shows nothing after a failed attempt and every step with the best reply and the reason after a pass", async () => {
    const failed = await setup();
    const af = await startCall(failed.user, failed.asg);
    await play(failed.user, af, () => "c");
    await gradeCall(failed.user, af);
    expect((await app`select * from learn.call_review(${failed.user}::uuid, ${af}::uuid)`).length).toBe(0);

    const ok = await setup();
    const ap = await startCall(ok.user, ok.asg);
    await play(ok.user, ap, (n) => (n === 0 ? "b" : "a"));
    await gradeCall(ok.user, ap);
    const rows = await app`select * from learn.call_review(${ok.user}::uuid, ${ap}::uuid)`;
    expect(rows.length).toBe(9);
    expect(rows[0].chosen).toBe("b");
    expect(rows[0].best).toBe("a");
    expect(rows[0].points).toBe(1);
    expect(rows[0].max_points).toBe(3);
    expect(rows[0].why).toBe("Best.");
    expect(await failure(app`select * from learn.call_review(${await makePerson()}::uuid, ${ap}::uuid)`)).toMatch(/learn:not_found/);
  });
});

describe("when an assignment counts as passed", () => {
  it("needs both: exam then call", async () => {
    const { user, asg } = await setup();
    expect((await passExam(user, asg)).passed).toBe(true);
    expect(await statusOf(asg)).not.toBe("passed");
    const attempt = await startCall(user, asg);
    await play(user, attempt);
    await gradeCall(user, attempt);
    expect(await statusOf(asg)).toBe("passed");
  });

  it("needs both: call then exam", async () => {
    const { user, asg } = await setup();
    const attempt = await startCall(user, asg);
    await play(user, attempt);
    await gradeCall(user, attempt);
    expect(await statusOf(asg)).not.toBe("passed");
    expect((await passExam(user, asg)).passed).toBe(true);
    expect(await statusOf(asg)).toBe("passed");
  });

  it("is not passed by a failed call, and a course without a call still passes on the exam alone", async () => {
    const { user, asg } = await setup();
    await passExam(user, asg);
    const attempt = await startCall(user, asg);
    await play(user, attempt, () => "c");
    await gradeCall(user, attempt);
    expect(await statusOf(asg)).not.toBe("passed");

    const plain = await setup({ requiresCall: false });
    await passExam(plain.user, plain.asg);
    expect(await statusOf(plain.asg)).toBe("passed");
  });
});

describe("publishing calls with a course version", () => {
  type Seed = import("../../../learn/src/content/schema").CallSeed;
  const moduleKey = cybersecurityCourse.modules[0].key;
  const ch = (id: "a" | "b" | "c", points: number) => ({ id, text: `Reply ${id}`, points, mood: points * 5 - 5, reply: `Answer ${id}`, why: `Because ${id}.` });
  const seed = (key: string, medical: boolean): Seed => ({
    key,
    title: `Call ${key}`,
    moduleKey,
    medical,
    intro: "An invented caller phones.",
    startMood: 40,
    steps: [
      { kind: "caller", id: "s1", caller: "Hello, I need an update.", category: "opening", choices: [ch("a", 3), ch("b", 1), ch("c", 0)] },
      { kind: "note", id: "n1", label: "Follow-up", choices: [ch("a", 3), ch("b", 0)] },
    ],
  });
  const pool = ["one", "two", "three"].map((k, i) => seed(k, i === 0));
  const examConfig = { ...(cybersecurityExamConfig as object), call: { passPercent: 85, scenarios: 3, maxTries: 3, waitMinutesAfterFail: 60 } };
  const course = (slug: string, calls?: Seed[]) => ({ slug, content: cybersecurityCourse, questions: cybersecurityQuestions, examConfig, calls });

  it("writes the public text and the key apart, marks the course as needing a call, and keeps the key out of the text", async () => {
    const slug = uniq("cs-pub-");
    const r = await loadCourse(admin as never, { course: course(slug, pool) });
    expect(r.calls).toBe(3);
    const [c] = await admin`select requires_call from learn.courses where slug = ${slug}`;
    expect(c.requires_call).toBe(true);
    const scenarios = await admin`select s.id, s.steps, s.medical, k.steps as key_steps, s.start_mood from learn.call_scenarios s join learn.call_scenario_keys k on k.scenario_id = s.id where s.version_id = ${r.versionId} order by s.key`;
    expect(scenarios.length).toBe(3);
    expect(JSON.stringify(scenarios[0].steps)).not.toMatch(/points|mood|why|reply|category/);
    expect(scenarios[0].steps[1]).toMatchObject({ kind: "note", id: "n1", label: "Follow-up" });
    expect(scenarios[0].key_steps.map((s: { category: string }) => s.category)).toEqual(["opening", "documentation"]);
    expect(scenarios[0].key_steps[0].choices[0]).toMatchObject({ id: "a", points: 3, reply: "Answer a" });
    expect(scenarios[0].start_mood).toBe(40);
    expect(scenarios.map((s) => s.medical)).toEqual([true, false, false]);
  });

  it("refuses bad call content before writing anything", async () => {
    const slug = uniq("cs-bad-");
    const bad = [seed("dup", true), seed("dup", true), seed("x", false)];
    await expect(loadCourse(admin as never, { course: course(slug, bad) })).rejects.toThrow(/call/i);
    expect((await admin`select count(*)::int as n from learn.courses where slug = ${slug}`)[0].n).toBe(0);
  });

  it("loads a course with no calls exactly as before", async () => {
    const slug = uniq("cs-none-");
    const r = await loadCourse(admin as never, { course: course(slug) });
    expect(r.calls).toBe(0);
    expect((await admin`select requires_call from learn.courses where slug = ${slug}`)[0].requires_call).toBe(false);
  });

  it("brings a draft's calls up to date, and freezes them once published", async () => {
    const slug = uniq("cs-frozen-");
    const r1 = await loadCourse(admin as never, { course: course(slug, pool) });
    const edited = pool.map((c, i) => (i === 0 ? { ...c, title: "Edited title" } : c));
    const r2 = await loadCourse(admin as never, { course: course(slug, edited) });
    expect(r2.versionId).toBe(r1.versionId);
    const titles = await admin`select title from learn.call_scenarios where version_id = ${r1.versionId} order by key`;
    expect(titles.map((t) => t.title)).toEqual(["Edited title", "Call three", "Call two"]);
    expect(titles.length).toBe(3);

    const reviewer = await makePerson();
    await loadCourse(admin as never, { course: course(slug, edited), publish: true, reviewerUserId: reviewer, counselApprovedOn: "2026-11-01", actorUserId: reviewer });
    expect(await failure(admin`delete from learn.call_scenario_keys where scenario_id in (select id from learn.call_scenarios where version_id = ${r1.versionId})`)).toMatch(/frozen/);
    expect(await failure(admin`update learn.call_scenarios set title = 'x' where version_id = ${r1.versionId}`)).toMatch(/frozen/);
  });
});

// ---- The Learn app's own endpoints and views ----------------------------------------------------------------------------------
const deps = { sql: app, elevateOrigin: "https://elevate.example.com", production: true, allow: async () => true, allowUser: async () => true };
async function signIn(userId: string) {
  const value = newSessionValue();
  await app`select learn.create_session(${userId}::uuid, ${hashValue(value)}, ${["password", "totp"]}::text[], 8)`;
  return sessionCookie(value, true).split(";")[0];
}
async function api(cookie: string | null, action: string, body: Record<string, unknown>) {
  const headers: Record<string, string> = { "content-type": "application/json", "sec-fetch-site": "same-origin", host: "learn.example.com" };
  if (cookie) headers.cookie = cookie;
  const res = await handleApi(new Request(`https://learn.example.com/api/${action}`, { method: "POST", body: JSON.stringify(body), headers }), action, deps);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
const KEY_FIELDS = /"(points|best|why|correct|correctIds|category|rationale)"/;

describe("the call endpoints and views", () => {
  it("runs a whole call through the API without ever returning the key", async () => {
    const { user, asg } = await setup();
    const cookie = await signIn(user);
    const seen: unknown[] = [];

    const started = await api(cookie, "startCall", { assignmentId: asg });
    seen.push(started.body);
    expect(started.status).toBe(200);
    const attemptId = started.body.attemptId as string;

    const view = (await getCallView(app, user, attemptId))!;
    seen.push(view);
    expect(view.status).toBe("in_progress");
    expect(view.scenarios.length).toBe(3);
    expect(view.scenarios[0].steps[0]).toMatchObject({ kind: "caller", text: "Caller says hello" });
    expect(view.scenarios[0].steps[0].choices.map((c) => c.text)).toEqual(["Best reply", "Fair reply", "Harmful reply"]);
    expect(view.scenarios[0].startMood).toBe(40);
    expect(view.result).toBeNull();
    expect(view.review).toEqual([]);

    let last: Record<string, unknown> = {};
    for (const sc of view.scenarios) {
      for (const st of sc.steps) {
        const r = await api(cookie, "answerCall", { attemptId, scenarioId: sc.id, stepId: st.id, optionId: "a" });
        seen.push(r.body);
        expect(r.status).toBe(200);
        expect(Object.keys(r.body).sort()).toEqual(["attemptDone", "callDone", "mood", "ok", "reply", "replyAudio"]);
        // the only new field is a hashed clip name (or null): never the points or the best reply
        expect(r.body.replyAudio === null || /^\/api\/voice\/v-[0-9a-f]{24}\.m4a$/.test(String(r.body.replyAudio))).toBe(true);
        last = r.body;
      }
    }
    expect(last.attemptDone).toBe(true);

    const resumed = (await getCallView(app, user, attemptId))!;
    expect(resumed.scenarios[0].answered.map((a) => a.stepId)).toEqual(["s1", "s2", "n1"]);
    seen.push(resumed);

    const done = await api(cookie, "submitCall", { attemptId });
    seen.push(done.body);
    expect(done.body).toMatchObject({ ok: true, scorePercent: 100, passed: true, categories: { listening: 100, resolution: 100, documentation: 100 } });

    const after = (await getCallView(app, user, attemptId))!;
    expect(after.status).toBe("submitted");
    expect(after.result).toMatchObject({ scorePercent: 100, passed: true });
    expect(after.review.length).toBe(9);
    // the key fields appear only in the review of a PASSED attempt, never in anything before it
    for (const body of seen) expect(JSON.stringify(body)).not.toMatch(KEY_FIELDS);
  });

  it("shows a failed attempt with the category percentages and no review", async () => {
    const { user, asg } = await setup();
    const cookie = await signIn(user);
    const attemptId = (await api(cookie, "startCall", { assignmentId: asg })).body.attemptId as string;
    const view = (await getCallView(app, user, attemptId))!;
    for (const sc of view.scenarios) for (const st of sc.steps) await api(cookie, "answerCall", { attemptId, scenarioId: sc.id, stepId: st.id, optionId: "c" });
    const done = await api(cookie, "submitCall", { attemptId });
    expect(done.body).toMatchObject({ ok: true, passed: false, scorePercent: 0 });
    const after = (await getCallView(app, user, attemptId))!;
    expect(after.result).toMatchObject({ passed: false, categories: { listening: 0, resolution: 0, documentation: 0 } });
    expect(after.review).toEqual([]);
    expect(JSON.stringify(after)).not.toMatch(KEY_FIELDS);
  });

  it("refuses without a session, for another person, for bad input, and tells how long to wait", async () => {
    const { user, asg } = await setup({ wait: 60 });
    expect((await api(null, "startCall", { assignmentId: asg })).status).toBe(401);
    const cookie = await signIn(user);
    expect((await api(cookie, "startCall", { assignmentId: "nope" })).status).toBe(400);
    const attemptId = (await api(cookie, "startCall", { assignmentId: asg })).body.attemptId as string;
    const intruder = await signIn(await makePerson());
    expect((await api(intruder, "answerCall", { attemptId, scenarioId: randomUUID(), stepId: "s1", optionId: "a" })).status).toBe(404);
    expect(await getCallView(app, await makePerson(), attemptId)).toBeNull();

    const view = (await getCallView(app, user, attemptId))!;
    for (const sc of view.scenarios) for (const st of sc.steps) await api(cookie, "answerCall", { attemptId, scenarioId: sc.id, stepId: st.id, optionId: "c" });
    await api(cookie, "submitCall", { attemptId });
    const again = await api(cookie, "startCall", { assignmentId: asg });
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ ok: false, code: "wait_after_fail" });
    expect(typeof again.body.retryAt).toBe("string");
  });

  it("adds the call to the course overview only when the course requires one", async () => {
    const { user, asg } = await setup();
    const o = (await getOverview(app, user, asg))!;
    expect(o.call).toMatchObject({ scenarios: 3, passPercent: 85, triesAllowed: 3, attempts: [], openAttemptId: null, waitMinutes: 0 });
    const plain = await setup({ requiresCall: false });
    expect((await getOverview(app, plain.user, plain.asg))!.call).toBeNull();
  });
});

describe("the real Customer Service course", () => {
  it("publishes with its modules, exam bank and five calls, and can be taken from start to certificate-ready", async () => {
    const reviewer = await makePerson();
    const r = await loadCourse(admin as never, { courseSlug: "customer-service", publish: true, reviewerUserId: reviewer, counselApprovedOn: "2026-11-01", actorUserId: reviewer });
    expect(r).toMatchObject({ modules: 11, questions: 88, calls: 5, status: "published" });
    expect((await admin`select requires_call from learn.courses where id = ${r.courseId}`)[0].requires_call).toBe(true);

    const user = await makePerson();
    const { assignmentId } = await assignCourse(admin as never, { userId: user, track: "full", courseSlug: "customer-service" });
    for (const m of ["excellence", "communication", "channels", "listening", "confidentiality", "healthcare", "difficult", "personalities", "bad_news", "resolution", "resilience"]) {
      await admin`insert into learn.module_completions (assignment_id, user_id, module_key) values (${assignmentId}, ${user}, ${m})`;
    }

    await admin`update learn.assignments set status = 'in_progress' where id = ${assignmentId}`; // what finishing a module does in the real flow
    // the exam: 25 questions from the bank of 88
    const [{ id: examId }] = await app`select learn.start_exam(${user}::uuid, ${assignmentId}::uuid) as id`;
    expect((await admin`select count(*)::int as n from learn.exam_attempt_items where attempt_id = ${examId}`)[0].n).toBe(25);
    const items = await admin`select i.question_id, q.correct_ids from learn.exam_attempt_items i join learn.questions q on q.id = i.question_id where i.attempt_id = ${examId}`;
    for (const it of items) await app`select learn.save_answer(${user}::uuid, ${examId}::uuid, ${it.question_id}::uuid, ${it.correct_ids}::text[])`;
    expect((await app`select * from learn.grade_attempt(${user}::uuid, ${examId}::uuid)`)[0].passed).toBe(true);
    expect(await statusOf(assignmentId)).not.toBe("passed"); // the call is still to do

    // the call: three of the five, at least one medical, best replies pass at 100%
    const attempt = await startCall(user, assignmentId);
    const [row] = await admin`select a.scenario_ids, (select count(*) from learn.call_scenarios s where s.id = any (a.scenario_ids) and s.medical)::int as med from learn.call_attempts a where a.id = ${attempt}`;
    expect((row.scenario_ids as string[]).length).toBe(3);
    expect(row.med).toBeGreaterThanOrEqual(1);
    for (const sid of row.scenario_ids as string[]) {
      const [k] = await admin`select steps from learn.call_scenario_keys where scenario_id = ${sid}`;
      for (const st of k.steps as { id: string; choices: { id: string; points: number }[] }[]) {
        const best = st.choices.find((c) => c.points === 3)!.id;
        await answer(user, attempt, sid, st.id, best);
      }
    }
    const g = await gradeCall(user, attempt);
    expect(Number(g.score_percent)).toBe(100);
    expect(g.passed).toBe(true);
    expect(Object.keys(g.categories as object).sort()).toEqual(expect.arrayContaining(["accuracy", "documentation", "resolution"]));
    expect(await statusOf(assignmentId)).toBe("passed");
  });
});
