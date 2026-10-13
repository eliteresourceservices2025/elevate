import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { testDatabaseUrl } from "./global-setup";

// ELEVATE's side of training against the real database: the nightly assignment (tracks, due dates, renewals, people who left,
// expired certificates), the reminders (each once), recording certificates in Certificates, clean-up (answers removed after 12
// months, only by the job), the Training status page's query (HR sees scores, a lead only status), and HR giving more tries.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.55" }), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/modules/signing/session", () => ({ currentSignInMethods: vi.fn(async () => "password, totp") }));

const admin = postgres(testDatabaseUrl(process.env.TEST_DB_ADMIN_URL!), { max: 2, onnotice: () => {} });

const { db } = await import("@/lib/db");
const { loadCourse } = await import("@/modules/learn/publish");
const jobs = await import("@/modules/learn/jobs");
const actions = await import("@/modules/learn/actions");
const queries = await import("@/modules/learn/queries");

afterAll(async () => {
  await admin.end();
});

const TODAY = "2026-10-12";
const plus = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: unknown) => {
  current.user = u;
};
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;

type Person = { id: string; email: string; roles: RoleSlug[]; employeeId: string };

async function makePerson(opts: { roles?: RoleSlug[]; first?: string; start?: string | null; status?: string; managerId?: string | null; account?: boolean } = {}): Promise<Person> {
  const id = randomUUID();
  const email = `${uniq("lj")}@example.com`;
  const roles = opts.roles ?? ["employee"];
  if (opts.account !== false) {
    await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
    for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  }
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, start_date, manager_id)
    values (${opts.first ?? "Pat"}, 'Tester', ${email}, ${opts.status ?? "active"}, ${opts.account === false ? null : id}, ${opts.start === undefined ? "2024-02-01" : opts.start}, ${opts.managerId ?? null}) returning id`);
  return { id, email, roles, employeeId: e.id };
}

async function makeClient(handlesPhi: boolean) {
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name, handles_phi) values (${uniq("Client ")}, ${handlesPhi}) returning id`);
  return c.id;
}
const assignToClient = (employeeId: string, clientId: string) => db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${employeeId}, ${clientId}, '2026-01-05')`);

const assignmentOf = async (userId: string, statuses = ["assigned", "in_progress"]) =>
  (await rows<{ id: string; track: string; reason: string; due_on: string; status: string }>(sql`
    select id, track, reason, due_on::text as due_on, status from learn.assignments where user_id = ${userId} and status = any(${`{${statuses.join(",")}}`}::text[]) order by assigned_at desc limit 1`))[0];
const notices = (userId: string, kind: string) => rows<{ title: string }>(sql`select title from ops.notifications where user_id = ${userId} and kind = ${kind} order by created_at`);

let versionId: string;
let courseId: string;
let reviewerId: string;

beforeAll(async () => {
  reviewerId = randomUUID();
  await db.execute(sql`insert into core.users (id, email) values (${reviewerId}, ${`${uniq("rev")}@example.com`})`);
  const r = await loadCourse(admin, { publish: true, reviewerUserId: reviewerId, counselApprovedOn: "2026-11-01", actorUserId: reviewerId });
  versionId = r.versionId;
  courseId = r.courseId;
});

/** A passed assignment with a certificate ending on a given day (what a person who finished the course has). */
async function withCertificate(p: Person, endsOn: string, issuedOn = plus(endsOn, -365)) {
  const [a] = await rows<{ id: string }>(sql`
    insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${p.id}, ${courseId}, ${versionId}, 'full', 'manual', ${plus(issuedOn, 30)}) returning id`);
  await db.execute(sql`update learn.assignments set status = 'in_progress' where id = ${a.id}`);
  await db.execute(sql`update learn.assignments set status = 'passed', passed_at = now() where id = ${a.id}`);
  const ref = `HC-2026-${Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[01OIL]/g, "A")}`.slice(0, 14);
  const [c] = await rows<{ id: string }>(sql`
    insert into learn.certificates (reference, user_id, assignment_id, version_id, track, holder_name, issued_on, ends_on)
    values (${ref.padEnd(14, "A")}, ${p.id}, ${a.id}, ${versionId}, 'full', 'Pat Tester', ${issuedOn}, ${endsOn}) returning id`);
  return { assignmentId: a.id, certificateId: c.id };
}

describe("the Cybersecurity basics course", () => {
  it("puts everyone on its one track once published, apart from HIPAA", async () => {
    const p = await makePerson({ start: plus(TODAY, -3) });

    await loadCourse(admin, { courseSlug: "cybersecurity", publish: true, reviewerUserId: reviewerId, counselApprovedOn: "2026-11-01", actorUserId: reviewerId });
    const run = await jobs.runLearnAssign(TODAY, { userIds: [p.id] }, "cybersecurity");
    expect(run).toMatchObject({ skipped: false, assigned: 1 });
    const cyber = await rows<{ track: string; slug: string; due_on: string }>(sql`
      select a.track, c.slug, a.due_on::text as due_on from learn.assignments a join learn.courses c on c.id = a.course_id where a.user_id = ${p.id} and c.slug = 'cybersecurity'`);
    expect(cyber).toEqual([{ track: "full", slug: "cybersecurity", due_on: plus(TODAY, 27) }]);
    expect((await notices(p.id, "learn.assigned")).map((n) => n.title)).toContain("Cybersecurity basics training is assigned to you");
    // The HIPAA course is separate: this person has none from that run.
    expect((await rows(sql`select 1 from learn.assignments a join learn.courses c on c.id = a.course_id where a.user_id = ${p.id} and c.slug = 'hipaa'`)).length).toBe(0);
    // Repeating assigns nothing more.
    expect(await jobs.runLearnAssign(TODAY, { userIds: [p.id] }, "cybersecurity")).toMatchObject({ assigned: 0 });
  });
});

describe("the nightly assignment", () => {
  it("puts new people on the right track with the right due date, and does nothing for people it should not touch", async () => {
    const phi = await makeClient(true);
    const noPhi = await makeClient(false);

    const newFull = await makePerson({ start: plus(TODAY, -5) });
    await assignToClient(newFull.employeeId, phi);
    const newEssentials = await makePerson({ start: plus(TODAY, -5) });
    await assignToClient(newEssentials.employeeId, noPhi);
    const longTime = await makePerson({ start: "2023-06-01" });
    await assignToClient(longTime.employeeId, phi);
    const noAccount = await makePerson({ account: false });
    const left = await makePerson({ status: "separated" });
    const archived = await makePerson();
    await db.execute(sql`update core.users set archived_at = now() where id = ${archived.id}`);

    const ids = [newFull, newEssentials, longTime, left, archived].map((p) => p.id);
    const run = await jobs.runLearnAssign(TODAY, { userIds: ids });
    expect(run).toMatchObject({ skipped: false, assigned: 3 });

    expect(await assignmentOf(newFull.id)).toMatchObject({ track: "full", reason: "new_hire", due_on: plus(TODAY, 25) });
    expect(await assignmentOf(newEssentials.id)).toMatchObject({ track: "essentials", reason: "new_hire", due_on: plus(TODAY, 25) });
    expect(await assignmentOf(longTime.id)).toMatchObject({ track: "full", reason: "manual", due_on: plus(TODAY, 30) });
    expect(await assignmentOf(left.id)).toBeUndefined();
    expect(await assignmentOf(archived.id)).toBeUndefined();
    expect(noAccount.id).toBeTruthy();
    expect((await notices(newFull.id, "learn.assigned")).length).toBe(1);

    // a second run changes nothing
    const again = await jobs.runLearnAssign(TODAY, { userIds: ids });
    expect(again.assigned).toBe(0);
    expect((await notices(newFull.id, "learn.assigned")).length).toBe(1);
  });

  it("opens a renewal before a certificate ends, expires the old assignment after, and closes the work of people who left", async () => {
    const soon = await makePerson();
    await withCertificate(soon, plus(TODAY, 20));
    const ended = await makePerson();
    const old = await withCertificate(ended, plus(TODAY, -1));
    const current = await makePerson();
    await withCertificate(current, plus(TODAY, 200));
    const leaver = await makePerson();
    await db.execute(sql`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${leaver.id}, ${courseId}, ${versionId}, 'full', 'manual', ${plus(TODAY, 10)})`);
    await db.execute(sql`update core.employees set status = 'separated' where id = ${leaver.employeeId}`);

    const run = await jobs.runLearnAssign(TODAY, { userIds: [soon.id, ended.id, current.id, leaver.id] });
    expect(run).toMatchObject({ assigned: 2, renewals: 2, cancelled: 1, expired: 1 });

    expect(await assignmentOf(soon.id)).toMatchObject({ track: "refresher", reason: "renewal", due_on: plus(TODAY, 20) });
    expect(await assignmentOf(ended.id)).toMatchObject({ track: "refresher", reason: "renewal", due_on: plus(TODAY, 30) });
    expect(await assignmentOf(current.id)).toBeUndefined();
    expect((await rows<{ status: string }>(sql`select status from learn.assignments where id = ${old.assignmentId}`))[0].status).toBe("expired");
    expect((await rows<{ status: string }>(sql`select status from learn.assignments where user_id = ${leaver.id}`))[0].status).toBe("cancelled");
  });
});

describe("reminders", () => {
  it("tells the person once at each threshold, and lists overdue people to their lead and HR once a week", async () => {
    const lead = await makePerson({ roles: ["team_lead"], first: "Lead" });
    const hr = await makePerson({ roles: ["hr_admin"], first: "Hr" });
    const week = await makePerson({ managerId: lead.employeeId });
    const month = await makePerson({ managerId: lead.employeeId });
    const late = await makePerson({ managerId: lead.employeeId, first: "Lena" });
    const make = (p: Person, due: string) => db.execute(sql`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${p.id}, ${courseId}, ${versionId}, 'full', 'manual', ${due})`);
    await make(week, plus(TODAY, 7));
    await make(month, plus(TODAY, 30));
    await make(late, plus(TODAY, -3));
    const scope = { userIds: [week.id, month.id, late.id], hrUserIds: [hr.id] };

    const first = await jobs.runLearnReminders(TODAY, scope);
    expect(first).toMatchObject({ personNotices: 3, leadNotices: 1, hrSummaries: 1 });
    expect((await notices(week.id, "learn.reminder"))[0].title).toMatch(/due in 7 days/);
    expect((await notices(month.id, "learn.reminder"))[0].title).toMatch(/due in 30 days/);
    expect((await notices(late.id, "learn.reminder"))[0].title).toMatch(/due today/);
    const leadNotice = await notices(lead.id, "learn.overdue_team");
    expect(leadNotice.length).toBe(1);
    expect(leadNotice[0].title).toMatch(/team member/);
    expect((await rows<{ body: string }>(sql`select body from ops.notifications where user_id = ${lead.id} and kind = 'learn.overdue_team'`))[0].body).toContain("Lena");
    expect((await notices(hr.id, "learn.overdue")).length).toBe(1);

    // the same day again: nothing
    expect(await jobs.runLearnReminders(TODAY, scope)).toEqual({ personNotices: 0, leadNotices: 0, hrSummaries: 0 });
    // the next day, same week: still nothing new for the overdue notice, and no repeated threshold
    const nextDay = await jobs.runLearnReminders(plus(TODAY, 1), scope);
    expect(nextDay.leadNotices).toBe(0);
    expect(nextDay.hrSummaries).toBe(0);
    // next week: the weekly notice comes again
    const nextWeek = await jobs.runLearnReminders(plus(TODAY, 7), scope);
    expect(nextWeek.leadNotices).toBe(1);
    expect(nextWeek.hrSummaries).toBe(1);
  });
});

describe("certificates into Certificates", () => {
  it("records a certificate once, notifies the person, follows a revocation, and leaves a person with no people record waiting", async () => {
    const person = await makePerson();
    const { certificateId } = await withCertificate(person, plus(TODAY, 300), plus(TODAY, -65));
    const first = await jobs.runLearnSync({ userIds: [person.id] });
    expect(first).toMatchObject({ recorded: 1, waiting: 0 });
    const creds = await rows<{ id: string; name: string; source: string; expires_on: string; archived_at: string | null }>(sql`
      select id, name, source, expires_on::text, archived_at::text from talent.credentials where employee_id = ${person.employeeId}`);
    expect(creds.length).toBe(1);
    expect(creds[0]).toMatchObject({ source: "learn", expires_on: plus(TODAY, 300), archived_at: null });
    expect(creds[0].name).toMatch(/HIPAA Privacy, Security and Awareness \(ERS\)/);
    expect((await notices(person.id, "learn.certified")).length).toBe(1);

    // the emailed copy: one email with the certificate attached as a PDF, and no scores or other detail in it
    const mails = await rows<{ subject: string; body: string; attachment: { fileName: string; mimeType: string; content: string; base64?: boolean } }>(sql`
      select subject, body, attachment from ops.email_queue where user_id = ${person.id} and dedupe_key like 'learn-certificate:%'`);
    expect(mails.length).toBe(1);
    expect(mails[0].attachment).toMatchObject({ mimeType: "application/pdf", base64: true });
    expect(mails[0].attachment.fileName).toMatch(/^ers-certificate-(HC|ERSHC|ERSLN)-[0-9]{4}-[A-Z2-9]{6}.pdf$/);
    expect(Buffer.from(mails[0].attachment.content, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect(mails[0].body).not.toMatch(/score|percent|%/i);

    // repeating records nothing more
    expect(await jobs.runLearnSync({ userIds: [person.id] })).toMatchObject({ recorded: 0 });
    expect((await rows(sql`select 1 from ops.email_queue where user_id = ${person.id} and dedupe_key like 'learn-certificate:%'`)).length).toBe(1);
    expect((await rows(sql`select 1 from talent.credentials where employee_id = ${person.employeeId}`)).length).toBe(1);

    // a revocation archives the credential
    await db.execute(sql`insert into learn.certificate_revocations (certificate_id, revoked_by, reason) values (${certificateId}, ${person.id}, 'Test of revocation')`);
    const revoked = await jobs.runLearnSync({ userIds: [person.id] });
    expect(revoked.archived).toBe(1);
    expect((await rows<{ archived_at: string | null }>(sql`select archived_at::text from talent.credentials where id = ${creds[0].id}`))[0].archived_at).not.toBeNull();

    // someone with an account but no people record: left waiting, not lost
    const accountOnly = randomUUID();
    await db.execute(sql`insert into core.users (id, email) values (${accountOnly}, ${`${uniq("ao")}@example.com`})`);
    const ghost = { id: accountOnly, email: "", roles: [] as RoleSlug[], employeeId: "" };
    await withCertificate(ghost, plus(TODAY, 100));
    expect(await jobs.runLearnSync({ userIds: [accountOnly] })).toMatchObject({ recorded: 0, waiting: 1 });
  });
});

describe("clean-up", () => {
  it("removes answers 12 months after the exam, only through the job, and keeps the result", async () => {
    const p = await makePerson();
    const [a] = await rows<{ id: string }>(sql`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${p.id}, ${courseId}, ${versionId}, 'full', 'manual', ${plus(TODAY, 30)}) returning id`);
    const [q] = await rows<{ id: string }>(sql`select id from learn.questions where version_id = ${versionId} limit 1`);
    const attempt = async (n: number) => {
      const [x] = await rows<{ id: string }>(sql`insert into learn.exam_attempts (assignment_id, user_id, attempt_no, deadline_at, total_count) values (${a.id}, ${p.id}, ${n}, now() + interval '20 minutes', 1) returning id`);
      await db.execute(sql`insert into learn.exam_attempt_items (attempt_id, position, question_id, option_order) values (${x.id}, 0, ${q.id}, ${"{a,b,c}"}::text[])`);
      await db.execute(sql`insert into learn.exam_answers (attempt_id, question_id, selected_ids) values (${x.id}, ${q.id}, ${"{a}"}::text[])`);
      return x.id;
    };
    const oldAttempt = await attempt(1);
    await db.execute(sql`update learn.exam_attempts set status = 'submitted', submitted_at = now() - interval '13 months', correct_count = 1, score_percent = 100, passed = true where id = ${oldAttempt}`);
    const recent = await attempt(2);
    await db.execute(sql`update learn.exam_attempts set status = 'submitted', submitted_at = now() - interval '2 months', correct_count = 0, score_percent = 0, passed = false where id = ${recent}`);

    // nothing but the job may delete an answer
    await expect(db.execute(sql`delete from learn.exam_answers where attempt_id = ${oldAttempt}`)).rejects.toThrow();

    // old tokens and sessions
    await db.execute(sql`insert into learn.launch_tokens (token_hash, user_id, expires_at) values (${Buffer.from(randomUUID().replaceAll("-", ""), "hex")}, ${p.id}, now() - interval '3 days')`);

    const run = await jobs.runLearnPurge();
    expect(run.answers).toBeGreaterThanOrEqual(1);
    expect(run.tokens).toBeGreaterThanOrEqual(1);
    expect((await rows(sql`select 1 from learn.exam_answers where attempt_id = ${oldAttempt}`)).length).toBe(0);
    expect((await rows(sql`select 1 from learn.exam_answers where attempt_id = ${recent}`)).length).toBe(1);
    // the result stays
    expect((await rows<{ score_percent: string; passed: boolean }>(sql`select score_percent::text, passed from learn.exam_attempts where id = ${oldAttempt}`))[0]).toMatchObject({ passed: true });
  });
});

describe("the Training status page and HR's actions", () => {
  it("shows HR everyone with scores, a lead only their team's status, and nothing to anyone else", async () => {
    const hr = await makePerson({ roles: ["hr_admin"], first: "Hana" });
    const lead = await makePerson({ roles: ["team_lead"], first: "Tess" });
    const mine = await makePerson({ managerId: lead.employeeId, first: "Mine" });
    const other = await makePerson({ first: "Other" });
    const worker = await makePerson({ roles: ["employee"], first: "Wes" });

    // mine has passed with a score; other is overdue with a failed try
    const done = await withCertificate(mine, plus(TODAY, 300));
    const [x] = await rows<{ id: string }>(sql`insert into learn.exam_attempts (assignment_id, user_id, attempt_no, deadline_at, total_count) values (${done.assignmentId}, ${mine.id}, 1, now() + interval '20 minutes', 15) returning id`);
    await db.execute(sql`update learn.exam_attempts set status = 'submitted', submitted_at = now(), correct_count = 14, score_percent = 93.33, passed = true where id = ${x.id}`);
    await db.execute(sql`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${other.id}, ${courseId}, ${versionId}, 'full', 'manual', '2020-01-01')`);

    as(hr);
    const all = await queries.listTrainingStatus({ q: "Mine" }, { page: 1, pageSize: 25 });
    expect(all.canSeeResults).toBe(true);
    expect(all.rows.map((r) => r.name)).toContain("Mine Tester");
    const hrRow = all.rows.find((r) => r.userId === mine.id)!;
    expect(hrRow).toMatchObject({ state: "passed", label: "Passed", attempts: 1, lastScore: 93.33 });
    const overdue = (await queries.listTrainingStatus({ state: "overdue" }, { page: 1, pageSize: 100 })).rows.find((r) => r.userId === other.id);
    expect(overdue).toMatchObject({ state: "overdue", label: "Overdue" });

    as(lead);
    const team = await queries.listTrainingStatus({}, { page: 1, pageSize: 100 });
    expect(team.canSeeResults).toBe(false);
    expect(team.canManage).toBe(false);
    expect(team.rows.map((r) => r.userId)).toEqual([mine.id]);
    expect(team.rows[0]).toMatchObject({ state: "passed", attempts: null, lastScore: null });
    expect(JSON.stringify(team)).not.toContain("93.33");

    as(worker);
    await expect(queries.listTrainingStatus({}, { page: 1, pageSize: 25 })).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("lets HR give more tries or time, refuses a self-grant, a closed training and anyone else, and notifies the person", async () => {
    const hr = await makePerson({ roles: ["hr_admin"] });
    const lead = await makePerson({ roles: ["team_lead"] });
    const person = await makePerson();
    await db.execute(sql`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${person.id}, ${courseId}, ${versionId}, 'full', 'manual', ${plus(TODAY, 30)})`);
    const a = await assignmentOf(person.id);

    as(lead);
    expect(await actions.grantLearnRetry({ kind: "tries", assignmentId: a.id, amount: 1, reason: "Connection dropped" })).toEqual({ ok: false, error: "You do not have access to do that." });

    as(hr);
    expect((await actions.grantLearnRetry({ kind: "tries", assignmentId: a.id, amount: 2, reason: "Connection dropped during the exam" })).ok).toBe(true);
    expect((await actions.grantLearnRetry({ kind: "time", assignmentId: a.id, amount: 15, reason: "Needs extra time, approved by HR" })).ok).toBe(true);
    const grants = await rows<{ kind: string; extra_tries: number; extra_minutes: number }>(sql`select kind, extra_tries, extra_minutes from learn.retry_grants where assignment_id = ${a.id} order by granted_at`);
    expect(grants).toEqual([
      { kind: "tries", extra_tries: 2, extra_minutes: 0 },
      { kind: "time", extra_tries: 0, extra_minutes: 15 },
    ]);
    expect((await notices(person.id, "learn.retry")).length).toBe(2);

    // not for yourself, not with a missing reason or a silly amount, not for a closed training
    const own = await makePerson({ roles: ["hr_admin"] });
    await db.execute(sql`insert into learn.assignments (user_id, course_id, version_id, track, reason, due_on) values (${own.id}, ${courseId}, ${versionId}, 'full', 'manual', ${plus(TODAY, 30)})`);
    as(own);
    const ownResult = await actions.grantLearnRetry({ kind: "tries", assignmentId: (await assignmentOf(own.id)).id, amount: 1, reason: "I would like more" });
    expect(ownResult).toMatchObject({ ok: false });
    as(hr);
    expect((await actions.grantLearnRetry({ kind: "tries", assignmentId: a.id, amount: 1, reason: "" })).ok).toBe(false);
    expect((await actions.grantLearnRetry({ kind: "tries", assignmentId: a.id, amount: 99, reason: "Too many" })).ok).toBe(false);
    await db.execute(sql`update learn.assignments set status = 'cancelled' where id = ${a.id}`);
    expect(await actions.grantLearnRetry({ kind: "tries", assignmentId: a.id, amount: 1, reason: "It is closed" })).toEqual({ ok: false, error: "That training is not open." });
  });

  it("lets HR put someone on the training now, once", async () => {
    const hr = await makePerson({ roles: ["hr_admin"] });
    const person = await makePerson();
    as(hr);
    const first = await actions.assignLearnTraining({ userId: person.id, track: "essentials" });
    expect(first).toEqual({ ok: true, data: { created: true } });
    expect(await assignmentOf(person.id)).toMatchObject({ track: "essentials", reason: "manual" });
    expect(await actions.assignLearnTraining({ userId: person.id, track: "full" })).toEqual({ ok: true, data: { created: false } });
    const gone = await makePerson({ status: "separated" });
    expect(await actions.assignLearnTraining({ userId: gone.id, track: "full" })).toEqual({ ok: false, error: "That person is not an active team member with an account." });
  });
});
