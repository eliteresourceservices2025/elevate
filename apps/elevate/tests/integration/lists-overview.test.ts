import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test for the Payroll runs list (people, payments, step, next step, filters, summary) and the Invoices list (search, test
// filter, this month's total). Invented people, clients and figures; periods are in 2043 and 2044 so they never overlap another file.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { createPayLine, createPayRun, savePayItem, submitRun, approveRun } = await import("@/modules/payroll/actions");
const { getRuns, getWorksheet } = await import("@/modules/payroll/queries");
const { createInvoice, addBillRate, voidInvoice } = await import("@/modules/invoices/actions");
const { listInvoices } = await import("@/modules/invoices/queries");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
const as = (who: unknown) => {
  current.user = who;
};

async function account(role: RoleSlug, level: "preparer" | "approver" | "viewer" | null) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("ovw")}@example.com`}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  return { id, email: "x@example.com", roles: [role], payrollAccess: level };
}

let preparer: Awaited<ReturnType<typeof account>>;
let approver: Awaited<ReturnType<typeof account>>;
let viewer: Awaited<ReturnType<typeof account>>;
let hr: Awaited<ReturnType<typeof account>>;
let client = "";
let clientName = "";
let employeeId = "";

const PAGE = { page: 1, pageSize: 100 };

async function newRun(periodStart: string, periodEnd: string, test: boolean) {
  as(preparer);
  const r = await createPayRun({ periodStart, periodEnd, ...(test ? { test: true } : {}) });
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}
const runLineId = async (runId: string) => (await rows<{ id: string }>(sql`select id from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId} limit 1`))[0].id;

beforeAll(async () => {
  preparer = await account("employee", "preparer");
  approver = await account("employee", "approver");
  viewer = await account("employee", "viewer");
  hr = await account("hr_admin", null);
  clientName = uniq("Overviewclinic ");
  client = (await rows<{ id: string }>(sql`insert into core.clients (name) values (${clientName}) returning id`))[0].id;
  employeeId = (await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status) values ('Liza', ${uniq("Testreyes")}, ${`${uniq("emp")}@example.com`}, 'active') returning id`))[0].id;
  as(preparer);
  const line = await createPayLine({ employeeId, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2043-01-01", endsOn: "2044-12-31", monthly: "22,000", clientId: client });
  if (!line.ok) throw new Error(`line failed: ${line.error}`);
  as(hr);
  const rate = await addBillRate({ clientId: client, effectiveFrom: "2020-01-01", rate: "20.00" });
  if (!rate.ok) throw new Error("rate failed");
});

describe("the runs list", () => {
  it("counts people, names the step and what each level does next, and filters to what needs the viewer", async () => {
    const draft = await newRun("2043-03-01", "2043-03-15", false);
    const reviewed = await newRun("2043-03-16", "2043-03-31", false);
    as(preparer);
    // Put the second run in review so an Approver has something to do (the line belongs to a person with no account, so no own-line rule applies).
    expect(await submitRun({ runId: reviewed })).toMatchObject({ ok: true });

    as(preparer);
    const p = await getRuns(PAGE);
    const d = p.rows.find((r) => r.id === draft)!;
    const rv = p.rows.find((r) => r.id === reviewed)!;
    expect(d).toMatchObject({ status: "draft", step: 1, peopleCount: 1, paidCount: 0, nextStep: { label: "Continue", mine: true } });
    expect(rv).toMatchObject({ status: "in_review", step: 2, nextStep: { label: "Waiting for approval", mine: false } });

    as(approver);
    const a = await getRuns(PAGE);
    expect(a.rows.find((r) => r.id === reviewed)!.nextStep).toEqual({ label: "Approve", mine: true });
    expect(a.rows.find((r) => r.id === draft)!.nextStep).toBeNull();

    // The "needs you" view lists what waits for this person only.
    const mineApprover = await getRuns(PAGE, { view: "action" });
    expect(mineApprover.rows.map((r) => r.id)).toContain(reviewed);
    expect(mineApprover.rows.map((r) => r.id)).not.toContain(draft);
    as(preparer);
    const minePreparer = await getRuns(PAGE, { view: "action" });
    expect(minePreparer.rows.map((r) => r.id)).toContain(draft);
    expect(minePreparer.rows.map((r) => r.id)).not.toContain(reviewed);
    expect(minePreparer.actionCount).toBeGreaterThanOrEqual(1);
    // A viewer has nothing to do.
    as(viewer);
    const v = await getRuns(PAGE, { view: "action" });
    expect(v.rows).toEqual([]);
    expect(v.actionCount).toBe(0);
  });

  it("test runs get their own view and never count in the summary", async () => {
    const test = await newRun("2043-05-01", "2043-05-20", true);
    as(preparer);
    const before = await getRuns(PAGE);
    const onlyTest = await getRuns(PAGE, { view: "test" });
    expect(onlyTest.rows.every((r) => r.isTest)).toBe(true);
    expect(onlyTest.rows.map((r) => r.id)).toContain(test);
    // The summary reads real runs only: its numbers do not move when a test run is added.
    const inReviewBefore = before.summary.inReview;
    const t2 = await newRun("2043-06-01", "2043-06-10", true);
    as(preparer);
    expect(await submitRun({ runId: t2 })).toMatchObject({ ok: true });
    expect((await getRuns(PAGE)).summary.inReview).toBe(inReviewBefore);
  });

  it("a person with no payroll level reads nothing", async () => {
    as(hr);
    await expect(getRuns(PAGE)).rejects.toThrow();
  });
});

