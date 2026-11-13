import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: making invoices from a pay run's client hours. Invented people, clients and figures. Periods are cutoffs of 2031
// (January to October); the pay lines start in 2031 and are ended after the file by the helper.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { createPayLine, createPayRun, cancelPayRun, savePayItem, archivePayRun } = await import("@/modules/payroll/actions");
const { encryptItemValue } = await import("@/modules/payroll/service");
const { createInvoice, previewInvoiceRun, addBillRate, archiveInvoice, restoreInvoice, voidInvoice } = await import("@/modules/invoices/actions");
const { fieldCrypto } = await import("@/lib/crypto");
const { getInvoice, listInvoices, getBillRates, listInvoiceableRuns } = await import("@/modules/invoices/queries");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function account(role: RoleSlug, level: string | null = null) {
  const id = randomUUID();
  const email = `${uniq("invt")}@example.com`;
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${email}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  return { id, email, roles: [role], payrollAccess: level };
}
async function person(first = "Maria") {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status)
    values (${first}, ${uniq("Testcruz")}, ${`${uniq("emp")}@example.com`}, 'active') returning id`);
  return e.id;
}
async function newClient(name = "Testclinic ") {
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq(name)}) returning id`);
  return c.id;
}
const period = (month: number, half: 1 | 2 = 1) => ({
  periodStart: `2031-${String(month).padStart(2, "0")}-${half === 1 ? "01" : "16"}`,
  periodEnd: `2031-${String(month).padStart(2, "0")}-${half === 1 ? "15" : String(new Date(Date.UTC(2031, month, 0)).getUTCDate())}`,
});
const as = <T,>(who: unknown, fn: () => Promise<T>) => {
  current.user = who;
  return fn();
};

async function refused(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    expect(err.cause?.message ?? err.message).toMatch(/append-only/);
    return;
  }
  throw new Error("expected the database to refuse the change");
}

let preparer: Awaited<ReturnType<typeof account>>;
let hr: Awaited<ReturnType<typeof account>>;
let executive: Awaited<ReturnType<typeof account>>;

