import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test for the review fixes: the submitter's own line must be checked by someone else before a REAL run is approved, a
// test run sends no review notices, a run with payments or released statements can't become a test run, and a Jibble fill holds
// suggestions that are already on a line. Invented names and figures; periods are in 2042.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { addItem } = await import("@/modules/payroll/suggestions");
const { createPayLine, createPayRun, confirmRunLine, submitRun, sendBackRun, approveRun, markRunAsTest } = await import("@/modules/payroll/actions");
const { getWorksheet } = await import("@/modules/payroll/queries");
const { saveTimesheetUpload, buildTimesheetPreview, applyTimesheet } = await import("@/modules/payroll/timesheet-import");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
const as = (who: unknown) => {
  current.user = who;
};

async function account(level: "preparer" | "approver") {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("fix")}@example.com`}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  return { id, email: "x@example.com", roles: ["employee"], payrollAccess: level };
}
async function person(userId: string | null = null) {
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Liza', ${uniq("Testreyes")}, ${`${uniq("emp")}@example.com`}, 'active', ${userId}) returning id`);
  return e.id;
}
const slot = (n: number) => {
  const month = Math.floor(n / 2) + 1;
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(2042, month, 0)).getUTCDate();
  return n % 2 === 0 ? { periodStart: `2042-${mm}-01`, periodEnd: `2042-${mm}-15` } : { periodStart: `2042-${mm}-16`, periodEnd: `2042-${mm}-${last}` };
};
async function giveLine(employeeId: string, p: { periodStart: string; periodEnd: string }) {
  as(preparer);
  const r = await createPayLine({ employeeId, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: p.periodStart, endsOn: p.periodEnd, monthly: "22,000" });
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
}
async function newRun(p: { periodStart: string; periodEnd: string }, who: unknown, test = false) {
  as(who);
  const r = await createPayRun({ ...p, ...(test ? { test: true } : {}) });
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}
const runLineOf = async (runId: string, employeeId: string) => (await rows<{ id: string }>(sql`select id from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId} limit 1`))[0].id;
const notices = async (runId: string) => (await rows<{ n: number }>(sql`select count(*)::int as n from ops.notifications where link = ${`/payroll/${runId}`}`))[0].n;
async function approveAs(runId: string, who: unknown) {
  as(who);
  const sheet = (await getWorksheet(runId))!;
  return approveRun({ runId, expectedHash: sheet.expectedHash! });
}

let preparer: Awaited<ReturnType<typeof account>>;
let checker: Awaited<ReturnType<typeof account>>;
let approver: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  preparer = await account("preparer");
  checker = await account("preparer");
  approver = await account("approver");
});

describe("the submitter's own line on a real run", () => {
  it("is refused at approval until another Preparer has checked it, and a test run is exempt and silent", async () => {
    const p = slot(0);
    const mine = await account("preparer");
    const ownEmp = await person(mine.id);
    await giveLine(ownEmp, p);
    const runId = await newRun(p, mine);
    as(mine);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    expect(await notices(runId)).toBeGreaterThan(0); // a real run tells the approvers

    // A different Approver is still refused: the line of the person who sent the run has no check from anyone else.
    expect(await approveAs(runId, approver)).toMatchObject({ ok: false, error: expect.stringMatching(/sent this run for review has not been checked/) });
    expect((await rows<{ status: string }>(sql`select status from payroll.pay_runs where id = ${runId}`))[0].status).toBe("in_review");

    // Send it back, have a colleague check the line, send it again: now it can be approved.
    as(approver);
    expect(await sendBackRun({ runId, note: "Please get your line checked" })).toMatchObject({ ok: true });
    as(checker);
    expect(await confirmRunLine({ runLineId: await runLineOf(runId, ownEmp) })).toMatchObject({ ok: true });
    as(mine);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    expect(await approveAs(runId, approver)).toMatchObject({ ok: true });

    // A test run for the same period: no check is needed and nobody is sent notices.
    const testRun = await newRun(p, mine, true);
    as(mine);
    expect(await submitRun({ runId: testRun })).toMatchObject({ ok: true });
    expect(await approveAs(testRun, approver)).toMatchObject({ ok: true });
    as(approver);
    expect(await notices(testRun)).toBe(0);
  });
});