describe("the invoices list", () => {
  it("searches by number and client, filters test invoices, and adds up this month's real live invoices only", async () => {
    // A real run with hours, approved, so a real invoice can be made; and a test run for a test invoice.
    const real = await newRun("2044-01-01", "2044-01-15", false);
    const line = await runLineId(real);
    as(preparer);
    expect(await savePayItem({ runId: real, employeeId, runLineId: line, type: "client_hours", value: "10" })).toMatchObject({ ok: true });
    expect(await submitRun({ runId: real })).toMatchObject({ ok: true });
    as(approver);
    const sheet = (await getWorksheet(real))!;
    expect(await approveRun({ runId: real, expectedHash: sheet.expectedHash! })).toMatchObject({ ok: true });
    const test = await newRun("2044-02-01", "2044-02-20", true);
    as(preparer);
    expect(await savePayItem({ runId: test, employeeId, runLineId: await runLineId(test), type: "client_hours", value: "5" })).toMatchObject({ ok: true });

    as(hr);
    const before = await listInvoices(PAGE);
    const inv = await createInvoice({ runId: real, clientId: client });
    const tinv = await createInvoice({ runId: test, clientId: client });
    if (!inv.ok || !tinv.ok) throw new Error("invoice failed");

    const after = await listInvoices(PAGE);
    // $20.00 an hour for 10 hours: this month's total grows by $200.00 for the real invoice and nothing for the test one.
    expect(after.billedThisMonthCents - before.billedThisMonthCents).toBe(20_000n);

    // Search by number, by client name (any case, partly) and by something that matches nothing.
    expect((await listInvoices(PAGE, { q: inv.data.number })).rows.map((r) => r.id)).toContain(inv.data.invoiceId);
    expect((await listInvoices(PAGE, { q: clientName.slice(2, 14).toUpperCase() })).rows.map((r) => r.id)).toEqual(expect.arrayContaining([inv.data.invoiceId, tinv.data.invoiceId]));
    expect((await listInvoices(PAGE, { q: "no-such-invoice-or-client-zz" })).rows).toEqual([]);
    // LIKE characters in the search are literal, not wildcards.
    expect((await listInvoices(PAGE, { q: "%" })).rows).toEqual([]);

    // The test filter lists test invoices only.
    const tests = await listInvoices(PAGE, { show: "test" });
    expect(tests.rows.length).toBeGreaterThan(0);
    expect(tests.rows.every((r) => r.isTest)).toBe(true);
    expect(tests.rows.map((r) => r.id)).toContain(tinv.data.invoiceId);

    // Voiding the real invoice takes it out of the live list and out of this month's total.
    expect(await voidInvoice({ invoiceId: inv.data.invoiceId, reason: "Wrong client" })).toMatchObject({ ok: true });
    const voided = await listInvoices(PAGE);
    expect(voided.rows.map((r) => r.id)).not.toContain(inv.data.invoiceId);
    expect(voided.billedThisMonthCents).toBe(before.billedThisMonthCents);
    // ...but it is still there under "all", and the old ?all option still means the same.
    expect((await listInvoices(PAGE, { show: "all" })).rows.find((r) => r.id === inv.data.invoiceId)?.state).toBe("voided");
    expect((await listInvoices(PAGE, { all: true })).rows.map((r) => r.id)).toContain(inv.data.invoiceId);
  });
});
