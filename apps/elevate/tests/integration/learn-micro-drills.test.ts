import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./global-setup";

// Quarterly micro-drills and quick-reference cards (Release 3), through Learn's real request handlers and the restricted learn_app
// role: a person with training sees this quarter's drill, answers it once, gets the better answer and why, and the HR view counts it.

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
const { handleApi } = await import("../../../learn/src/lib/api");
const { getPractice, getCards } = await import("../../../learn/src/lib/queries");
const { drillFor, quarterOf } = await import("../../../learn/src/content/drills");
const { sessionCookie } = await import("../../../learn/src/lib/cookie");
const { hashValue, newSessionValue } = await import("../../../learn/src/lib/tokens");

afterAll(async () => {
  await app.end();
  await admin.end();
});

const deps = { sql: app, elevateOrigin: "https://elevate.example.com", production: true, allow: async () => true, allowUser: async () => true };

async function makePerson() {
  const id = randomUUID();
  const email = `drill${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;
  await admin`insert into core.users (id, email) values (${id}, ${email})`;
  await admin`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, start_date) values ('Dina', 'Drill', ${email}, 'active', ${id}, '2026-01-05')`;
  return id;
}

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

describe("quarterly practice and cards", () => {
  it("shows this quarter's drill to a person with training, records one answer, and shows the better answer", async () => {
    const reviewer = randomUUID();
    await admin`insert into core.users (id, email) values (${reviewer}, ${`rev${Date.now()}@example.com`})`;
    await loadCourse(admin, { publish: true, reviewerUserId: reviewer, counselApprovedOn: "2026-11-01", actorUserId: reviewer });

    const stranger = await makePerson();
    const learner = await makePerson();
    await assignCourse(admin, { userId: learner, track: "full" });
    const cookie = await signIn(learner);

    expect(await getPractice(app, stranger)).toEqual([]);
    const [item] = await getPractice(app, learner);
    expect(item.courseSlug).toBe("hipaa");
    expect(item.answered).toBeNull();
    const quarter = quarterOf(new Date());
    expect(item.drill.key).toBe(drillFor("hipaa", quarter)!.key);

    const wrong = item.drill.options.find((o) => o.id !== item.drill.best)!.id;
    const first = await call(cookie, "drill", { course: "hipaa", choice: wrong });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, correct: false, best: item.drill.best, recorded: true });
    expect(typeof first.body.explanation).toBe("string");

    // a second answer in the same quarter changes nothing
    const again = await call(cookie, "drill", { course: "hipaa", choice: item.drill.best });
    expect(again.body).toMatchObject({ ok: true, correct: true, recorded: false });
    const [stored] = await admin`select choice, correct from learn.drill_results where user_id = ${learner} and course_slug = 'hipaa' and quarter = ${quarter}`;
    expect(stored).toMatchObject({ choice: wrong, correct: false });
    expect((await getPractice(app, learner))[0].answered).toEqual({ choice: wrong, correct: false });

    // someone with no training in the course cannot answer; an unknown course or option is refused
    expect((await call(await signIn(stranger), "drill", { course: "hipaa", choice: "a" })).status).toBeGreaterThanOrEqual(400);
    expect((await call(cookie, "drill", { course: "nope", choice: "a" })).status).toBeGreaterThanOrEqual(400);
    expect((await call(cookie, "drill", { course: "hipaa", choice: "z" })).status).toBe(400);
    await expect(admin`update learn.drill_results set correct = true where user_id = ${learner}`).rejects.toThrow();
  });

  it("lists the key points of the person's own modules as cards", async () => {
    const learner = await makePerson();
    await assignCourse(admin, { userId: learner, track: "essentials" });
    const cards = await getCards(app, learner);
    const hipaa = cards.find((c) => c.courseSlug === "hipaa")!;
    expect(hipaa.modules.length).toBeGreaterThan(0);
    expect(hipaa.modules.every((m) => m.keyPoints.length >= 3)).toBe(true);
    // Essentials leaves out the Full-only modules
    const full = await makePerson();
    await assignCourse(admin, { userId: full, track: "full" });
    const fullCards = (await getCards(app, full)).find((c) => c.courseSlug === "hipaa")!;
    expect(fullCards.modules.length).toBeGreaterThan(hipaa.modules.length);
  });
});
