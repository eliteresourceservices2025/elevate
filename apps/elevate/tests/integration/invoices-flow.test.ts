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
const { createPayLine, createPayRun, cancelPayRun, savePayItem } = await import("@/modules/payroll/actions");
const { encryptItemValue } = await import("@/modules/payroll/service");
const { createInvoice, previewInvoiceRun, addBillRate } = await import("@/modules/invoices/actions");
const { getInvoice, listInvoices, getBillRates } = await import("@/modules/invoices/queries");

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

    const list = await as(hr, () => listInvoices({ page: 1, pageSize: 100 }));
    expect(list.rows.map((r) => r.id)).toEqual(expect.arrayContaining([made.data.invoiceId, rev.data.invoiceId]));
    expect(list.rows.find((r) => r.id === made.data.invoiceId)?.runStatus).toBe("draft");
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
