import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PNG_BYTES } from "./fake-storage";

// Technical issue reports: a contractor reports a clock or Jibble problem whatever their clock state, it changes no clock events,
// the lead and HR are told, a lead handles their own people's reports and HR everyone's, and nobody handles their own.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/attendance/issue-actions");
const attendanceActions = await import("@/modules/attendance/actions");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const queries = await import("@/modules/attendance/issue-queries");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const NO_ACCESS = "You do not have access to do that.";

async function person(label: string, roles: RoleSlug[] = ["employee"], managerEmployeeId?: string) {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  const n = uniq(label);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id)
    values (${label}, ${n}, ${n + "@example.com"}, 'active', ${id}, ${managerEmployeeId ?? null}) returning id`);
  return { user: { id, email, roles } as TestUser, employeeId: e.id };
}

const fake = new FakeStorage();

/** One uploaded screenshot (as the browser does: a ticket, then the file), ready to attach. */
async function shot(bytes: Uint8Array = PNG_BYTES, mime = "image/png"): Promise<string> {
  const ticket = await attendanceActions.requestEvidenceUpload({ mime, size: bytes.length });
  if (!ticket.ok) throw new Error(ticket.error);
  fake.put("employee-docs", ticket.data.path, bytes);
  return ticket.data.id;
}

const report = async (extra: Record<string, unknown> = {}) =>
  actions.reportTechIssue({ kind: "jibble", happenedAt: new Date(Date.now() - 20 * 60_000).toISOString(), details: "Jibble kept running after I clocked out in ELEVATE.", ...("evidenceIds" in extra ? {} : { evidenceIds: [await shot()] }), ...extra });
const notified = async (userId: string) => (await rows<{ n: number }>(sql`select count(*)::int as n from ops.notifications where user_id = ${userId} and kind = 'attendance.issue_reported'`))[0].n;

let hr: { user: TestUser; employeeId: string };
beforeAll(async () => {
  setDocumentStorage(fake);
  hr = await person("ti-hr", ["hr_admin", "employee"]);
});

describe("technical issue reports", () => {
  it("is accepted with no clock events at all, changes no clock events, and tells the lead and HR", async () => {
    const lead = await person("ti-lead", ["team_lead", "employee"]);
    const worker = await person("ti-worker", ["employee"], lead.employeeId);
    as(worker.user);
    expect(await report()).toEqual({ ok: true, data: undefined });
    expect(await rows(sql`select 1 from time.clock_events where employee_id = ${worker.employeeId}`)).toHaveLength(0);
    expect(await notified(lead.user.id)).toBe(1);
    expect(await notified(hr.user.id)).toBeGreaterThanOrEqual(1);
    const mine = await queries.listMyIssues();
    expect(mine?.items).toHaveLength(1);
    expect(mine?.items[0]).toMatchObject({ kind: "jibble", status: "open" });
  });

  it("needs a screenshot, which only the person, their lead and HR can open", async () => {
    const lead = await person("ti-lead-s", ["team_lead", "employee"]);
    const worker = await person("ti-worker-s", ["employee"], lead.employeeId);
    const stranger = await person("ti-stranger", ["employee"]);
    as(worker.user);
    expect(await report({ evidenceIds: [] })).toMatchObject({ ok: false, error: "Attach a screenshot that shows the problem" });
    expect((await report({ evidenceIds: undefined })).ok).toBe(false);
    const mine = await shot();
    expect((await report({ evidenceIds: [mine] })).ok).toBe(true);
    // One screenshot, one report: it cannot be reused, and a file that is not an image is refused
    expect((await report({ evidenceIds: [mine] })).ok).toBe(false);
    expect((await report({ evidenceIds: [await shot(new TextEncoder().encode("MZ not an image"))] })).ok).toBe(false);
    expect((await queries.listMyIssues())?.items[0].evidence).toHaveLength(1);
    const evidenceId = (await queries.listMyIssues())!.items[0].evidence[0].id;
    expect((await attendanceActions.openEvidence({ evidenceId })).ok).toBe(true);
    as(lead.user);
    expect((await attendanceActions.openEvidence({ evidenceId })).ok).toBe(true);
    as(stranger.user);
    expect((await attendanceActions.openEvidence({ evidenceId })).ok).toBe(false);
  });

  it("refuses a time in the future, one older than 31 days, empty details, and a sixth open report", async () => {
    const worker = await person("ti-limits");
    as(worker.user);
    // Refused reports leave the screenshot unused, so one spare is reused for all of them (a person may hold 6 unused at most)
    const spare = { evidenceIds: [await shot()] };
    expect((await report({ ...spare, happenedAt: new Date(Date.now() + 3_600_000).toISOString() })).ok).toBe(false);
    expect((await report({ ...spare, happenedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() })).ok).toBe(false);
    expect((await report({ ...spare, details: "  " })).ok).toBe(false);
    expect((await report({ ...spare, kind: "nonsense" })).ok).toBe(false);
    for (let i = 0; i < 5; i++) expect((await report()).ok).toBe(true);
    expect(await report(spare)).toMatchObject({ ok: false, error: expect.stringContaining("already have 5 reports") });
  });

  it("is handled by the lead of that person or HR, not by another lead, not by the reporter", async () => {
    const lead = await person("ti-lead2", ["team_lead", "employee"]);
    const otherLead = await person("ti-lead3", ["team_lead", "employee"]);
    const worker = await person("ti-w2", ["employee"], lead.employeeId);
    as(worker.user);
    expect((await report()).ok).toBe(true);
    const [issue] = await rows<{ id: string }>(sql`select id::text as id from time.tech_issue_reports where employee_id = ${worker.employeeId}`);

    // The queue: this lead sees it, another lead does not, the employee has no queue
    as(lead.user);
    expect((await queries.listIssueQueue()).items.find((i) => i.id === issue.id)).toMatchObject({ canHandle: true });
    as(otherLead.user);
    expect((await queries.listIssueQueue()).items.some((i) => i.id === issue.id)).toBe(false);
    expect(await actions.handleTechIssue({ issueId: issue.id })).toEqual({ ok: false, error: NO_ACCESS });
    as(worker.user);
    await expect(queries.listIssueQueue()).rejects.toThrow();
    expect((await actions.handleTechIssue({ issueId: issue.id })).ok).toBe(false);

    as(lead.user);
    expect(await actions.handleTechIssue({ issueId: issue.id, note: "Thanks, I told HR to check Jibble." })).toEqual({ ok: true, data: undefined });
    expect(await actions.handleTechIssue({ issueId: issue.id })).toEqual({ ok: false, error: "That report was already handled." });
    as(worker.user);
    const mine = await queries.listMyIssues();
    expect(mine?.items[0]).toMatchObject({ status: "handled", handlingNote: "Thanks, I told HR to check Jibble." });
  });

  it("HR sees and handles everyone's, but not their own", async () => {
    const worker = await person("ti-w3");
    as(worker.user);
    expect((await report()).ok).toBe(true);
    const [issue] = await rows<{ id: string }>(sql`select id::text as id from time.tech_issue_reports where employee_id = ${worker.employeeId}`);
    as(hr.user);
    expect((await queries.listIssueQueue()).items.find((i) => i.id === issue.id)).toMatchObject({ canHandle: true });
    expect((await actions.handleTechIssue({ issueId: issue.id })).ok).toBe(true);

    as(hr.user);
    expect((await report()).ok).toBe(true);
    const [own] = await rows<{ id: string }>(sql`select id::text as id from time.tech_issue_reports where employee_id = ${hr.employeeId} limit 1`);
    expect(await actions.handleTechIssue({ issueId: own.id })).toEqual({ ok: false, error: "Someone else must handle your own report." });
  });
});
