import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PDF_BYTES } from "./fake-storage";

// Real-database tests for onboarding and offboarding (Phase 3.4): the checklist a hire gets, automatic completion, who may tick what,
// completing onboarding, and the separation (status, assignments, account) with its safety rules.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.41" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const actions = await import("@/modules/onboarding/actions");
type Res = { ok: boolean; error?: string; data?: { caseId?: string; reference?: string } };
const act = actions as unknown as Record<string, (input: unknown) => Promise<Res>>;
const queries = await import("@/modules/onboarding/queries");
const service = await import("@/modules/onboarding/service");
const jobs = await import("@/modules/onboarding/jobs");
const recruitingActions = await import("@/modules/recruiting/actions");
const recruitingService = await import("@/modules/recruiting/service");
const { setLoginDisabler } = await import("@/modules/onboarding/accounts");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const forbidden = (p: Promise<unknown>) => p.then(() => "resolved", (e: Error) => e.name);

const disabled: string[] = [];
let hr: TestUser;
let hr2: TestUser;
let lead: TestUser;
let stranger: TestUser;
let recruiter: TestUser;
let openingId: string;
const dayOffset = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const yesterday = () => dayOffset(-2); // two days back is over in every zone, whatever the time of day

/** A real application (the case points at one): the applicant applies to the test opening. */
async function newApplication(): Promise<string> {
  const email = `${uniq("cand")}@example.com`;
  expect(await recruitingService.submitApplication({ openingId, fullName: "Ana Reyes", email, phone: "09170000000", consent: true, website: "" }, { bytes: PDF_BYTES, name: "cv.pdf" })).toEqual({ ok: true });
  const [app] = await rows<{ id: string }>(sql`select a.id from talent.applications a join talent.candidates c on c.id = a.candidate_id where lower(c.email) = ${email}`);
  return app.id;
}

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

