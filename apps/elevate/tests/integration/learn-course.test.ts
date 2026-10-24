import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./global-setup";

// The real HIPAA course against the real database: loading it as a draft and publishing it (with the review gate), assigning it, and
// a learner going through every call the Learn app makes (screens, time, completing modules, the exam, the attestation and the
// certificate, the public check), through Learn's real request handlers and the restricted learn_app role.

const APP_PASSWORD = "learn-app-test-password-not-a-secret";
const adminUrl = process.env.TEST_DB_ADMIN_URL!;
const LEARN = "https://learn.example.com";

const admin = postgres(testDatabaseUrl(adminUrl), { max: 2, onnotice: () => {} });
await admin.unsafe(`alter role learn_app login password '${APP_PASSWORD}'`);
const appUrl = new URL(testDatabaseUrl(adminUrl));
appUrl.username = "learn_app";
appUrl.password = APP_PASSWORD;
const app = postgres(appUrl.toString(), { max: 2, onnotice: () => {}, prepare: false });

const { loadCourse, assignCourse } = await import("@/modules/learn/publish");
const { handleApi, handleVerify } = await import("../../../learn/src/lib/api");
const { getOverview, getModuleView, getAttemptView, getRecord } = await import("../../../learn/src/lib/queries");
const { collectMyData } = await import("@/modules/privacy/service");
const { hipaaCourse, hipaaQuestions } = await import("../../../learn/src/content/hipaa");
const { cybersecurityCourse } = await import("../../../learn/src/content/cybersecurity");
const { sessionCookie } = await import("../../../learn/src/lib/cookie");
const { hashValue, newSessionValue } = await import("../../../learn/src/lib/tokens");
const { handleCertificateDownload } = await import("../../../learn/src/lib/certificate-download");

afterAll(async () => {
  await app.end();
  await admin.end();
});

let counter = 0;
async function makePerson(first = "Ana", last = "Cruz") {
  const id = randomUUID();
  const email = `course${Date.now().toString(36)}${counter++}@example.com`;
  await admin`insert into core.users (id, email) values (${id}, ${email})`;
  await admin`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, start_date) values (${first}, ${last}, ${email}, 'active', ${id}, '2026-01-05')`;
  return { id, email, fullName: `${first} ${last}` };
}

const deps = { sql: app, elevateOrigin: "https://elevate.example.com", production: true, allow: async () => true, allowUser: async () => true };

async function signIn(userId: string) {
  const value = newSessionValue();
  await app`select learn.create_session(${userId}::uuid, ${hashValue(value)}, ${["password", "totp"]}::text[], 8)`;
  return sessionCookie(value, true).split(";")[0];
}