/** A pay line for a person (optionally with a client and alias) starting 2031-01-01. */
async function giveLine(employeeId: string, over: Record<string, unknown> = {}) {
  const r = await as(preparer, () => createPayLine({ employeeId, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2031-01-01", monthly: "22,000", ...over }));
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
}
async function newRun(p: { periodStart: string; periodEnd: string }) {
  const r = await as(preparer, () => createPayRun(p));
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}
const runLineOf = async (runId: string, employeeId: string) => (await rows<{ id: string }>(sql`select id from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId} limit 1`))[0].id;
async function setHours(runId: string, employeeId: string, value: string) {
  const runLineId = await runLineOf(runId, employeeId);
  const r = await as(preparer, () => savePayItem({ runId, employeeId, runLineId, type: "client_hours", value }));
  if (!r.ok) throw new Error(`hours failed: ${r.error}`);
}
const rate = (clientId: string, value: string, effectiveFrom = "2020-01-01") => as(hr, () => addBillRate({ clientId, effectiveFrom, rate: value }));
const invoiceRow = async (id: string) => (await rows<{ number: string; run_status: string; year: number; seq: number; revision: number; payload_enc: string }>(sql`select number, run_status, year, seq, revision, payload_enc from ops.invoices where id = ${id}`))[0];

beforeAll(async () => {
  preparer = await account("employee", "preparer");
  hr = await account("hr_admin");
  executive = await account("executive");
});

describe("billing rates", () => {
  it("the newest rate at or before the invoice day applies, later rows add history, and a rate is stored encrypted", async () => {
    const client = await newClient();
    expect((await rate(client, "20", "2020-01-01")).ok).toBe(true);
    expect((await rate(client, "25.50", "2020-06-01")).ok).toBe(true);
    expect((await rate(client, "99", "2099-01-01")).ok).toBe(true); // not started yet
    const data = await as(hr, () => getBillRates({ page: 1, pageSize: 100 }));
    const mine = data.overview.find((o) => o.clientId === client)!;
    expect(mine.currentCents).toBe(2550n);
    expect(mine.currentFrom).toBe("2020-06-01");
    expect(mine.upcoming).toEqual({ effectiveFrom: "2099-01-01", rateCents: 9900n });
    expect(data.history.filter((h) => h.clientName === mine.clientName)).toHaveLength(3);
    const stored = await rows<{ rate_enc: string }>(sql`select rate_enc from ops.client_bill_rates where client_id = ${client}`);
    for (const s of stored) expect(s.rate_enc).not.toMatch(/^\d+$/);
  });

  it("refuses a bad rate and an unknown client", async () => {
    const client = await newClient();
    expect((await rate(client, "0")).ok).toBe(false);
    expect((await rate(client, "abc")).ok).toBe(false);
    expect(await rate(randomUUID(), "10")).toEqual({ ok: false, error: "That client was not found." });
    expect(await rows(sql`select 1 from ops.client_bill_rates where client_id = ${client}`)).toHaveLength(0);
  });
});

describe("making an invoice", () => {
  it("bills the client's hours at the rate, one line per person, leaves out zero-hour and no-client people, and snapshots", async () => {
    const client = await newClient();
    const other = await newClient("Otherclinic ");
    const ana = await person("Ana");
    const ben = await person("Ben");
    const zero = await person("Zed");
    const lone = await person("Lone");
    const otherPerson = await person("Otto");
    await giveLine(ana, { clientId: client, alias: "Front desk" });
    await giveLine(ben, { clientId: client });
    await giveLine(zero, { clientId: client });
    await giveLine(lone); // no client
    await giveLine(otherPerson, { clientId: other });
    const runId = await newRun(period(1));
    await setHours(runId, ana, "86.5");
    await setHours(runId, ben, "33.33");
    await setHours(runId, lone, "40");
    await setHours(runId, otherPerson, "10");
    await rate(client, "12.35");

    const preview = await as(hr, () => previewInvoiceRun({ runId }));
    expect(preview.ok && preview.data.status).toBe("draft");
    if (!preview.ok) throw new Error("preview failed");
    const mine = preview.data.clients.find((c) => c.clientId === client)!;
    expect(mine).toMatchObject({ people: 2, hours: "119.83", rate: "12.35", existing: 0 });
    expect(preview.data.clients.find((c) => c.clientId === other)?.rate).toBeNull(); // no rate yet
    expect(preview.data.noClient).toHaveLength(1);
    expect(preview.data.noHours).toHaveLength(1); // Zed has a client but no hours: the dialog says so

    const made = await as(hr, () => createInvoice({ runId, clientId: client }));
    if (!made.ok) throw new Error(made.error);
    const row = await invoiceRow(made.data.invoiceId);
    expect(row.run_status).toBe("draft");
    expect(row.number).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(row.payload_enc).not.toContain("Testclinic");

    const view = (await as(hr, () => getInvoice(made.data.invoiceId)))!;
    expect(view.lines.map((l) => l.alias)).toEqual(["Front desk", null]);
    expect(view.lines.map((l) => l.hoursHundredths)).toEqual([8650n, 3333n]); // Ana, Ben (sorted by name)
    expect(view.lines.map((l) => l.amountCents)).toEqual([106828n, 41163n]);
    expect(view.totalCents).toBe(106828n + 41163n);
    expect(view.totalHoursHundredths).toBe(11983n);
    expect(view.rateCents).toBe(1235n);
    expect(view.unconfirmedLines).toBe(0);
    expect(view.lines.some((l) => l.name.includes("Lone") || l.name.includes("Zed") || l.name.includes("Otto"))).toBe(false);

    // The snapshot never changes: a new rate and new hours leave it alone (and the table refuses any rewrite).
    await rate(client, "99", "2021-01-01");
    await setHours(runId, ana, "1");
    const again = (await as(hr, () => getInvoice(made.data.invoiceId)))!;
    expect(again.totalCents).toBe(view.totalCents);
    expect(again.rateCents).toBe(1235n);
    await refused(db.execute(sql`update ops.invoices set run_status = 'paid' where id = ${made.data.invoiceId}`));

    // A second invoice for the same run and client is a revision and uses the rate and hours now in force.
    const rev = await as(executive, () => createInvoice({ runId, clientId: client }));
    if (!rev.ok) throw new Error(rev.error);
    const revRow = await invoiceRow(rev.data.invoiceId);
    expect(revRow.number).toBe(`${row.number}-R2`);
    expect(revRow.revision).toBe(2);
    const revView = (await as(hr, () => getInvoice(rev.data.invoiceId)))!;
    expect(revView.rateCents).toBe(9900n);
    const third = await as(hr, () => createInvoice({ runId, clientId: client }));
    if (!third.ok) throw new Error(third.error);
    expect((await invoiceRow(third.data.invoiceId)).number).toBe(`${row.number}-R3`);

    // Each version replaces the one before, so the default list shows only the newest; every version is still there under "show all".
    const list = await as(hr, () => listInvoices({ page: 1, pageSize: 100 }));
    expect(list.rows.map((r) => r.id)).toContain(third.data.invoiceId);
    expect(list.rows.map((r) => r.id)).not.toContain(made.data.invoiceId);
    expect(list.rows.map((r) => r.id)).not.toContain(rev.data.invoiceId);
    const all = await as(hr, () => listInvoices({ page: 1, pageSize: 100 }, { all: true }));
    expect(all.rows.map((r) => r.id)).toEqual(expect.arrayContaining([made.data.invoiceId, rev.data.invoiceId, third.data.invoiceId]));
    expect(all.rows.find((r) => r.id === made.data.invoiceId)?.runStatus).toBe("draft");
  });

  it("works for a person with no payroll level and reads no pay: the audit rows hold ids and counts only", async () => {
    const client = await newClient();
    const p = await person();
    await giveLine(p, { clientId: client });
    const runId = await newRun(period(2));
    await setHours(runId, p, "10");
    await rate(client, "31.37");
    expect(hr.payrollAccess).toBeNull();
    const made = await as(hr, () => createInvoice({ runId, clientId: client }));
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const audit = await rows<{ action: string; metadata: Record<string, unknown> }>(sql`select action, metadata from ops.audit_log where target_id = ${made.data.invoiceId}`);
    expect(audit.map((a) => a.action)).toContain("invoice.create");
    const text = JSON.stringify(audit);
    for (const secret of ["31.37", "3137", "Testclinic", "Testcruz", "10.00"]) expect(text).not.toContain(secret);
  });

  it("counts lines that use suggested (unconfirmed) hours", async () => {
    const client = await newClient();
    const a = await person();
    const b = await person();
    await giveLine(a, { clientId: client });
    await giveLine(b, { clientId: client });
    const runId = await newRun(period(3));
    await setHours(runId, a, "8");
    // A suggested figure, as an imported timesheet would leave it: an item row in the "suggested" state.
    const lineB = await runLineOf(runId, b);
    const itemId = randomUUID();
    await db.execute(sql`
      insert into payroll.pay_run_items (id, run_id, employee_id, run_line_id, type, state, value_enc, entered_by)
      values (${itemId}, ${runId}, ${b}, ${lineB}, 'client_hours', 'suggested', ${encryptItemValue(itemId, { value: 2500n, reason: null })}, ${preparer.id})`);
    await rate(client, "10");
    const preview = await as(hr, () => previewInvoiceRun({ runId }));
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.data.clients.find((c) => c.clientId === client)?.unconfirmedLines).toBe(1);
    const made = await as(hr, () => createInvoice({ runId, clientId: client }));
    if (!made.ok) throw new Error(made.error);
    const view = (await as(hr, () => getInvoice(made.data.invoiceId)))!;
    expect(view.unconfirmedLines).toBe(1);
    expect(view.totalHoursHundredths).toBe(800n + 2500n);
  });

  it("refuses a client with no rate, a client with no hours, a cancelled run and unknown ids, writing nothing", async () => {
    const client = await newClient();
    const noRate = await newClient();
    const p = await person();
    const q = await person();
    await giveLine(p, { clientId: client });
    await giveLine(q, { clientId: noRate });
    const runId = await newRun(period(4));
    await setHours(runId, p, "5");
    await setHours(runId, q, "5");
    await rate(client, "10");
    const before = (await rows<{ n: number }>(sql`select count(*)::int as n from ops.invoices`))[0].n;

    const r1 = await as(hr, () => createInvoice({ runId, clientId: noRate }));
    expect(r1.ok).toBe(false);
    expect(!r1.ok && r1.error).toMatch(/has no billing rate yet/);

    const idle = await newClient();
    await rate(idle, "10");
    const r2 = await as(hr, () => createInvoice({ runId, clientId: idle }));
    expect(!r2.ok && r2.error).toMatch(/no hours on this pay run/);

    expect(await as(hr, () => createInvoice({ runId: randomUUID(), clientId: client }))).toEqual({ ok: false, error: "That pay run was not found." });
    expect(await as(hr, () => createInvoice({ runId, clientId: randomUUID() }))).toEqual({ ok: false, error: "That client was not found." });

    const cancelled = await newRun(period(5));
    await setHours(cancelled, p, "5");
    expect((await as(preparer, () => cancelPayRun({ runId: cancelled, reason: "Test cancel" }))).ok).toBe(true);
    expect(await as(hr, () => createInvoice({ runId: cancelled, clientId: client }))).toEqual({ ok: false, error: "A cancelled pay run can't be invoiced." });

    expect((await rows<{ n: number }>(sql`select count(*)::int as n from ops.invoices`))[0].n).toBe(before);
  });

  it("gives two invoices made at the same time different numbers", async () => {
    const client = await newClient();
    const people = [await person(), await person()];
    for (const p of people) await giveLine(p, { clientId: client });
    const r1 = await newRun(period(6));
    const r2 = await newRun(period(7));
    for (const run of [r1, r2]) for (const p of people) await setHours(run, p, "4");
    await rate(client, "10");
    const [a, b] = await Promise.all([as(hr, () => createInvoice({ runId: r1, clientId: client })), as(hr, () => createInvoice({ runId: r2, clientId: client }))]);
    if (!a.ok || !b.ok) throw new Error("both should succeed");
    expect(a.data.number).not.toBe(b.data.number);

    // Two for the same run and client at once: one is the revision of the other.
    const [c, d] = await Promise.all([as(hr, () => createInvoice({ runId: r1, clientId: client })), as(hr, () => createInvoice({ runId: r1, clientId: client }))]);
    if (!c.ok || !d.ok) throw new Error("both should succeed");
    const numbers = [a.data.number, c.data.number, d.data.number];
    expect(new Set(numbers).size).toBe(3);
    expect([c.data.number, d.data.number].sort()).toEqual([`${a.data.number}-R2`, `${a.data.number}-R3`]);
  });
});

describe("who may do what, with the real database", () => {
  it("only HR Admin, Executive and Super Admin make invoices and rates; a payroll level opens nothing", async () => {
    const client = await newClient();
    const p = await person();
    await giveLine(p, { clientId: client });
    const runId = await newRun(period(8));
    await setHours(runId, p, "6");
    await rate(client, "10");

    for (const role of ROLE_SLUGS) {
      const who = await account(role);
      const allowed = ["super_admin", "hr_admin", "executive"].includes(role);
      const made = await as(who, () => createInvoice({ runId, clientId: client }));
      const added = await as(who, () => addBillRate({ clientId: client, effectiveFrom: "2022-01-01", rate: "11" }));
      const previewed = await as(who, () => previewInvoiceRun({ runId }));
      expect(made.ok, `createInvoice ${role}`).toBe(allowed);
      expect(added.ok, `addBillRate ${role}`).toBe(allowed);
      expect(previewed.ok, `previewInvoiceRun ${role}`).toBe(allowed);
      if (!allowed) {
        expect(!made.ok && made.error).toBe("You do not have access to do that.");
        await expect(as(who, () => listInvoices({ page: 1, pageSize: 10 }))).rejects.toThrow();
      }
    }
    for (const level of ["preparer", "approver", "viewer"]) {
      const who = await account("employee", level);
      expect((await as(who, () => createInvoice({ runId, clientId: client }))).ok).toBe(false);
      await expect(as(who, () => getBillRates({ page: 1, pageSize: 10 }))).rejects.toThrow();
    }
    // The Preparer used to build the run holds no invoice right either.
    expect((await as(preparer, () => createInvoice({ runId, clientId: client }))).ok).toBe(false);
  });
});

// Last in the file: its people have open-ended pay lines, which would otherwise show up on the runs of the tests after it.
describe("test runs", () => {
  it("an invoice from a test run is numbered TEST- in its own series, stamped as a test, and refused once the run is archived", async () => {
    const client = await newClient();
    const ana = await person("Ana");
    await giveLine(ana, { clientId: client });
    await rate(client, "10.00");

    // A real run and a test run for the SAME period: a test run may repeat a cycle.
    const real = await newRun(period(9));
    await setHours(real, ana, "10");
    const made = await as(preparer, () => createPayRun({ ...period(9), test: true }));
    if (!made.ok) throw new Error(`test run failed: ${made.error}`);
    const testRun = made.data.runId;
    await setHours(testRun, ana, "20");

    const preview = await as(hr, () => previewInvoiceRun({ runId: testRun }));
    expect(preview.ok && preview.data.isTest).toBe(true);
    expect(await as(hr, () => previewInvoiceRun({ runId: real }))).toMatchObject({ ok: true, data: { isTest: false } });

    const realInvoice = await as(hr, () => createInvoice({ runId: real, clientId: client }));
    const testInvoice = await as(hr, () => createInvoice({ runId: testRun, clientId: client }));
    if (!realInvoice.ok || !testInvoice.ok) throw new Error("invoice failed");
    expect(realInvoice.data.number).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(testInvoice.data.number).toMatch(/^TEST-\d{4}-\d{4}$/);

    // The test invoice is flagged, the real one is not, and a second test invoice for the same run and client is a revision of the same number.
    expect((await as(hr, () => getInvoice(testInvoice.data.invoiceId)))?.isTest).toBe(true);
    expect((await as(hr, () => getInvoice(realInvoice.data.invoiceId)))?.isTest).toBe(false);
    const again = await as(hr, () => createInvoice({ runId: testRun, clientId: client }));
    expect(again.ok && again.data.number).toBe(`${testInvoice.data.number}-R2`);

    // Practice invoices never use up a real number: the next real invoice follows the previous real one directly.
    const next = await person("Ben");
    await giveLine(next, { clientId: client });
    const realTwo = await newRun(period(10));
    await setHours(realTwo, next, "5");
    const nextInvoice = await as(hr, () => createInvoice({ runId: realTwo, clientId: client }));
    if (!nextInvoice.ok) throw new Error("invoice failed");
    const seqOf = (n: string) => Number(n.split("-")[2]);
    expect(seqOf(nextInvoice.data.number)).toBe(seqOf(realInvoice.data.number) + 1);

    // The run list for the invoice window shows the test run, then hides it (and refuses it) once archived.
    expect((await as(hr, () => listInvoiceableRuns())).some((r) => r.id === testRun && r.isTest)).toBe(true);
    const archived = await as(preparer, () => archivePayRun({ runId: testRun, reason: "Practice cycle done" }));
    expect(archived.ok).toBe(true);
    expect((await as(hr, () => listInvoiceableRuns())).some((r) => r.id === testRun)).toBe(false);
    const refused = await as(hr, () => createInvoice({ runId: testRun, clientId: client }));
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/archived/) });
  });
});