/** A person with an account, reporting to `managerId` when given. */
async function makePerson(label: string, roles: RoleSlug[], managerId?: string) {
  const user = await makeUser(label, roles);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, start_date)
    values (${label}, 'Tester', ${user.email}, 'onboarding', ${user.id}, ${managerId ?? null}, '2026-01-05') returning id`);
  return { user, employeeId: e.id };
}

async function openCase(employeeId: string) {
  const applicationId = await newApplication();
  return db.transaction((tx) => service.openOnboardingCase(tx, { id: hr.id, email: hr.email }, { employeeId, applicationId, offerId: null, startDate: "2026-05-01", withoutOfferReason: "Test hire" }));
}

beforeAll(async () => {
  setDocumentStorage(new FakeStorage());
  setLoginDisabler(async (userId) => void disabled.push(userId));
  hr = await makeUser("hr", ["hr_admin"]);
  hr2 = await makeUser("hr2", ["hr_admin"]);
  stranger = await makeUser("stranger", ["employee"]);
  recruiter = await makeUser("recruiter", ["recruiter"]);
  const leadPerson = await makePerson("lead", ["team_lead"]);
  lead = leadPerson.user;
  as(recruiter);
  const made = await recruitingActions.saveOpening({ title: uniq("Onboarding VA "), description: "Support our clients with scheduling and inbox care.", hiringTeamUserIds: [lead.id] });
  if (!made.ok) throw new Error(made.error);
  openingId = (made.data as { id: string }).id;
  await recruitingActions.setOpeningStatus({ id: openingId, status: "open" });
  (globalThis as { __leadEmployeeId?: string }).__leadEmployeeId = leadPerson.employeeId;
});

const leadEmployeeId = () => (globalThis as { __leadEmployeeId?: string }).__leadEmployeeId as string;

describe("onboarding checklist", () => {
  it("creates the default tasks, owned by the right people, when onboarding opens", async () => {
    const hire = await makePerson("hire", ["employee"], leadEmployeeId());
    const c = await openCase(hire.employeeId);
    const tasks = await rows<{ owner: string; owner_user_id: string | null; check_kind: string }>(sql`select owner, owner_user_id, check_kind from talent.checklist_tasks where onboarding_case_id = ${c.caseId}`);
    expect(tasks.length).toBeGreaterThanOrEqual(7);
    expect(tasks.filter((t) => t.owner === "person").every((t) => t.owner_user_id === hire.user.id)).toBe(true);
    expect(tasks.filter((t) => t.owner === "lead").every((t) => t.owner_user_id === lead.id)).toBe(true);
    const notes = await rows<{ user_id: string }>(sql`select user_id from ops.notifications where kind = 'onboarding.started' and user_id in (${hire.user.id}, ${lead.id})`);
    expect(notes.length).toBe(2);
  });

  it("lets the lead tick their own task, but not the person's or HR's", async () => {
    const hire = await makePerson("hire2", ["employee"], leadEmployeeId());
    const c = await openCase(hire.employeeId);
    const [leadTask] = await rows<{ id: string }>(sql`select id from talent.checklist_tasks where onboarding_case_id = ${c.caseId} and owner = 'lead' and check_kind = 'manual' limit 1`);
    const [hrTask] = await rows<{ id: string }>(sql`select id from talent.checklist_tasks where onboarding_case_id = ${c.caseId} and owner = 'hr' and check_kind = 'manual' limit 1`);

    as(stranger);
    expect((await act.completeTask({ taskId: leadTask.id })).ok).toBe(false);
    as(lead);
    expect((await act.completeTask({ taskId: hrTask.id })).error).toBe(NO_ACCESS);
    expect((await act.completeTask({ taskId: leadTask.id })).ok).toBe(true);
    expect((await act.completeTask({ taskId: leadTask.id })).ok).toBe(false); // already closed
    as(hr);
    expect((await act.completeTask({ taskId: hrTask.id })).ok).toBe(true);
  });

  it("marks tasks done by itself (account), and refuses to complete while required tasks are open", async () => {
    const hire = await makePerson("hire3", ["employee"], leadEmployeeId());
    const c = await openCase(hire.employeeId);
    await service.syncCase("onboarding", c.caseId);
    const [acct] = await rows<{ status: string; auto_completed: boolean }>(sql`select status, auto_completed from talent.checklist_tasks where onboarding_case_id = ${c.caseId} and check_kind = 'account'`);
    expect(acct).toMatchObject({ status: "done", auto_completed: true });

    as(hr);
    const early = await act.completeOnboarding({ caseId: c.caseId });
    expect(early.ok).toBe(false);
    expect(early.error).toMatch(/required/);
    as(lead);
    expect((await act.completeOnboarding({ caseId: c.caseId })).error).toBe(NO_ACCESS);
  });

  it("completes onboarding once every required task is closed, and the person becomes active", async () => {
    const hire = await makePerson("hire4", ["employee"], leadEmployeeId());
    const c = await openCase(hire.employeeId);
    as(hr);
    const open = await rows<{ id: string }>(sql`select id from talent.checklist_tasks where onboarding_case_id = ${c.caseId} and status = 'todo' and required`);
    for (const t of open) {
      const r = await act.skipTask({ taskId: t.id, reason: "Handled outside ELEVATE" });
      expect(r.ok).toBe(true);
    }
    expect((await act.completeOnboarding({ caseId: c.caseId })).ok).toBe(true);
    const [e] = await rows<{ status: string }>(sql`select status from core.employees where id = ${hire.employeeId}`);
    expect(e.status).toBe("active");
    expect((await act.completeOnboarding({ caseId: c.caseId })).ok).toBe(false);
  });

  it("lets HR complete anyway with a reason when a task was forgotten: open tasks are closed as skipped, the person becomes active, it is audited", async () => {
    const hire = await makePerson("hire-stuck", ["employee"], leadEmployeeId());
    const c = await openCase(hire.employeeId);
    as(hr);
    // Everything but one task is done: the case is stuck on a task nobody ticked
    const todo = await rows<{ id: string; title: string }>(sql`select id, title from talent.checklist_tasks where onboarding_case_id = ${c.caseId} and status = 'todo' and required and check_kind = 'manual' order by created_at`);
    for (const t of todo.slice(1)) expect((await act.completeTask({ taskId: t.id })).ok).toBe(true);
    const stuck = await act.completeOnboarding({ caseId: c.caseId });
    expect(stuck.ok).toBe(false);
    expect(stuck.error).toMatch(/complete anyway/i);

    // A lead cannot, a reason that is too short is refused, then HR does it
    as(lead);
    expect((await act.completeOnboarding({ caseId: c.caseId, overrideReason: "Forgot to tick it" })).error).toBe(NO_ACCESS);
    as(hr);
    expect((await act.completeOnboarding({ caseId: c.caseId, overrideReason: "no" })).ok).toBe(false);
    expect((await act.completeOnboarding({ caseId: c.caseId, overrideReason: "She forgot to tick the second task" })).ok).toBe(true);

    const [e] = await rows<{ status: string }>(sql`select status from core.employees where id = ${hire.employeeId}`);
    expect(e.status).toBe("active");
    const closed = await rows<{ status: string; note: string | null }>(sql`select status, note from talent.checklist_tasks where onboarding_case_id = ${c.caseId} and id = ${todo[0].id}`);
    expect(closed[0].status).toBe("skipped");
    expect(closed[0].note).toContain("She forgot to tick the second task");
    expect((await rows(sql`select 1 from talent.checklist_tasks where onboarding_case_id = ${c.caseId} and status = 'todo' and not auto_completed and check_kind = 'manual'`))).toHaveLength(0);
    const [audit] = await rows<{ after: { overrideReason: string; openRequiredTasks: string[] } }>(sql`select after from ops.audit_log where action = 'onboarding.complete' and target_id = ${hire.employeeId} order by id desc limit 1`);
    expect(audit.after.overrideReason).toBe("She forgot to tick the second task");
    expect(audit.after.openRequiredTasks).toContain(todo[0].title);
    expect((await act.completeOnboarding({ caseId: c.caseId, overrideReason: "Again, for the record" })).ok).toBe(false); // already closed
  });

  it("lets HR tick a task ELEVATE would tick itself, with a reason; nobody else can", async () => {
    const hire = await makePerson("hire-auto", ["employee"], leadEmployeeId());
    const c = await openCase(hire.employeeId);
    const [policy] = await rows<{ id: string }>(sql`select id from talent.checklist_tasks where onboarding_case_id = ${c.caseId} and check_kind = 'policy' and status = 'todo' limit 1`);
    as(hire.user);
    expect((await act.completeTask({ taskId: policy.id })).error).toMatch(/by itself/);
    as(hr);
    expect((await act.completeTask({ taskId: policy.id })).error).toMatch(/reason/);
    expect((await act.completeTask({ taskId: policy.id, note: "Read it with her on a call" })).ok).toBe(true);
    const [row] = await rows<{ status: string; note: string }>(sql`select status, note from talent.checklist_tasks where id = ${policy.id}`);
    expect(row).toMatchObject({ status: "done", note: "Read it with her on a call" });
  });

  it("shows a person only their own onboarding, and a stranger none", async () => {
    const hire = await makePerson("hire5", ["employee"], leadEmployeeId());
    const c = await openCase(hire.employeeId);
    as(hire.user);
    expect((await queries.getOnboardingCase(c.caseId)).isPerson).toBe(true);
    as(stranger);
    expect(await forbidden(queries.getOnboardingCase(c.caseId))).toBe("ForbiddenError");
    as(lead);
    expect((await queries.getOnboardingCase(c.caseId)).canManage).toBe(false);
  });
});

describe("offboarding and separation", () => {
  async function startFor(employeeId: string, lastWorkingDay = yesterday()) {
    as(hr);
    const r = await act.startOffboarding({ employeeId, lastWorkingDay, reason: "resignation" });
    if (!r.ok) throw new Error(r.error);
    return r.data!.caseId as string;
  }

  it("refuses a last working day more than a week ago, and someone with active reports", async () => {
    const boss = await makePerson("boss", ["team_lead"]);
    await makePerson("report", ["employee"], boss.employeeId);
    as(hr);
    expect((await act.startOffboarding({ employeeId: boss.employeeId, lastWorkingDay: "2000-01-01", reason: "resignation" })).ok).toBe(false);
    const r = await act.startOffboarding({ employeeId: boss.employeeId, lastWorkingDay: yesterday(), reason: "resignation" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/active report/);
    as(lead);
    expect((await act.startOffboarding({ employeeId: boss.employeeId, lastWorkingDay: yesterday(), reason: "resignation" })).error).toBe(NO_ACCESS);
  });

  it("separates the person: status, end date, account disabled and archived, tasks closed, and a second run changes nothing", async () => {
    const leaver = await makePerson("leaver", ["employee"], leadEmployeeId());
    const caseId = await startFor(leaver.employeeId);
    const first = await service.executeSeparation(caseId, { id: hr.id, email: hr.email });
    expect(first.done).toBe(true);
    const [e] = await rows<{ status: string; end_date: string }>(sql`select status, end_date::text as end_date from core.employees where id = ${leaver.employeeId}`);
    expect(e).toMatchObject({ status: "separated", end_date: yesterday() });
    expect(disabled).toContain(leaver.user.id);
    const [u] = await rows<{ archived_at: Date | null }>(sql`select archived_at from core.users where id = ${leaver.user.id}`);
    expect(u.archived_at).not.toBeNull();
    const [access] = await rows<{ status: string }>(sql`select status from talent.checklist_tasks where offboarding_case_id = ${caseId} and check_kind = 'access'`);
    expect(access.status).toBe("done");

    const before = disabled.length;
    expect((await service.executeSeparation(caseId, null)).done).toBe(true);
    expect(disabled.length).toBe(before);
    // The case can no longer be cancelled
    as(hr);
    expect((await act.cancelOffboarding({ caseId })).ok).toBe(false);
  });

  it("only removes access once the last working day has ended, and the hourly job does it", async () => {
    const leaver = await makePerson("leaver2", ["employee"], leadEmployeeId());
    const future = dayOffset(5);
    const caseId = await startFor(leaver.employeeId, future);
    await jobs.runSeparations();
    const [still] = await rows<{ status: string }>(sql`select status from core.employees where id = ${leaver.employeeId}`);
    expect(still.status).not.toBe("separated");
    await db.execute(sql`update talent.offboarding_cases set last_working_day = ${yesterday()} where id = ${caseId}`);
    const result = await jobs.runSeparations();
    expect(result.separated).toBeGreaterThanOrEqual(1);
    const [gone] = await rows<{ status: string }>(sql`select status from core.employees where id = ${leaver.employeeId}`);
    expect(gone.status).toBe("separated");
  });

  it("can be cancelled before access is removed, and a person cannot be offboarded twice at once", async () => {
    const leaver = await makePerson("leaver3", ["employee"], leadEmployeeId());
    const caseId = await startFor(leaver.employeeId, yesterday());
    as(hr);
    expect((await act.startOffboarding({ employeeId: leaver.employeeId, lastWorkingDay: yesterday(), reason: "other" })).ok).toBe(false);
    expect((await act.cancelOffboarding({ caseId })).ok).toBe(true);
    const [e] = await rows<{ status: string }>(sql`select status from core.employees where id = ${leaver.employeeId}`);
    expect(e.status).not.toBe("separated");
  });

  it("keeps the exit interview private to HR", async () => {
    const leaver = await makePerson("leaver4", ["employee"], leadEmployeeId());
    const caseId = await startFor(leaver.employeeId, yesterday());
    as(stranger);
    expect((await act.submitExitInterview({ caseId, reasonForLeaving: "A better offer", wouldReturn: "yes" })).error).toBe(NO_ACCESS);
    as(leaver.user);
    expect((await act.submitExitInterview({ caseId, reasonForLeaving: "A better offer", wouldReturn: "yes" })).ok).toBe(true);
    expect((await act.submitExitInterview({ caseId, reasonForLeaving: "Again", wouldReturn: "no" })).ok).toBe(false);
    expect((await queries.getOffboardingCase(caseId)).exitInterview).toBeNull(); // the person does not read it back
    as(lead);
    const asLead = await queries.getOffboardingCase(caseId);
    expect(asLead.exitInterview).toBeNull();
    expect(asLead.exitSubmitted).toBe(true);
    as(hr2);
    expect((await queries.getOffboardingCase(caseId)).exitInterview?.reasonForLeaving).toBe("A better offer");
  });

  it("issues a certificate of engagement only for HR and audits it", async () => {
    const leaver = await makePerson("leaver5", ["employee"], leadEmployeeId());
    await startFor(leaver.employeeId, yesterday());
    as(lead);
    expect((await act.issueCertificate({ employeeId: leaver.employeeId })).error).toBe(NO_ACCESS);
    as(hr);
    const r = await act.issueCertificate({ employeeId: leaver.employeeId });
    expect(r.ok).toBe(true);
    expect(r.data?.reference).toMatch(/^CE-\d{4}-[0-9A-F]{6}$/);
    const audit = await rows(sql`select 1 from ops.audit_log where action = 'certificate.issue' and target_id = ${leaver.employeeId}`);
    expect(audit.length).toBe(1);
  });
});

describe("starting onboarding for a person added directly under People", () => {
  it("opens the checklist from the template, once, and lists only people without one", async () => {
    const direct = await makePerson("direct", ["employee"], leadEmployeeId());
    as(hr);
    const before = await queries.listOnboardingCandidates();
    expect(before.some((p) => p.id === direct.employeeId)).toBe(true);

    const started = await actions.startOnboarding({ employeeId: direct.employeeId, startDate: "2026-11-02" });
    expect(started.ok).toBe(true);
    const caseId = (started as { data: { caseId: string } }).data.caseId;
    const [c] = await rows<{ status: string; application_id: string | null; start_date: string }>(sql`select status, application_id, start_date::text from talent.onboarding_cases where id = ${caseId}`);
    expect(c).toMatchObject({ status: "open", application_id: null, start_date: "2026-11-02" });
    expect((await rows(sql`select 1 from talent.checklist_tasks where onboarding_case_id = ${caseId}`)).length).toBeGreaterThanOrEqual(7);

    // Once only, and no longer offered
    expect((await actions.startOnboarding({ employeeId: direct.employeeId, startDate: "2026-11-02" })).ok).toBe(false);
    expect((await queries.listOnboardingCandidates()).some((p) => p.id === direct.employeeId)).toBe(false);
    // It shows in the cases list as in progress
    expect((await queries.listOnboardingCases()).some((r) => r.employeeId === direct.employeeId && r.status === "open")).toBe(true);
  });

  it("is HR only", async () => {
    const other = await makePerson("direct2", ["employee"]);
    as(stranger);
    expect((await actions.startOnboarding({ employeeId: other.employeeId, startDate: "2026-11-02" })).ok).toBe(false);
    as(recruiter);
    expect((await actions.startOnboarding({ employeeId: other.employeeId, startDate: "2026-11-02" })).ok).toBe(false);
  });
});