async function call(cookie: string, action: string, body: Record<string, unknown>) {
  const res = await handleApi(
    new Request(`${LEARN}/api/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { cookie, "content-type": "application/json", "sec-fetch-site": "same-origin", host: "learn.example.com" },
    }),
    action,
    deps,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

let published: { versionId: string; courseId: string };
let reviewer: { id: string; email: string };

describe("loading and publishing the HIPAA course", () => {
  it("saves it as a draft first, and repeating changes nothing", async () => {
    const first = await loadCourse(admin, { newVersion: true });
    expect(first.status).toBe("draft");
    expect(first.modules).toBe(hipaaCourse.modules.length);
    expect(first.questions).toBe(hipaaQuestions.length);
    const [{ n: modules }] = await admin`select count(*)::int as n from learn.version_modules where version_id = ${first.versionId}`;
    const [{ n: questions }] = await admin`select count(*)::int as n from learn.questions where version_id = ${first.versionId}`;
    expect(modules).toBe(hipaaCourse.modules.length);
    expect(questions).toBe(hipaaQuestions.length);

    const again = await loadCourse(admin);
    expect(again.versionId).toBe(first.versionId);
    expect(again.created).toBe(false);
  });

  it("sets each module's minimum time to 40% of its estimate, with the tracks that include it", async () => {
    const [v] = await admin`select v.id from learn.course_versions v join learn.courses c on c.id = v.course_id where c.slug = 'hipaa' order by v.version desc limit 1`;
    const rows = await admin`select module_key, estimated_minutes, min_seconds, screen_count, tracks from learn.version_modules where version_id = ${v.id} order by position`;
    for (const r of rows) expect(r.min_seconds).toBe(Math.round((r.estimated_minutes as number) * 60 * 0.4));
    expect(rows.find((r) => r.module_key === "security")!.tracks).toEqual(["full"]);
    expect(rows.find((r) => r.module_key === "incidents")!.tracks).toEqual(["full", "essentials", "refresher"]);
    const modules = hipaaCourse.modules;
    expect(rows.map((r) => r.screen_count)).toEqual(modules.map((m) => m.screens.length));
  });

  it("will not publish without a named reviewer and counsel's date", async () => {
    await expect(loadCourse(admin, { publish: true })).rejects.toThrow(/reviewer/);
    reviewer = { id: randomUUID(), email: `reviewer${Date.now()}@example.com` };
    await admin`insert into core.users (id, email) values (${reviewer.id}, ${reviewer.email})`;
    await expect(loadCourse(admin, { publish: true, reviewerUserId: reviewer.id })).rejects.toThrow(/counsel/);
    await expect(loadCourse(admin, { publish: true, reviewerUserId: reviewer.id, counselApprovedOn: "soon" })).rejects.toThrow(/counsel/);
  });

  it("publishes with both, freezes the version, and refuses a second publication of different content as an in-place edit", async () => {
    const r = await loadCourse(admin, { publish: true, reviewerUserId: reviewer.id, counselApprovedOn: "2026-11-01", actorUserId: reviewer.id });
    expect(r.status).toBe("published");
    published = { versionId: r.versionId, courseId: r.courseId };
    const [v] = await admin`select status, reviewed_by, counsel_approved_on::text as counsel, published_at from learn.course_versions where id = ${r.versionId}`;
    expect(v.status).toBe("published");
    expect(v.reviewed_by).toBe(reviewer.id);
    expect(v.counsel).toBe("2026-11-01");
    await expect(admin`update learn.questions set stem = 'A changed question stem?' where version_id = ${r.versionId}`).rejects.toThrow(/frozen/);
    // loading the same content again leaves it published
    const same = await loadCourse(admin);
    expect(same.versionId).toBe(r.versionId);
    expect(same.status).toBe("published");
  });
});

describe("the separate cybersecurity course", () => {
  it("loads as its own course with its own modules, and is assigned apart from the HIPAA course", async () => {
    const r = await loadCourse(admin, { courseSlug: "cybersecurity", newVersion: true });
    expect(r.status).toBe("draft");
    expect(r.modules).toBe(10);
    const [{ slug }] = await admin`select c.slug from learn.courses c where c.id = ${r.courseId}`;
    expect(slug).toBe("cybersecurity");
    const keys = await admin`select module_key from learn.version_modules where version_id = ${r.versionId} order by position`;
    expect(keys.map((k) => k.module_key)).toEqual(["why", "passwords", "phishing", "malware", "browsing", "ai_tools", "devices", "physical", "response", "security_hipaa"]);

    await expect(loadCourse(admin, { courseSlug: "nope" })).rejects.toThrow(/Unknown course/);
    const done = await loadCourse(admin, { courseSlug: "cybersecurity", publish: true, reviewerUserId: reviewer.id, counselApprovedOn: "2026-11-01" });
    expect(done.status).toBe("published");

    const p = await makePerson();
    const hipaa = await assignCourse(admin, { userId: p.id, track: "full" });
    const cyber = await assignCourse(admin, { userId: p.id, track: "full", courseSlug: "cybersecurity" });
    expect(cyber.assignmentId).not.toBe(hipaa.assignmentId);
    expect(cyber.created).toBe(true);

    // The certificate reference carries the course's own code: ERSCSC for Cybersecurity basics.
    await admin`update learn.assignments set status = 'in_progress' where id = ${cyber.assignmentId}`;
    await admin`update learn.assignments set status = 'passed', passed_at = now() where id = ${cyber.assignmentId}`;
    const accepted = await call(await signIn(p.id), "accept", { assignmentId: cyber.assignmentId, statementVersion: cybersecurityCourse.attestation.version, typedName: p.fullName });
    expect(accepted.status).toBe(200);
    expect(accepted.body.reference as string).toMatch(/^ERSCSC-\d{4}-[A-Z2-9]{6}$/);
  });

  it("corrects a wrong counsel date with a new version of the same content, retiring the old one", async () => {
    const before = await loadCourse(admin, { courseSlug: "cybersecurity" });
    expect(before.status).toBe("published");
    // The same content does nothing by itself (a published version is frozen)...
    const same = await loadCourse(admin, { courseSlug: "cybersecurity", publish: true, reviewerUserId: reviewer.id, counselApprovedOn: "2025-11-01" });
    expect(same.versionId).toBe(before.versionId);
    const [still] = await admin`select counsel_approved_on::text as counsel from learn.course_versions where id = ${before.versionId}`;
    expect(still.counsel).toBe("2026-11-01");
    // ...a new version carries the corrected date and retires the old one.
    const fixed = await loadCourse(admin, { courseSlug: "cybersecurity", publish: true, newVersion: true, reviewerUserId: reviewer.id, counselApprovedOn: "2026-10-13", actorUserId: reviewer.id });
    expect(fixed.created).toBe(true);
    expect(fixed.version).toBe(before.version + 1);
    expect(fixed.status).toBe("published");
    const rows = await admin`select version, status, counsel_approved_on::text as counsel from learn.course_versions where course_id = ${fixed.courseId} and version >= ${before.version} order by version`;
    expect(rows.map((r) => [r.version, r.status])).toEqual([[before.version, "retired"], [fixed.version, "published"]]);
    expect(rows.at(-1)!.counsel).toBe("2026-10-13");
  });
});

describe("assigning the course", () => {
  it("gives one open assignment per person, and asking again returns it", async () => {
    const p = await makePerson();
    const a = await assignCourse(admin, { userId: p.id, track: "full" });
    expect(a.created).toBe(true);
    const b = await assignCourse(admin, { userId: p.id, track: "full" });
    expect(b.created).toBe(false);
    expect(b.assignmentId).toBe(a.assignmentId);
  });
});

describe("a learner going through the course", () => {
  it("heartbeats count only what the server allows, modules complete in order, and the exam, certificate and check follow", async () => {
    const p = await makePerson("Lia", "Santos");
    const { assignmentId } = await assignCourse(admin, { userId: p.id, track: "full" });
    const cookie = await signIn(p.id);

    // The overview: 7 modules, only the first open, the exam locked.
    const overview = await getOverview(app, p.id, assignmentId);
    expect(overview!.modules.map((m) => m.locked)).toEqual(hipaaCourse.modules.map((_, i) => i > 0));
    expect(overview!.exam).toMatchObject({ questions: 20, minutes: null, passPercent: 80, triesAllowed: 3 });
    expect(await getModuleView(app, p.id, assignmentId, "phi")).toBeNull(); // locked

    // Out of order and unknown things are refused.
    expect((await call(cookie, "screen", { assignmentId, moduleKey: "phi", screen: 0 })).body.code).toBe("module_locked");
    expect((await call(cookie, "complete", { assignmentId, moduleKey: "foundations" })).body.code).toBe("screens_missing");

    // The heartbeat: asking for more than 35 seconds is capped; the next one straight away counts for nothing.
    const first = hipaaCourse.modules[0];
    await call(cookie, "screen", { assignmentId, moduleKey: first.key, screen: 0 });
    const beat = await call(cookie, "time", { assignmentId, moduleKey: first.key, seconds: 120 });
    expect(beat.body.credited).toBe(35);
    expect(beat.body.totalSeconds).toBe(35);
    expect((await call(cookie, "time", { assignmentId, moduleKey: first.key, seconds: 30 })).body.credited).toBe(0);

    // Not enough screens, then not enough time.
    for (let s = 1; s < first.screens.length - 1; s++) await call(cookie, "screen", { assignmentId, moduleKey: first.key, screen: s });
    expect((await call(cookie, "complete", { assignmentId, moduleKey: first.key })).body.code).toBe("screens_missing");
    await call(cookie, "screen", { assignmentId, moduleKey: first.key, screen: first.screens.length - 1 });
    const early = await call(cookie, "complete", { assignmentId, moduleKey: first.key });
    expect(early.body.code).toBe("time_missing");
    expect(early.body.remainingSeconds).toBe(Math.round(first.estimatedMinutes * 60 * 0.4) - 35);

    // The exam stays locked until every module is done.
    expect((await call(cookie, "startExam", { assignmentId })).body.code).toBe("modules_incomplete");

    // Do the whole course. (The real minimum times are minutes long, so the time is added as the database would have, directly.)
    for (const m of hipaaCourse.modules) {
      for (let s = 0; s < m.screens.length; s++) {
        const r = await call(cookie, "screen", { assignmentId, moduleKey: m.key, screen: s });
        expect(r.status, `${m.key} screen ${s}`).toBe(200);
      }
      const need = Math.round(m.estimatedMinutes * 60 * 0.4);
      await admin`
        insert into learn.module_time (assignment_id, user_id, module_key, day, seconds) values (${assignmentId}, ${p.id}, ${m.key}, '2026-10-20', ${need})
        on conflict (assignment_id, module_key, day) do update set seconds = excluded.seconds`;
      const done = await call(cookie, "complete", { assignmentId, moduleKey: m.key });
      expect(done.status, `${m.key} complete`).toBe(200);
    }
    const after = await getOverview(app, p.id, assignmentId);
    expect(after!.allModulesDone).toBe(true);

    // The exam: 20 questions, spread across the modules, with no answer key in anything the page receives.
    const start = await call(cookie, "startExam", { assignmentId });
    expect(start.status).toBe(200);
    const attemptId = start.body.attemptId as string;
    const view = await getAttemptView(app, p.id, attemptId);
    expect(view!.items).toHaveLength(20);
    expect(view!.status).toBe("in_progress");
    const payload = JSON.stringify(view);
    expect(payload).not.toMatch(/correct_ids|correctIds|rationale/);
    for (const it of view!.items) expect(it.options.length).toBeGreaterThanOrEqual(2);

    // Answer using the key (read as the owner): 19 right and one wrong is 95%, which passes (80% needed).
    const key = new Map<string, string[]>();
    for (const r of await admin`select id, correct_ids from learn.questions where version_id = ${published.versionId}`) key.set(r.id as string, r.correct_ids as string[]);
    for (const [n, it] of view!.items.entries()) {
      const right = key.get(it.questionId)!;
      const wrong = it.options.map((o) => o.id).find((id) => !right.includes(id))!;
      const r = await call(cookie, "answer", { attemptId, questionId: it.questionId, selected: n === 0 ? [wrong] : right });
      expect(r.status).toBe(200);
    }
    // Resuming shows the saved answers.
    const resumed = await getAttemptView(app, p.id, attemptId);
    expect(resumed!.items.every((i) => i.selected.length > 0)).toBe(true);

    const graded = await call(cookie, "submit", { attemptId });
    expect(graded.body).toMatchObject({ ok: true, passed: true, correct: 19, total: 20, scorePercent: 95 });
    // The review of a passed exam carries the reasons.
    const reviewed = await getAttemptView(app, p.id, attemptId);
    expect(reviewed!.result?.passed).toBe(true);
    expect(reviewed!.review).toHaveLength(20);
    expect(reviewed!.review.some((r) => r.rationale)).toBe(true);
    expect(reviewed!.review.filter((r) => !r.isCorrect)).toHaveLength(1);
    // Answers cannot change after the submission.
    expect((await call(cookie, "answer", { attemptId, questionId: view!.items[1].questionId, selected: ["a"] })).body.code).toBe("already_submitted");

    // The statement and the certificate: the name must match.
    const statement = hipaaCourse.attestation;
    expect((await call(cookie, "accept", { assignmentId, statementVersion: statement.version, typedName: "Someone Else" })).body.code).toBe("name_mismatch");
    const accepted = await call(cookie, "accept", { assignmentId, statementVersion: statement.version, typedName: "lia  santos" });
    expect(accepted.status).toBe(200);
    const reference = accepted.body.reference as string;
    expect(reference).toMatch(/^ERSHC-\d{4}-[A-Z2-9]{6}$/);
    const certified = await getOverview(app, p.id, assignmentId);
    expect(certified!.certificate).toMatchObject({ reference, holderName: "Lia Santos", revoked: false });

    // A passed course can be read again (review): every module opens, and the player is told to record nothing.
    const again = await getModuleView(app, p.id, assignmentId, "phi");
    expect(again).not.toBeNull();
    expect(again!.review).toBe(true);
    expect(await getModuleView(app, p.id, assignmentId, "no_such_module")).toBeNull();

    // The person's own record: this assignment with its certificate, score and time; nobody else's rows.
    const record = await getRecord(app, p.id);
    const mine = record.find((r) => r.assignmentId === assignmentId)!;
    expect(mine.status).toBe("passed");
    expect(mine.attempts).toBeGreaterThanOrEqual(1);
    expect(mine.certificate).toMatchObject({ assignmentId, reference, revoked: false });
    // one current entry per course, and no version number for the learner
    expect(record.filter((r) => r.courseTitle === mine.courseTitle)).toHaveLength(1);
    expect("version" in mine).toBe(false);
    expect(mine.scorePercent).toBeGreaterThanOrEqual(80);
    expect(mine.minutesSpent).toBeGreaterThan(0);
    const someoneElse = await makePerson("Zed", "Other");
    expect((await getRecord(app, someoneElse.id)).length).toBe(0);
    // My data includes it as dates and counts, with no answers.
    const myData = await collectMyData(p.id, p.email);
    const entry = myData.training.find((t) => t.certificate === reference)!;
    expect(entry.status).toBe("passed");
    expect(entry.track).toBe(mine.track);
    expect(JSON.stringify(myData.training)).not.toMatch(/correct|answer|stem/i);

    // The PDF: only the signed-in owner gets it, and it is a real PDF named by the reference.
    const download = (cookieHeader: string | null, id = assignmentId) =>
      handleCertificateDownload(new Request(`${LEARN}/api/certificate/${id}`, { headers: cookieHeader ? { cookie: cookieHeader } : {} }), id, { sql: app, production: true });
    const pdfRes = await download(cookie);
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get("content-type")).toBe("application/pdf");
    expect(pdfRes.headers.get("content-disposition")).toContain(reference);
    expect(Buffer.from(await pdfRes.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await download(null)).status).toBe(401);
    expect((await download(await signIn((await makePerson("Eve", "Other")).id))).status).toBe(404);
    expect((await download(cookie, "not-an-id")).status).toBe(404);

    // The public check needs the reference and the name, and no session.
    const check = async (reference: string, name: string, over: Partial<typeof deps> = {}) => {
      const res = await handleVerify(
        new Request(`${LEARN}/api/verify`, { method: "POST", body: JSON.stringify({ reference, name }), headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" } }),
        { sql: app, allow: async () => true, ...over },
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    expect((await check(reference, "Lia Santos")).body.status).toBe("valid");
    expect((await check(reference, "Lia Santo")).body.status).toBe("not_found");
    expect((await check("ERSHC-2026-AAAAAA", "Lia Santos")).body.status).toBe("not_found");
    expect((await check(reference, "Lia Santos", { allow: async () => false })).status).toBe(429);
  });

  it("shows only the topics to review after a failed try, never the answers", async () => {
    const p = await makePerson("Ben", "Reyes");
    const { assignmentId } = await assignCourse(admin, { userId: p.id, track: "essentials" });
    const cookie = await signIn(p.id);
    const required = hipaaCourse.modules.filter((m) => m.tracks.includes("essentials"));
    for (const m of required) {
      for (let s = 0; s < m.screens.length; s++) await call(cookie, "screen", { assignmentId, moduleKey: m.key, screen: s });
      await admin`insert into learn.module_time (assignment_id, user_id, module_key, day, seconds) values (${assignmentId}, ${p.id}, ${m.key}, '2026-10-20', ${Math.round(m.estimatedMinutes * 60 * 0.4)})`;
      expect((await call(cookie, "complete", { assignmentId, moduleKey: m.key })).status).toBe(200);
    }
    // Essentials never opens the modules it does not include.
    expect((await call(cookie, "screen", { assignmentId, moduleKey: "security", screen: 0 })).body.code).toBe("no_such_module");

    const attemptId = (await call(cookie, "startExam", { assignmentId })).body.attemptId as string;
    const view = await getAttemptView(app, p.id, attemptId);
    expect(view!.items).toHaveLength(20);
    const keyed = await admin`select id, module_key from learn.questions where id = any(${view!.items.map((i) => i.questionId)})`;
    for (const k of keyed) expect(required.map((m) => m.key)).toContain(k.module_key);

    // Answer nothing: 0%. The result names topics and nothing else.
    const graded = await call(cookie, "submit", { attemptId });
    expect(graded.body).toMatchObject({ ok: true, passed: false, correct: 0 });
    const result = await getAttemptView(app, p.id, attemptId);
    expect(result!.result?.passed).toBe(false);
    expect(result!.review.length).toBe(20);
    for (const r of result!.review) {
      expect(r.correctIds).toBeNull();
      expect(r.rationale).toBeNull();
      expect(r.selectedIds).toBeNull();
    }
    // The wait after a fail is enforced, with the time it ends.
    const again = await call(cookie, "startExam", { assignmentId });
    expect(again.body.code).toBe("wait_after_fail");
    expect(typeof again.body.retryAt).toBe("string");
  });

  it("refuses calls from another site, with no session, or about someone else's assignment", async () => {
    const a = await makePerson();
    const b = await makePerson();
    const { assignmentId } = await assignCourse(admin, { userId: a.id, track: "full" });
    const cookieB = await signIn(b.id);
    expect((await call(cookieB, "screen", { assignmentId, moduleKey: "foundations", screen: 0 })).body.code).toBe("not_found");
    expect(await getOverview(app, b.id, assignmentId)).toBeNull();

    const noSession = await handleApi(
      new Request(`${LEARN}/api/screen`, { method: "POST", body: "{}", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" } }),
      "screen",
      deps,
    );
    expect(noSession.status).toBe(401);
    const crossSite = await handleApi(
      new Request(`${LEARN}/api/screen`, { method: "POST", body: "{}", headers: { cookie: cookieB, "content-type": "application/json", "sec-fetch-site": "cross-site" } }),
      "screen",
      deps,
    );
    expect(crossSite.status).toBe(403);
    expect((await call(cookieB, "nope", {})).status).toBe(404);
    expect((await call(cookieB, "screen", { assignmentId: "not-a-uuid", moduleKey: "foundations", screen: 0 })).status).toBe(400);
  });
});
