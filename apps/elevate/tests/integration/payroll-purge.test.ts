import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: archiving a cancelled run, and deleting archived test runs, cancelled runs and test invoices for good. Invented people,
// clients and figures. Periods are in 2041 so they never overlap another file's runs.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { createPayLine, createPayRun, cancelPayRun, savePayItem, archivePayRun, restorePayRun, purgeArchivedPayRuns } = await import("@/modules/payroll/actions");
const { createInvoice, addBillRate, archiveInvoice, voidInvoice, purgeArchivedInvoices } = await import("@/modules/invoices/actions");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function account(role: RoleSlug, level: string | null = null) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("purge")}@example.com`}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  return { id, email: "x@example.com", roles: [role], payrollAccess: level };
}
async function person(first = "Maria") {
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status) values (${first}, ${uniq("Testcruz")}, ${`${uniq("emp")}@example.com`}, 'active') returning id`);
  return e.id;
}
async function newClient() {
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Purgeclinic ")}) returning id`);
  return c.id;
}
const as = <T,>(who: unknown, fn: () => Promise<T>) => {
  current.user = who;
  return fn();
};

let preparer: Awaited<ReturnType<typeof account>>;
let hr: Awaited<ReturnType<typeof account>>;
let nobody: Awaited<ReturnType<typeof account>>;

