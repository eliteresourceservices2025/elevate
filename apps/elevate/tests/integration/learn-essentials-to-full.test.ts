import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "./global-setup";

// A legacy HIPAA Essentials assignment is replaced by a Full one: the old one is kept as history (cancelled), the modules both tracks
// share are carried over with their dates, the Full exam starts fresh, and nothing else is touched.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const admin = postgres(testDatabaseUrl(process.env.TEST_DB_ADMIN_URL!), { max: 2, onnotice: () => {} });
afterAll(async () => {
  await admin.end();
});
const { db } = await import("@/lib/db");
const { loadCourse } = await import("@/modules/learn/publish");
const actions = await import("@/modules/learn/actions");
const { COURSES } = await import("../../../learn/src/content");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let n = 0;
async function makeUser(label: string, withRecord = true) {
  const id = randomUUID();
  const email = `${label}${Date.now().toString(36)}${n++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  if (withRecord) await db.execute(sql`insert into core.employees (user_id, legal_first_name, legal_last_name, work_email, status, start_date) values (${id}, 'Test', 'Learner', ${email}, 'active', '2026-01-05')`);
  return id;
}

async function hipaaVersion() {
  const [published] = await rows<{ id: string; course_id: string }>(sql`
    select v.id, v.course_id from learn.course_versions v join learn.courses c on c.id = v.course_id where c.slug = 'hipaa' and v.status = 'published'`);
  if (published) return { versionId: published.id, courseId: published.course_id };
  const reviewer = await makeUser("rev", false);
  const src = COURSES.hipaa;
  const made = await loadCourse(admin, { course: { slug: "hipaa", content: structuredClone(src.content), questions: structuredClone(src.questions), examConfig: src.examConfig }, publish: true, reviewerUserId: reviewer, counselApprovedOn: "2026-10-23", actorUserId: reviewer });
  const [c] = await rows<{ course_id: string }>(sql`select course_id from learn.course_versions where id = ${made.versionId}`);
  return { versionId: made.versionId, courseId: c.course_id };
}

async function essentialsAssignment(userId: string, v: { versionId: string; courseId: string }) {
  const [a] = await rows<{ id: string }>(sql`
    insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on)
    values (${userId}, ${v.courseId}, ${v.versionId}, 'essentials', 'manual', '2026-12-01') returning id`);
  await db.execute(sql`update learn.assignments set status = 'in_progress' where id = ${a.id}`);
  const keys = await rows<{ module_key: string }>(sql`select module_key from learn.version_modules where version_id = ${v.versionId} and 'essentials' = any (tracks) order by position`);
  for (const k of keys) await db.execute(sql`insert into learn.module_completions (assignment_id, user_id, module_key) values (${a.id}, ${userId}, ${k.module_key})`);
  return { id: a.id, modules: keys.map((k) => k.module_key) };
}

const hrUser = async () => ({ id: await makeUser("hr"), email: "hr@example.com", roles: ["hr_admin"], employeeId: null });
const REASON = "Assigned Essentials by mistake; Full is required.";

describe("moving HIPAA Essentials to Full", () => {
  it("cancels the Essentials assignment, creates a Full one and carries over the shared modules", async () => {
    const v = await hipaaVersion();
    const learner = await makeUser("learner");
    const old = await essentialsAssignment(learner, v);
    expect(old.modules.length).toBeGreaterThan(0);

    current.user = await hrUser();
    const result = await actions.convertLearnEssentialsToFull({ assignmentId: old.id, reason: REASON });
    expect(result).toEqual({ ok: true, data: { creditedModules: old.modules.length } });

    const [was] = await rows<{ status: string; track: string }>(sql`select status, track from learn.assignments where id = ${old.id}`);
    expect(was).toEqual({ status: "cancelled", track: "essentials" });
    const open = await rows<{ id: string; track: string }>(sql`select id, track from learn.assignments where user_id = ${learner} and status in ('assigned', 'in_progress')`);
    expect(open).toHaveLength(1);
    expect(open[0].track).toBe("full");
    const done = await rows<{ module_key: string }>(sql`select module_key from learn.module_completions where assignment_id = ${open[0].id} order by module_key`);
    expect(done.map((d) => d.module_key)).toEqual([...old.modules].sort());
    // history is kept
    expect(await rows(sql`select 1 from learn.module_completions where assignment_id = ${old.id}`)).toHaveLength(old.modules.length);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'learn.convert_essentials_to_full' and target_id = ${open[0].id}`)).toHaveLength(1);
  });

  it("also handles an exam passed whose acknowledgement was never finished, and never one with a certificate", async () => {
    const v = await hipaaVersion();
    const learner = await makeUser("stuck");
    const old = await essentialsAssignment(learner, v);
    await db.execute(sql`update learn.assignments set status = 'passed', passed_at = now() where id = ${old.id}`);
    current.user = await hrUser();
    expect((await actions.convertLearnEssentialsToFull({ assignmentId: old.id, reason: REASON })).ok).toBe(true);
    const [was] = await rows<{ status: string }>(sql`select status from learn.assignments where id = ${old.id}`);
    expect(was.status).toBe("expired");
    expect(await rows(sql`select 1 from learn.assignments where user_id = ${learner} and track = 'full' and status = 'assigned'`)).toHaveLength(1);

    // a passed Essentials plus another open assignment: refused with a clear message, nothing changes
    const busy = await makeUser("busy");
    const passedOld = await essentialsAssignment(busy, v);
    await db.execute(sql`update learn.assignments set status = 'passed', passed_at = now() where id = ${passedOld.id}`);
    await db.execute(sql`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${busy}, ${v.courseId}, ${v.versionId}, 'full', 'manual', '2026-12-01')`);
    const refused = await actions.convertLearnEssentialsToFull({ assignmentId: passedOld.id, reason: REASON });
    expect(refused).toEqual({ ok: false, error: "This person already has another open HIPAA assignment. Close it first." });
    const [still] = await rows<{ status: string }>(sql`select status from learn.assignments where id = ${passedOld.id}`);
    expect(still.status).toBe("passed");

    const certified = await makeUser("certified");
    const done = await essentialsAssignment(certified, v);
    await db.execute(sql`update learn.assignments set status = 'passed', passed_at = now() where id = ${done.id}`);
    await db.execute(sql`insert into learn.certificates (reference, user_id, assignment_id, version_id, track, holder_name, issued_on, ends_on) values (${`HC-2026-${String(100000 + (Date.now() % 800000)).replace(/[01]/g, "7")}`}, ${certified}, ${done.id}, ${v.versionId}, 'essentials', 'Test Learner', '2026-10-01', '2027-10-01')`);
    expect((await actions.convertLearnEssentialsToFull({ assignmentId: done.id, reason: REASON })).ok).toBe(false);
  });

  it("refuses a second conversion, a Full assignment, your own assignment and other roles", async () => {
    const v = await hipaaVersion();
    const learner = await makeUser("learner");
    const old = await essentialsAssignment(learner, v);

    current.user = { id: await makeUser("emp"), email: "e@example.com", roles: ["employee"], employeeId: null };
    expect((await actions.convertLearnEssentialsToFull({ assignmentId: old.id, reason: REASON })).ok).toBe(false);

    // HR cannot convert their own
    const self = await hrUser();
    const mine = await essentialsAssignment(self.id, v);
    current.user = self;
    expect(await actions.convertLearnEssentialsToFull({ assignmentId: mine.id, reason: REASON })).toMatchObject({ ok: false });

    current.user = await hrUser();
    expect((await actions.convertLearnEssentialsToFull({ assignmentId: old.id, reason: "short" })).ok).toBe(false);
    expect((await actions.convertLearnEssentialsToFull({ assignmentId: old.id, reason: REASON })).ok).toBe(true);
    // the Essentials one is now closed, and the new Full one is not Essentials
    expect((await actions.convertLearnEssentialsToFull({ assignmentId: old.id, reason: REASON })).ok).toBe(false);
    const [full] = await rows<{ id: string }>(sql`select id from learn.assignments where user_id = ${learner} and status = 'in_progress' or (user_id = ${learner} and status = 'assigned')`);
    expect((await actions.convertLearnEssentialsToFull({ assignmentId: full.id, reason: REASON })).ok).toBe(false);
  });
});

