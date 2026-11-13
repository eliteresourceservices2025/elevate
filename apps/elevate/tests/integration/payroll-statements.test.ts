import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: the payroll team's statements pages and routes, and the release of statements to the contractors. Invented people
// and figures only. Every period is a half month of 2037 (no other file uses 2037) and each test uses its own; the pay lines are ended
// afterwards by the shared helper.

const current = vi.hoisted(() => ({ user: null as unknown, allow: true }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => current.allow) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { createPayLine, createPayRun, submitRun, approveRun, releaseStatements, markRunAsTest } = await import("@/modules/payroll/actions");
const { getWorksheet } = await import("@/modules/payroll/queries");
const { getRunStatements, getStatementRuns, getStatementForTeam, getAllStatementsForTeam } = await import("@/modules/payroll/statements-queries");
const { decryptRunLine } = await import("@/modules/payroll/service");
const { formatPesos } = await import("@/modules/payroll/money");
const single = await import("@/app/api/payroll/statements/[runId]/[employeeId]/route");
const all = await import("@/app/api/payroll/statements/[runId]/route");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let seq = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}x${seq++}`;
const NO_ACCESS = "You do not have access to do that.";

async function account(level: string | null) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("st")}@example.com`}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  return { id, email: `${id}@example.com`, roles: ["employee"], payrollAccess: level };
}
async function person(last = uniq("Testreyes"), userId: string | null = null) {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values ('Mara', ${last}, ${`${uniq("emp")}@example.com`}, 'active', ${userId}) returning id`);
  return e.id;
}
/** Half month `n` of 2037. */
function slot(n: number) {
  const month = Math.floor(n / 2) + 1;
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(2037, month, 0)).getUTCDate();
  return n % 2 === 0 ? { periodStart: `2037-${mm}-01`, periodEnd: `2037-${mm}-15` } : { periodStart: `2037-${mm}-16`, periodEnd: `2037-${mm}-${last}` };
}
const as = (who: unknown) => {
  current.user = who;
};

let preparer: Awaited<ReturnType<typeof account>>;
let approver: Awaited<ReturnType<typeof account>>;
let viewer: Awaited<ReturnType<typeof account>>;
let nobody: Awaited<ReturnType<typeof account>>;

async function giveLine(employeeId: string, p: { periodStart: string; periodEnd: string }, over: Record<string, unknown> = {}) {
  as(preparer);
  const r = await createPayLine({ employeeId, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: p.periodStart, endsOn: p.periodEnd, monthly: "22,000", ...over });
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
}
async function draftRun(p: { periodStart: string; periodEnd: string }) {
  as(preparer);
  const r = await createPayRun(p);
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}
async function approvedRun(p: { periodStart: string; periodEnd: string }, people: string[]) {
  for (const e of people) await giveLine(e, p);
  const runId = await draftRun(p);
  as(preparer);
  const s = await submitRun({ runId });
  if (!s.ok) throw new Error(`submit failed: ${s.error}`);
  as(approver);
  const a = await approveRun({ runId, expectedHash: (await getWorksheet(runId))!.expectedHash! });
  if (!a.ok) throw new Error(`approve failed: ${a.error}`);
  return runId;
}
const netOf = async (runId: string, employeeId: string) =>
  (await rows<{ id: string; payload_enc: string }>(sql`select id, payload_enc from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId}`)).reduce(
    (s, n) => s + decryptRunLine(n.id, n.payload_enc).result.net,
    0n,
  );
const releaseRows = (runId: string) => rows(sql`select 1 from payroll.pay_run_releases where run_id = ${runId}`);
const call = {
  one: (runId: string, employeeId: string) => single.GET(new Request("http://localhost/x"), { params: Promise.resolve({ runId, employeeId }) }),
  all: (runId: string) => all.GET(new Request("http://localhost/x"), { params: Promise.resolve({ runId }) }),
};

beforeAll(async () => {
  preparer = await account("preparer");
  approver = await account("approver");
  viewer = await account("viewer");
  nobody = await account(null);
});

describe("releasing the statements", () => {
  it("is for an Approver, refused for a draft and an in-review run, done once, and recorded with counts only", async () => {
    const p = slot(0);
    const a = await person();
    const b = await person();
    for (const e of [a, b]) await giveLine(e, p);
    const runId = await draftRun(p);

    // A draft and a run in review have nothing to release.
    as(approver);
    expect(await releaseStatements({ runId })).toMatchObject({ ok: false, error: "Release is available once the run is approved." });
    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    as(approver);
    expect(await releaseStatements({ runId })).toMatchObject({ ok: false, error: "Release is available once the run is approved." });
    expect(await approveRun({ runId, expectedHash: (await getWorksheet(runId))!.expectedHash! })).toMatchObject({ ok: true });

    // Only an Approver may release.
    for (const who of [preparer, viewer, nobody]) {
      as(who);
      expect(await releaseStatements({ runId })).toEqual({ ok: false, error: NO_ACCESS });
    }
    expect(await releaseRows(runId)).toHaveLength(0);

    as(approver);
    expect(await releaseStatements({ runId })).toEqual({ ok: true, data: { people: 2 } });
    expect(await releaseRows(runId)).toHaveLength(1);
    expect(await releaseStatements({ runId })).toMatchObject({ ok: false, error: "These statements have been released to the contractors." });
    expect(await releaseRows(runId)).toHaveLength(1);

    // Counts only in the audit entry, and the change history has its row.
    const [audit] = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where target_id = ${runId} and action = 'payroll.statements.release'`);
    expect(audit.metadata).toEqual({ people: 2 });
    expect(await rows(sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'statements_released'`)).toHaveLength(1);
    // A release is a fact that is never changed or removed.
    await expect(db.execute(sql`update payroll.pay_run_releases set people_count = 99 where run_id = ${runId}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from payroll.pay_run_releases where run_id = ${runId}`)).rejects.toThrow();
  });

  it("is never allowed for a test run, even an approved one, and a bad request is refused before any read", async () => {
    const p = slot(1);
    const runId = await approvedRun(p, [await person()]);
    as(preparer);
    expect(await markRunAsTest({ runId, test: true, reason: "Practice cycle" })).toMatchObject({ ok: true });
    as(approver);
    expect(await releaseStatements({ runId })).toMatchObject({ ok: false, error: expect.stringMatching(/test run is never released/) });
    expect(await releaseRows(runId)).toHaveLength(0);
    expect(await releaseStatements({ runId: "nope" })).toEqual({ ok: false, error: "Check the request and try again." });
    expect(await releaseStatements({ runId: randomUUID() })).toMatchObject({ ok: false, error: "That pay run was not found." });
  });
});

describe("the payroll team's view of the statements", () => {
  it("lists approved runs only, shows each person's statement summary to every payroll level, and refuses anyone without one", async () => {
    const p = slot(2);
    const a = await person("Aaastatement");
    const b = await person("Bbbstatement");
    await giveLine(a, slot(3));
    const draft = await draftRun(slot(3)); // a draft has no statements yet
    const runId = await approvedRun(p, [a, b]);

    for (const who of [viewer, preparer, approver]) {
      as(who);
      const view = (await getRunStatements(runId))!;
      expect(view.run).toMatchObject({ id: runId, status: "approved", isTest: false });
      expect(view.people.map((x) => x.name)).toEqual([expect.stringContaining("Aaastatement"), expect.stringContaining("Bbbstatement")]);
      expect(view.people[0].net).toBe(formatPesos(await netOf(runId, a)));
      expect(view.releasedAt).toBeNull();
    }
    // Who may press the button and why not.
    as(viewer);
    expect((await getRunStatements(runId))!.refusal).toBe("An Approver releases the statements.");
    as(preparer);
    expect((await getRunStatements(runId))!.canRelease).toBe(false);
    as(approver);
    expect(await getRunStatements(runId)).toMatchObject({ canRelease: true, refusal: null });
    expect(await getRunStatements(draft)).toBeNull();
    expect(await getRunStatements(randomUUID())).toBeNull();
    expect(await getRunStatements("nope")).toBeNull();

    as(nobody);
    await expect(getRunStatements(runId)).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(getStatementRuns({ page: 1, pageSize: 50 })).rejects.toMatchObject({ name: "ForbiddenError" });

    as(viewer);
    const list = await getStatementRuns({ page: 1, pageSize: 200 });
    expect(list.rows.find((r) => r.runId === runId)).toMatchObject({ people: 2, releasedAt: null, isTest: false });
    expect(list.rows.some((r) => r.runId === draft)).toBe(false);

    as(approver);
    expect(await releaseStatements({ runId })).toMatchObject({ ok: true });
    as(viewer);
    expect((await getRunStatements(runId))!).toMatchObject({ releasedAt: expect.any(String), refusal: "These statements have been released to the contractors." });
    expect((await getStatementRuns({ page: 1, pageSize: 200 })).rows.find((r) => r.runId === runId)!.releasedAt).not.toBeNull();
  });

  it("opens every statement of an approved run, including a test run's (stamped TEST), and audits each view without an amount", async () => {
    const p = slot(4);
    const a = await person("Cccopen");
    const b = await person("Dddopen");
    const runId = await approvedRun(p, [a, b]);
    as(preparer);
    expect(await markRunAsTest({ runId, test: true, reason: "Rehearsal" })).toMatchObject({ ok: true });

    as(viewer);
    const slip = (await getStatementForTeam(runId, a))!;
    expect(slip.isTest).toBe(true);
    expect(slip.name).toContain("Cccopen");
    expect(await getStatementForTeam(runId, randomUUID())).toBeNull(); // someone not on this run
    expect(await getStatementForTeam(randomUUID(), a)).toBeNull();
    expect(await getStatementForTeam("nope", a)).toBeNull();
    const everyone = (await getAllStatementsForTeam(runId))!;
    expect(everyone.map((s) => s.name)).toEqual([expect.stringContaining("Cccopen"), expect.stringContaining("Dddopen")]);
    as(nobody);
    await expect(getStatementForTeam(runId, a)).rejects.toMatchObject({ name: "ForbiddenError" });
    await expect(getAllStatementsForTeam(runId)).rejects.toMatchObject({ name: "ForbiddenError" });

    const audits = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where target_id = ${runId} and action = 'sensitive.view'`);
    const text = JSON.stringify(audits);
    expect(text).toContain("statement");
    for (const n of [await netOf(runId, a), await netOf(runId, b)]) expect(text).not.toContain(formatPesos(n));
  });
});