// One client and one billing rate for the whole file (the rates list is paged, so this file must not add a client for each test).
let sharedClient = "";
async function setup() {
  const client = sharedClient;
  const ana = await person("Ana");
  const line = await as(preparer, () => createPayLine({ employeeId: ana, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2031-01-01", monthly: "22,000", clientId: client }));
  if (!line.ok) throw new Error(`line failed: ${line.error}`);
  return { client, ana };
}
async function newRun(periodStart: string, periodEnd: string, test: boolean) {
  const r = await as(preparer, () => createPayRun({ periodStart, periodEnd, test }));
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}
async function setHours(runId: string, employeeId: string, value: string) {
  const [l] = await rows<{ id: string }>(sql`select id from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId} limit 1`);
  const r = await as(preparer, () => savePayItem({ runId, employeeId, runLineId: l.id, type: "client_hours", value }));
  if (!r.ok) throw new Error(`hours failed: ${r.error}`);
}
const runGone = async (id: string) => (await rows(sql`select 1 from payroll.pay_runs where id = ${id}`)).length === 0;
const invGone = async (id: string) => (await rows(sql`select 1 from ops.invoices where id = ${id}`)).length === 0;

beforeAll(async () => {
  preparer = await account("employee", "preparer");
  hr = await account("hr_admin");
  nobody = await account("employee");
  sharedClient = await newClient();
  const rate = await as(hr, () => addBillRate({ clientId: sharedClient, effectiveFrom: "2020-01-01", rate: "10.00" }));
  if (!rate.ok) throw new Error("rate failed");
});

describe("a cancelled run can be archived and deleted", () => {
  it("archives a cancelled real run (a real draft cannot be archived), restores it, and deletes it only once archived", async () => {
    await setup();
    const real = await newRun("2041-01-01", "2041-01-15", false);

    // A real run that is not cancelled can't be archived.
    expect(await as(preparer, () => archivePayRun({ runId: real, reason: "Clearing out" }))).toMatchObject({ ok: false, error: expect.stringMatching(/Only a test run or a cancelled run/) });

    expect((await as(preparer, () => cancelPayRun({ runId: real, reason: "Pay lines changed" }))).ok).toBe(true);
    // Cancelled but not archived: a purge leaves it alone.
    await as(preparer, () => purgeArchivedPayRuns());
    expect(await runGone(real)).toBe(false);

    expect((await as(preparer, () => archivePayRun({ runId: real, reason: "Clearing out" }))).ok).toBe(true);
    expect((await as(preparer, () => restorePayRun({ runId: real }))).ok).toBe(true);
    expect((await as(preparer, () => archivePayRun({ runId: real, reason: "Clearing out again" }))).ok).toBe(true);

    const purged = await as(preparer, () => purgeArchivedPayRuns());
    expect(purged.ok && purged.data.runsDeleted).toBeGreaterThanOrEqual(1);
    expect(await runGone(real)).toBe(true);
    // Its history went with it, and the audit entry holds counts only.
    expect(await rows(sql`select 1 from payroll.pay_change_log where run_id = ${real}`)).toHaveLength(0);
    const [audit] = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from ops.audit_log where action = 'payroll.run.purge' order by id desc limit 1`);
    expect(Object.keys(audit.metadata).sort()).toEqual(["invoicesDeleted", "invoicesKept", "runsDeleted", "runsKept"]);
  });

  it("never deletes a real run, however it ended up, and the database refuses a plain delete", async () => {
    await setup();
    const real = await newRun("2041-02-01", "2041-02-15", false);
    await as(preparer, () => purgeArchivedPayRuns());
    expect(await runGone(real)).toBe(false);
    await expect(db.execute(sql`delete from payroll.pay_runs where id = ${real}`)).rejects.toThrow();
    // Archiving a real run directly in the database is refused too.
    await expect(db.execute(sql`update payroll.pay_runs set archived_at = now() where id = ${real}`)).rejects.toThrow();
  });
});

describe("archived test runs and test invoices are deleted for good", () => {
  it("keeps a run while an invoice on it is live, deletes the run with its invoices once they are archived, and never touches a real invoice", async () => {
    const { client, ana } = await setup();
    const testRun = await newRun("2041-03-01", "2041-03-20", true);
    await setHours(testRun, ana, "12");
    const inv = await as(hr, () => createInvoice({ runId: testRun, clientId: client }));
    if (!inv.ok) throw new Error(`invoice failed: ${inv.error}`);
    const again = await as(hr, () => createInvoice({ runId: testRun, clientId: client })); // a corrected version replaces the first
    if (!again.ok) throw new Error("second invoice failed");

    // A real run with a real invoice that is voided: kept for good.
    const realRun = await newRun("2041-04-01", "2041-04-15", false);
    await setHours(realRun, ana, "5");
    const realInv = await as(hr, () => createInvoice({ runId: realRun, clientId: client }));
    if (!realInv.ok) throw new Error("real invoice failed");
    expect((await as(hr, () => voidInvoice({ invoiceId: realInv.data.invoiceId, reason: "Wrong client" }))).ok).toBe(true);

    expect((await as(preparer, () => archivePayRun({ runId: testRun, reason: "Practice done" }))).ok).toBe(true);

    // The newest test invoice is still live, so the archived run stays.
    const first = await as(preparer, () => purgeArchivedPayRuns());
    expect(first.ok && first.data.runsKept).toBeGreaterThanOrEqual(1);
    expect(await runGone(testRun)).toBe(false);

    // Archive the live one; the first is already replaced. Now the run and both invoices can go.
    expect((await as(hr, () => archiveInvoice({ invoiceId: again.data.invoiceId, reason: "Practice done" }))).ok).toBe(true);
    const second = await as(preparer, () => purgeArchivedPayRuns());
    expect(second.ok && second.data.runsDeleted).toBeGreaterThanOrEqual(1);
    expect(await runGone(testRun)).toBe(true);
    expect(await invGone(inv.data.invoiceId)).toBe(true);
    expect(await invGone(again.data.invoiceId)).toBe(true);
    expect(await rows(sql`select 1 from payroll.pay_run_lines where run_id = ${testRun}`)).toHaveLength(0);
    expect(await rows(sql`select 1 from payroll.pay_run_items where run_id = ${testRun}`)).toHaveLength(0);

    // The real run and its void invoice are untouched.
    expect(await runGone(realRun)).toBe(false);
    expect(await invGone(realInv.data.invoiceId)).toBe(false);
  });

  it("deletes archived test invoices alone, keeps one that a kept invoice was replaced by, and leaves live and real invoices", async () => {
    const { client, ana } = await setup();
    const testRun = await newRun("2041-05-01", "2041-05-20", true);
    await setHours(testRun, ana, "8");
    const v1 = await as(hr, () => createInvoice({ runId: testRun, clientId: client }));
    const v2 = await as(hr, () => createInvoice({ runId: testRun, clientId: client })); // replaces v1
    if (!v1.ok || !v2.ok) throw new Error("invoice failed");

    // Archive only the newest: v1 is "replaced" (not archived) and points to v2, so v2 must stay.
    expect((await as(hr, () => archiveInvoice({ invoiceId: v2.data.invoiceId }))).ok).toBe(true);
    const kept = await as(hr, () => purgeArchivedInvoices());
    expect(kept.ok && kept.data.kept).toBeGreaterThanOrEqual(1);
    expect(await invGone(v2.data.invoiceId)).toBe(false);
    expect(await invGone(v1.data.invoiceId)).toBe(false);

    // A lone archived test invoice (its run is a test run that is not archived) is deleted.
    const solo = await newRun("2041-06-01", "2041-06-20", true);
    await setHours(solo, ana, "3");
    const s = await as(hr, () => createInvoice({ runId: solo, clientId: client }));
    if (!s.ok) throw new Error("invoice failed");
    expect((await as(hr, () => archiveInvoice({ invoiceId: s.data.invoiceId }))).ok).toBe(true);
    const done = await as(hr, () => purgeArchivedInvoices());
    expect(done.ok && done.data.deleted).toBeGreaterThanOrEqual(1);
    expect(await invGone(s.data.invoiceId)).toBe(true);
    expect(await runGone(solo)).toBe(false); // deleting invoices never deletes runs
    expect(await invGone(v1.data.invoiceId)).toBe(false); // a live (replaced) invoice stays
  });

  it("refuses a person without the right", async () => {
    expect(await as(nobody, () => purgeArchivedPayRuns())).toMatchObject({ ok: false });
    expect(await as(nobody, () => purgeArchivedInvoices())).toMatchObject({ ok: false });
    expect(await as(preparer, () => purgeArchivedInvoices())).toMatchObject({ ok: false });
    expect(await as(hr, () => purgeArchivedPayRuns())).toMatchObject({ ok: false });
  });
});