describe("a run with money or released statements can't become a test run", () => {
  it("refuses once a payment is recorded or the statements are released", async () => {
    const p = slot(2);
    const emp = await person();
    await giveLine(emp, p);
    const paidRun = await newRun(p, preparer);
    as(preparer);
    expect(await submitRun({ runId: paidRun })).toMatchObject({ ok: true });
    expect(await approveAs(paidRun, approver)).toMatchObject({ ok: true });

    // Before any payment it can still be marked.
    const other = slot(3);
    const emp2 = await person();
    await giveLine(emp2, other);
    const clean = await newRun(other, preparer);
    as(preparer);
    expect(await markRunAsTest({ runId: clean, test: true, reason: "Practice" })).toMatchObject({ ok: true });

    await db.execute(sql`insert into payroll.pay_payments (id, run_id, employee_id, reference_enc, paid_on, marked_by) values (${randomUUID()}, ${paidRun}, ${emp}, 'not-a-ciphertext', '2042-02-01', ${approver.id})`);
    as(preparer);
    expect(await markRunAsTest({ runId: paidRun, test: true, reason: "Practice" })).toMatchObject({ ok: false, error: expect.stringMatching(/payments recorded or statements released/) });
    expect((await rows<{ is_test: boolean }>(sql`select is_test from payroll.pay_runs where id = ${paidRun}`))[0].is_test).toBe(false);

    const q = slot(4);
    const emp3 = await person();
    await giveLine(emp3, q);
    const released = await newRun(q, preparer);
    as(preparer);
    expect(await submitRun({ runId: released })).toMatchObject({ ok: true });
    expect(await approveAs(released, approver)).toMatchObject({ ok: true });
    await db.execute(sql`insert into payroll.pay_run_releases (run_id, released_by, people_count) values (${released}, ${approver.id}, 1)`);
    as(preparer);
    expect(await markRunAsTest({ runId: released, test: true, reason: "Practice" })).toMatchObject({ ok: false, error: expect.stringMatching(/payments recorded or statements released/) });
  });
});

describe("a Jibble fill holds suggestions that are already on a line", () => {
  it("keeps the earlier suggestion unless asked to replace it, and says how many differ", async () => {
    const p = slot(6);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await newRun(p, preparer);
    const runLineId = await runLineOf(runId, emp);
    // An unconfirmed suggestion (from the other fill) of 10 client hours.
    as(preparer);
    await db.transaction((tx) => addItem(tx, preparer as never, { runId, employeeId: emp, runLineId, type: "client_hours", state: "suggested", value: 1000n, reason: null }));

    const sheet = {
      periodText: null,
      members: [{ code: "FIX-1", name: "Liza", days: [{ date: p.periodStart, payroll: 20 * 60, regular: 0, dailyOt: 0, doubleOt: 0, restDayOt: 0, weeklyOt: 0, holidayOt: 0, pto: 0 }] }],
    };
    const saved = await db.transaction((tx) => saveTimesheetUpload(tx, preparer as never, runId, sheet));
    const preview = (await buildTimesheetPreview(db, runId))!;
    // The one member is matched to the line only by name, so assign explicitly below; the preview counts conflicts on the matched line.
    expect(preview.skippedSheets).toBe(0);

    const held = await db.transaction((tx) => applyTimesheet(tx, preparer as never, { runId, importId: saved.importId, assignments: [{ code: "FIX-1", runLineId }] }));
    expect(held.held).toBe(1);
    expect(held.written).toBe(0);

    const saved2 = await db.transaction((tx) => saveTimesheetUpload(tx, preparer as never, runId, sheet));
    const replaced = await db.transaction((tx) => applyTimesheet(tx, preparer as never, { runId, importId: saved2.importId, assignments: [{ code: "FIX-1", runLineId }], replaceSuggestions: true }));
    expect(replaced.written).toBe(1);
    expect(replaced.held).toBe(0);
  });
});