describe("the download routes", () => {
  it("give one statement as a PDF to anyone with payroll access, 404 to everyone else, and never cache it", async () => {
    const p = slot(5);
    const a = await person("Eeeroute");
    const runId = await approvedRun(p, [a]);

    as(viewer);
    const ok = await call.one(runId, a);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toBe("application/pdf");
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const missing = await call.one(randomUUID(), a);
    expect(missing.status).toBe(404);
    const missingBody = await missing.text();
    as(nobody);
    for (const r of [await call.one(runId, a), await call.all(runId)]) {
      expect(r.status).toBe(404);
      expect(await r.text()).toBe(missingBody);
    }
    as(viewer);
    expect((await call.one(runId, randomUUID())).status).toBe(404);
    current.allow = false;
    try {
      expect((await call.one(runId, a)).status).toBe(429);
      expect((await call.all(runId)).status).toBe(429);
    } finally {
      current.allow = true;
    }
  });

  it("give every statement of a run as one PDF, in name order, and name a test run's file TEST", async () => {
    const p = slot(6);
    const people = [await person("Fffall"), await person("Ggggall"), await person("Hhhhall")];
    const runId = await approvedRun(p, people);

    as(viewer);
    const real = await call.all(runId);
    expect(real.status).toBe(200);
    expect(real.headers.get("Content-Disposition")).toMatch(/contractor-payment-statements-2037-04-01-to-2037-04-15\.pdf/);
    expect((await PDFDocument.load(new Uint8Array(await real.arrayBuffer()))).getPageCount()).toBeGreaterThanOrEqual(3);

    as(preparer);
    expect(await markRunAsTest({ runId, test: true, reason: "Rehearsal" })).toMatchObject({ ok: true });
    as(viewer);
    const test = await call.all(runId);
    expect(test.status).toBe(200);
    expect(test.headers.get("Content-Disposition")).toContain("-TEST.pdf");
    expect((await call.all(randomUUID())).status).toBe(404);
  });
});