describe("accepting with a middle name", () => {
  it("accepts first+last or first+middle+last, rejects others, and prints the middle name", async () => {
    const v = await hipaaVersion();
    const userId = await makeUser("mid", false);
    await db.execute(sql`insert into core.employees (user_id, legal_first_name, legal_middle_name, legal_last_name, work_email, status, start_date) values (${userId}, 'Careen', 'Buen', 'Bayani', ${`mid${Date.now().toString(36)}@example.com`}, 'active', '2026-01-05')`);
    const accept = (assignmentId: string, name: string) => rows(sql`select * from learn.accept_and_certify(${userId}::uuid, ${assignmentId}::uuid, 'v1', ${name}, '203.0.113.9', ${"{password}"}::text[])`);
    const passed = async () => {
      const a = await essentialsAssignment(userId, v);
      await db.execute(sql`update learn.assignments set status = 'passed', passed_at = now() where id = ${a.id}`);
      return a.id;
    };

    const first = await passed();
    expect(await accept(first, "Careen Reyes Bayani").catch((e: { cause?: { message?: string } }) => e.cause?.message)).toMatch(/name_mismatch/);
    expect(await accept(first, "Careen Bayani Buen").catch((e: { cause?: { message?: string } }) => e.cause?.message)).toMatch(/name_mismatch/);
    const withMiddle = await accept(first, "  careen   BUEN bayani ");
    expect(withMiddle).toHaveLength(1);
    const [cert] = await rows<{ holder_name: string }>(sql`select holder_name from learn.certificates where assignment_id = ${first}`);
    expect(cert.holder_name).toBe("Careen Buen Bayani");

    // without the middle name is still accepted, and the certificate still prints the full legal name
    await db.execute(sql`update learn.assignments set status = 'expired' where id = ${first}`);
    const second = await passed();
    expect(await accept(second, "Careen Bayani")).toHaveLength(1);
    const [cert2] = await rows<{ holder_name: string }>(sql`select holder_name from learn.certificates where assignment_id = ${second}`);
    expect(cert2.holder_name).toBe("Careen Buen Bayani");
  });
});