// ---- a rate for each person, and what can be done with an invoice afterwards (2031 second halves, months 1 to 11) ----
// Last in the file for the same reason as the test run block above: these people have open-ended pay lines.

describe("a billing rate for a person", () => {
  const ratesOn = (clientId: string, employeeId: string | null) => rows<{ employee_id: string | null }>(sql`select employee_id from ops.client_bill_rates where client_id = ${clientId} and employee_id ${employeeId ? sql`= ${employeeId}` : sql`is null`}`);

  it("bills a person at their own rate and everyone else at the standard rate, with each line showing its rate", async () => {
    const client = await newClient();
    const ana = await person("Ana");
    const ben = await person("Ben");
    for (const e of [ana, ben]) await giveLine(e, { clientId: client });
    const p = period(1, 2);
    const runId = await newRun(p);
    await setHours(runId, ana, "10");
    await setHours(runId, ben, "10");
    await rate(client, "10.00"); // the standard rate
    expect(await as(hr, () => addBillRate({ clientId: client, employeeId: ana, effectiveFrom: "2020-01-01", rate: "15.00" }))).toMatchObject({ ok: true });
    // A rate of Ben's own that starts in the far future changes nothing yet.
    expect(await as(hr, () => addBillRate({ clientId: client, employeeId: ben, effectiveFrom: "2099-01-01", rate: "99.00" }))).toMatchObject({ ok: true });

    const preview = await as(hr, () => previewInvoiceRun({ runId }));
    if (!preview.ok) throw new Error("preview failed");
    expect(preview.data.clients.find((c) => c.clientId === client)).toMatchObject({ people: 2, rate: "10.00", ownRates: 1, missingRates: [], total: "250.00" });

    const made = await as(hr, () => createInvoice({ runId, clientId: client }));
    if (!made.ok) throw new Error(made.error);
    const view = (await as(hr, () => getInvoice(made.data.invoiceId)))!;
    const byName = (n: string) => view.lines.find((l) => l.name.startsWith(n))!;
    expect([byName("Ana").rateCents, byName("Ana").amountCents]).toEqual([1500n, 15000n]);
    expect([byName("Ben").rateCents, byName("Ben").amountCents]).toEqual([1000n, 10000n]);
    expect(view.totalCents).toBe(25000n);
    expect(view.rateCents).toBe(1000n); // the header holds the standard rate
  });

  it("refuses an invoice, naming them, when a person has neither a rate of their own nor a standard rate", async () => {
    const client = await newClient();
    const ana = await person("Ana");
    const ben = await person("Ben");
    for (const e of [ana, ben]) await giveLine(e, { clientId: client });
    const runId = await newRun(period(2, 2));
    await setHours(runId, ana, "10");
    await setHours(runId, ben, "10");
    expect(await as(hr, () => addBillRate({ clientId: client, employeeId: ana, effectiveFrom: "2020-01-01", rate: "15.00" }))).toMatchObject({ ok: true });

    const preview = await as(hr, () => previewInvoiceRun({ runId }));
    if (!preview.ok) throw new Error("preview failed");
    const c = preview.data.clients.find((x) => x.clientId === client)!;
    expect(c.missingRates).toHaveLength(1);
    expect(c.missingRates[0]).toContain("Ben");
    expect(c.total).toBeNull();
    const refused = await as(hr, () => createInvoice({ runId, clientId: client }));
    expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/No billing rate applies to .*Ben/) });
    // A standard rate fixes it, and Ana keeps her own.
    await rate(client, "10.00");
    expect(await as(hr, () => createInvoice({ runId, clientId: client }))).toMatchObject({ ok: true });
  });

  it("checks the person, keeps the history, and audits ids only", async () => {
    const client = await newClient();
    const ana = await person("Ana");
    expect(await as(hr, () => addBillRate({ clientId: client, employeeId: randomUUID(), effectiveFrom: "2031-01-01", rate: "15.00" }))).toMatchObject({ ok: false, error: "That person was not found." });
    expect(await as(hr, () => addBillRate({ clientId: client, employeeId: "nope", effectiveFrom: "2031-01-01", rate: "15.00" }))).toMatchObject({ ok: false });
    const added = await as(hr, () => addBillRate({ clientId: client, employeeId: ana, effectiveFrom: "2020-01-01", rate: "15.55" }));
    expect(added.ok).toBe(true);
    expect(await ratesOn(client, ana)).toHaveLength(1);
    expect(await ratesOn(client, null)).toHaveLength(0);
    const [audit] = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where action = 'invoice.rate.add' and metadata::text like ${`%${ana}%`}`);
    expect(JSON.stringify(audit.metadata)).not.toContain("15.55");
    // The rates page shows it as a rate of a person, and offers the person to add rates for (they have a pay line for this client).
    await giveLine(ana, { clientId: client });
    const page = await as(hr, () => getBillRates({ page: 1, pageSize: 500 }));
    expect(page.personRates.find((r) => r.clientId === client && r.employeeId === ana)).toMatchObject({ currentCents: 1555n });
    expect(page.peopleByClient[client].map((x) => x.id)).toContain(ana);
    expect(page.history.find((h) => h.personName?.includes("Ana"))).toBeTruthy();
    expect(page.overview.find((o) => o.clientId === client)?.currentCents).toBeNull(); // no standard rate: the person's rate is not the client's
  });

  it("reads an invoice made before each line had a rate as the one rate in its header", async () => {
    const client = await newClient();
    const ana = await person("Ana");
    await giveLine(ana, { clientId: client });
    const runId = await newRun(period(3, 2));
    const id = randomUUID();
    const legacy = {
      clientName: "Legacy Clinic",
      periodStart: period(3, 2).periodStart,
      periodEnd: period(3, 2).periodEnd,
      rateCents: "1235",
      lines: [{ name: "Ana Testcruz", alias: null, hoursHundredths: "1000", amountCents: "12350" }],
      totalHoursHundredths: "1000",
      totalCents: "12350",
      unconfirmedLines: 0,
    };
    await db.execute(sql`insert into ops.invoices (id, number, year, seq, revision, run_id, client_id, run_status, issued_on, payload_enc, created_by)
      values (${id}, ${uniq("INV-LEGACY-")}, 2031, 9000, 1, ${runId}, ${client}, 'draft', '2031-03-20', ${fieldCrypto().encrypt(JSON.stringify(legacy), `invoice:${id}`)}, ${hr.id})`);
    const view = (await as(hr, () => getInvoice(id)))!;
    expect(view.lines[0].rateCents).toBe(1235n);
    expect(view.state).toBe("active");
    expect(view.isTest).toBe(false);
  });
});

describe("what happens to an invoice after it is made", () => {
  async function invoiceFor(month: number, tests = false) {
    const client = await newClient();
    const ana = await person("Ana");
    await giveLine(ana, { clientId: client });
    await rate(client, "10.00");
    const p = period(month, 2);
    let runId: string;
    if (tests) {
      const made = await as(preparer, () => createPayRun({ ...p, test: true }));
      if (!made.ok) throw new Error(made.error);
      runId = made.data.runId;
    } else runId = await newRun(p);
    await setHours(runId, ana, "10");
    const r = await as(hr, () => createInvoice({ runId, clientId: client }));
    if (!r.ok) throw new Error(r.error);
    return { runId, client, ...r.data };
  }
  const stateOf = async (id: string) => (await as(hr, () => getInvoice(id)))!;

  it("a corrected version replaces the earlier one: its number is -R2, the old one is marked replaced, and the default list shows only the live one", async () => {
    const first = await invoiceFor(4);
    const second = await as(hr, () => createInvoice({ runId: first.runId, clientId: first.client }));
    if (!second.ok) throw new Error(second.error);
    expect(second.data.number).toBe(`${first.number}-R2`);
    const old = await stateOf(first.invoiceId);
    expect(old).toMatchObject({ state: "superseded", replacedByNumber: second.data.number });
    expect((await stateOf(second.data.invoiceId)).state).toBe("active");

    const third = await as(hr, () => createInvoice({ runId: first.runId, clientId: first.client }));
    if (!third.ok) throw new Error(third.error);
    expect((await stateOf(second.data.invoiceId)).state).toBe("superseded"); // each new version replaces the one before
    expect((await stateOf(first.invoiceId)).replacedByNumber).toBe(second.data.number); // and the first still names its own replacement

    const live = await as(hr, () => listInvoices({ page: 1, pageSize: 500 }));
    expect(live.rows.map((r) => r.id)).toContain(third.data.invoiceId);
    expect(live.rows.map((r) => r.id)).not.toContain(first.invoiceId);
    expect(live.hiddenCount).toBeGreaterThanOrEqual(2);
    const everything = await as(hr, () => listInvoices({ page: 1, pageSize: 500 }, { all: true }));
    expect(everything.rows.find((r) => r.id === first.invoiceId)).toMatchObject({ state: "superseded" });
    expect(everything.showingAll).toBe(true);
    const [audit] = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where target_id = ${second.data.invoiceId} and action = 'invoice.create'`);
    expect(JSON.stringify(audit.metadata)).toContain(first.invoiceId); // which one it replaced, as an id
  });

  it("a real invoice is voided with a reason, never archived: kept, stamped, hidden from the default list, number never reused", async () => {
    const real = await invoiceFor(5);
    expect(await as(hr, () => archiveInvoice({ invoiceId: real.invoiceId }))).toMatchObject({ ok: false, error: expect.stringMatching(/Only a test invoice can be archived/) });
    expect(await as(hr, () => voidInvoice({ invoiceId: real.invoiceId, reason: "   " }))).toMatchObject({ ok: false });
    expect(await as(hr, () => voidInvoice({ invoiceId: real.invoiceId, reason: "Wrong client" }))).toMatchObject({ ok: true });
    const voided = await stateOf(real.invoiceId);
    expect(voided).toMatchObject({ state: "voided", stateReason: "Wrong client" });
    expect(await as(hr, () => voidInvoice({ invoiceId: real.invoiceId, reason: "Again" }))).toMatchObject({ ok: false, error: "This invoice is already void." });
    expect((await as(hr, () => listInvoices({ page: 1, pageSize: 500 }))).rows.some((r) => r.id === real.invoiceId)).toBe(false);
    expect((await as(hr, () => listInvoices({ page: 1, pageSize: 500 }, { all: true }))).rows.find((r) => r.id === real.invoiceId)).toMatchObject({ state: "voided" });
    // A new version for the same run and client takes the next -R number; the voided one stays voided (not "replaced").
    const next = await as(hr, () => createInvoice({ runId: real.runId, clientId: real.client }));
    expect(next.ok && next.data.number).toBe(`${real.number}-R2`);
    expect((await stateOf(real.invoiceId)).state).toBe("voided");
    // The reason is encrypted at rest and kept out of the audit row.
    const [event] = await rows<{ reason_enc: string }>(sql`select reason_enc from ops.invoice_events where invoice_id = ${real.invoiceId} and kind = 'voided'`);
    expect(event.reason_enc).not.toContain("Wrong client");
    const audits = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where target_id = ${real.invoiceId} and action = 'invoice.void'`);
    expect(JSON.stringify(audits)).not.toContain("Wrong client");
  });

  it("a test invoice is archived and restored, never voided, and a replaced or void invoice can't be archived", async () => {
    const test = await invoiceFor(6, true);
    expect(await as(hr, () => voidInvoice({ invoiceId: test.invoiceId, reason: "Practice" }))).toMatchObject({ ok: false, error: "A test invoice is archived, not voided." });
    expect(await as(hr, () => restoreInvoice({ invoiceId: test.invoiceId }))).toMatchObject({ ok: false, error: "This invoice is not archived." });
    expect(await as(hr, () => archiveInvoice({ invoiceId: test.invoiceId, reason: "Practice cycle done" }))).toMatchObject({ ok: true });
    expect(await stateOf(test.invoiceId)).toMatchObject({ state: "archived", stateReason: "Practice cycle done", isTest: true });
    expect(await as(hr, () => archiveInvoice({ invoiceId: test.invoiceId }))).toMatchObject({ ok: false, error: "This invoice is already archived." });
    expect((await as(hr, () => listInvoices({ page: 1, pageSize: 500 }))).rows.some((r) => r.id === test.invoiceId)).toBe(false);
    expect(await as(hr, () => restoreInvoice({ invoiceId: test.invoiceId }))).toMatchObject({ ok: true });
    expect((await stateOf(test.invoiceId)).state).toBe("active");
    expect((await as(hr, () => listInvoices({ page: 1, pageSize: 500 }))).rows.some((r) => r.id === test.invoiceId)).toBe(true);
    // A replaced test invoice can't be archived (it is already out of the way).
    const second = await as(hr, () => createInvoice({ runId: test.runId, clientId: test.client }));
    expect(second.ok).toBe(true);
    expect(await as(hr, () => archiveInvoice({ invoiceId: test.invoiceId }))).toMatchObject({ ok: false, error: expect.stringMatching(/no longer live/) });
    // Unknown ids and bad input are refused.
    expect(await as(hr, () => archiveInvoice({ invoiceId: randomUUID() }))).toMatchObject({ ok: false, error: "That invoice was not found." });
    expect(await as(hr, () => archiveInvoice({ invoiceId: "nope" }))).toMatchObject({ ok: false });
  });

  it("is for HR Admin, Executive and Super Admin only, and the events can never be changed or removed", async () => {
    const test = await invoiceFor(7, true);
    for (const role of ROLE_SLUGS) {
      if (["super_admin", "hr_admin", "executive"].includes(role)) continue;
      const who = await account(role);
      expect(await as(who, () => archiveInvoice({ invoiceId: test.invoiceId }))).toEqual({ ok: false, error: "You do not have access to do that." });
      expect(await as(who, () => voidInvoice({ invoiceId: test.invoiceId, reason: "x" }))).toEqual({ ok: false, error: "You do not have access to do that." });
    }
    // A payroll level alone opens nothing here either.
    expect(await as(preparer, () => archiveInvoice({ invoiceId: test.invoiceId }))).toEqual({ ok: false, error: "You do not have access to do that." });
    expect(await as(executive, () => archiveInvoice({ invoiceId: test.invoiceId }))).toMatchObject({ ok: true });
    await refused(db.execute(sql`update ops.invoice_events set kind = 'restored' where invoice_id = ${test.invoiceId}`));
    await refused(db.execute(sql`delete from ops.invoice_events where invoice_id = ${test.invoiceId}`));
    await refused(db.execute(sql`truncate ops.invoice_events`));
  });
});
