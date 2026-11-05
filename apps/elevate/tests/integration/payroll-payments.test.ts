import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: the Remitly list and recording payments. Invented names and figures only. Every period is a half month of 2028;
// each test uses its own period and its pay lines start and end inside it.

const current = vi.hoisted(() => ({ user: null as unknown, allow: true }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => current.allow) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { createPayLine, savePaySettings, createPayRun, cancelPayRun, setRunUsdRate, submitRun, approveRun, exportRemitlyList, markPaid } = await import("@/modules/payroll/actions");
const { getWorksheet, getPayments } = await import("@/modules/payroll/queries");
const { decryptRunLine, payrollToday } = await import("@/modules/payroll/service");
const { fieldCrypto } = await import("@/lib/crypto");

type Row = Record<string, unknown>;
type Level = "preparer" | "approver" | "viewer" | null;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;
const NO_ACCESS = "You do not have access to do that.";
const BAD = "Check the request and try again.";

async function account(level: Level = "preparer") {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("pay")}@example.com`}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  return { id, email: "x@example.com", roles: ["employee"], payrollAccess: level };
}
async function person(userId: string | null = null, last = uniq("Testreyes")) {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values ('Liza', ${last}, ${`${uniq("emp")}@example.com`}, 'active', ${userId}) returning id`);
  return e.id;
}
/** Half month `n` of 2028. */
function slot(n: number) {
  const month = Math.floor(n / 2) + 1;
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(2028, month, 0)).getUTCDate();
  return n % 2 === 0 ? { periodStart: `2028-${mm}-01`, periodEnd: `2028-${mm}-15` } : { periodStart: `2028-${mm}-16`, periodEnd: `2028-${mm}-${last}` };
}
const as = (who: unknown) => {
  current.user = who;
};
async function giveLine(employeeId: string, p: { periodStart: string; periodEnd: string }, over: Record<string, unknown> = {}, author: unknown = preparer) {
  as(author);
  const r = await createPayLine({
    employeeId, hoursPerDay: 8, fte: "1", paymentMethod: "remitly", effectiveFrom: p.periodStart, endsOn: p.periodEnd,
    monthly: "22,000", pesoAllowance: "1,000", dollarAllowance: "0", ...over,
  });
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
}
async function newRun(p: { periodStart: string; periodEnd: string }, rate: string | null = "58.50") {
  as(preparer);
  const r = await createPayRun(p);
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  if (rate) await setRunUsdRate({ runId: r.data.runId, rate });
  return r.data.runId;
}
async function approvedRun(p: { periodStart: string; periodEnd: string }, rate: string | null = "58.50") {
  const runId = await newRun(p, rate);
  as(preparer);
  const s = await submitRun({ runId });
  if (!s.ok) throw new Error(`submit failed: ${s.error}`);
  as(approver);
  const hash = (await getWorksheet(runId))!.expectedHash!;
  const a = await approveRun({ runId, expectedHash: hash });
  if (!a.ok) throw new Error(`approve failed: ${a.error}`);
  return runId;
}
const status = async (runId: string) => (await rows<{ status: string }>(sql`select status from payroll.pay_runs where id = ${runId}`))[0].status;
const paymentRows = (runId: string) => rows<Row>(sql`select * from payroll.pay_payments where run_id = ${runId} order by created_at`);
const footprint = async (runId: string) =>
  (
    await rows<Row>(sql`
      select (select count(*)::int from payroll.pay_payments where run_id = ${runId}) as payments,
             (select count(*)::int from payroll.pay_change_log where run_id = ${runId} and action in ('payment_marked','list_exported','run_paid')) as changes,
             (select count(*)::int from ops.audit_log where target_id = ${runId} and action like 'payroll.payment.%' or target_id = ${runId} and action = 'payroll.remitly.export') as audits,
             (select status from payroll.pay_runs where id = ${runId}) as status`)
  )[0];
const today = () => payrollToday();
const REF = "RMT-TEST-0001";

let preparer: Awaited<ReturnType<typeof account>>;
let other: Awaited<ReturnType<typeof account>>;
let approver: Awaited<ReturnType<typeof account>>;
let viewer: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  preparer = await account("preparer");
  other = await account("preparer");
  approver = await account("approver");
  viewer = await account("viewer");
  as(preparer);
  const rates = { cutoffDivisor: 11, changeWarnPercent: 10, extraRegular: "125", extraHoliday: "200", extraRestDay: "130", extraRestDayOver8: "169", holiday: "100", reason: "Test rates" };
  expect(await savePaySettings({ ...rates, effectiveFrom: "2028-01-01" })).toMatchObject({ ok: true });
});

describe("the Remitly list", () => {
  it("is refused before approval, for a cancelled run, and with no dollar rate", async () => {
    const p = slot(0);
    const emp = await person();
    await giveLine(emp, p);
    const draft = await newRun(p);
    as(preparer);
    expect(await exportRemitlyList({ runId: draft })).toMatchObject({ ok: false });
    expect((await footprint(draft)).audits).toBe(0);
    expect(await submitRun({ runId: draft })).toMatchObject({ ok: true });
    expect(await exportRemitlyList({ runId: draft })).toMatchObject({ ok: false }); // in review
    expect((await footprint(draft)).changes).toBe(0);

    const q = slot(1);
    await giveLine(await person(), q);
    const cancelled = await newRun(q);
    as(preparer);
    expect(await cancelPayRun({ runId: cancelled, reason: "Pay lines changed" })).toMatchObject({ ok: true });
    expect(await exportRemitlyList({ runId: cancelled })).toMatchObject({ ok: false });

    const r = slot(2);
    await giveLine(await person(), r);
    const noRate = await approvedRun(r, null);
    as(preparer);
    const result = await exportRemitlyList({ runId: noRate });
    expect(!result.ok && result.error).toMatch(/dollar rate/i);
  });

  it("gives one row per person, no bank column, neutralizes a formula alias, and is audited without amounts", async () => {
    const p = slot(3);
    const emp = await person(null, "Lopezexport");
    await giveLine(emp, p, { alias: "=HYPERLINK(1)" });
    await giveLine(emp, p, { alias: "Billing", monthly: "10,000" });
    const solo = await person(null, "Zamoraexport");
    await giveLine(solo, p);
    const runId = await approvedRun(p);

    as(preparer);
    const r = await exportRemitlyList({ runId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows).toBe(2);
    expect(r.data.fileName).toMatch(/^remitly-2028-02-16-to-2028-02-29\.csv$/);
    const lines = r.data.csv.trim().split("\r\n");
    expect(lines[0]).toBe("Person,Alias,Pesos,Dollars");
    expect(lines).toHaveLength(3);
    expect(r.data.csv).not.toMatch(/bank|account/i);
    expect(r.data.csv).toContain("'=HYPERLINK(1); Billing");

    // The pesos are the sum of the person's decrypted line nets.
    const nets = await rows<{ id: string; payload_enc: string }>(sql`select id, payload_enc from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${emp}`);
    const total = nets.reduce((s, n) => s + decryptRunLine(n.id, n.payload_enc).result.net, 0n);
    const pesos = `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`;
    const cents = (total * 10_000n * 2n + 585_000n) / (585_000n * 2n);
    const dollars = `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
    expect(lines.find((l) => l.includes("Lopezexport"))).toContain(`${pesos},${dollars}`);

    const [audit] = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where target_id = ${runId} and action = 'payroll.remitly.export'`);
    expect(JSON.stringify(audit.metadata)).toMatch(/"rows":\s*2/);
    expect(JSON.stringify(audit.metadata)).not.toContain(pesos);
    expect(JSON.stringify(audit.metadata)).not.toContain(dollars);
    expect(await rows(sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'list_exported'`)).toHaveLength(1);
    // A paid run can be downloaded again.
  });

  it("is rate limited, and leaves nothing behind when refused", async () => {
    const p = slot(4);
    await giveLine(await person(), p);
    const runId = await approvedRun(p);
    as(preparer);
    current.allow = false;
    try {
      const before = await footprint(runId);
      const r = await exportRemitlyList({ runId });
      expect(r).toMatchObject({ ok: false });
      expect(await footprint(runId)).toEqual(before);
    } finally {
      current.allow = true;
    }
  });

  it("is for Preparers only, and checks its input", async () => {
    const p = slot(5);
    await giveLine(await person(), p);
    const runId = await approvedRun(p);
    for (const who of [approver, viewer, await account(null)]) {
      as(who);
      expect(await exportRemitlyList({ runId })).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(preparer);
    expect(await exportRemitlyList({ runId: "nope" })).toEqual({ ok: false, error: BAD });
    expect(await exportRemitlyList({ runId: randomUUID() })).toMatchObject({ ok: false });
  });
});

describe("markPaid", () => {
  it("is refused before approval and for a person not on the run, writing nothing", async () => {
    const p = slot(6);
    const emp = await person();
    await giveLine(emp, p);
    const draft = await newRun(p);
    as(preparer);
    const r = await markPaid({ runId: draft, employeeId: emp, reference: REF, paidOn: today() });
    expect(r).toMatchObject({ ok: false });
    expect(await submitRun({ runId: draft })).toMatchObject({ ok: true });
    expect(await markPaid({ runId: draft, employeeId: emp, reference: REF, paidOn: today() })).toMatchObject({ ok: false });
    expect(await paymentRows(draft)).toHaveLength(0);

    const q = slot(7);
    const onRun = await person();
    await giveLine(onRun, q);
    const runId = await approvedRun(q);
    const stranger = await person();
    as(preparer);
    const x = await markPaid({ runId, employeeId: stranger, reference: REF, paidOn: today() });
    expect(!x.ok && x.error).toMatch(/not on this run/i);
    expect(await paymentRows(runId)).toHaveLength(0);
    expect(await status(runId)).toBe("approved");
  });

  it("is for Preparers only and checks its input", async () => {
    const p = slot(8);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await approvedRun(p);
    for (const who of [approver, viewer, await account(null)]) {
      as(who);
      expect(await markPaid({ runId, employeeId: emp, reference: REF, paidOn: today() })).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(preparer);
    for (const bad of [
      { reference: "   " },
      { reference: "x".repeat(101) },
      { paidOn: "2028-02-31" },
      { paidOn: "" },
      { employeeId: "nope" },
      { runId: "nope" },
    ]) {
      expect(await markPaid({ runId, employeeId: emp, reference: REF, paidOn: today(), ...bad })).toEqual({ ok: false, error: BAD });
    }
    const future = await markPaid({ runId, employeeId: emp, reference: REF, paidOn: "2999-01-01" });
    expect(future).toMatchObject({ ok: false });
    expect(await paymentRows(runId)).toHaveLength(0);
  });

  it("a Preparer can't mark their own payment; another Preparer can", async () => {
    const p = slot(9);
    const owner = await account("preparer");
    const ownEmp = await person(owner.id);
    await giveLine(ownEmp, p);
    const runId = await approvedRun(p);
    as(owner);
    expect(await markPaid({ runId, employeeId: ownEmp, reference: REF, paidOn: today() })).toEqual({ ok: false, error: "You can't change your own pay." });
    expect(await paymentRows(runId)).toHaveLength(0);
    as(other);
    expect(await markPaid({ runId, employeeId: ownEmp, reference: REF, paidOn: today() })).toMatchObject({ ok: true });
    expect(await paymentRows(runId)).toHaveLength(1);
  });

  it("encrypts the reference and keeps it out of the audit entry, the change log's clear columns and notices", async () => {
    const p = slot(10);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await approvedRun(p);
    as(preparer);
    const ref = "RMT-SECRET-77";
    expect(await markPaid({ runId, employeeId: emp, reference: ref, paidOn: today() })).toMatchObject({ ok: true });
    const [pay] = await rows<{ id: string; reference_enc: string; marked_by: string }>(sql`select id, reference_enc, marked_by from payroll.pay_payments where run_id = ${runId}`);
    expect(pay.reference_enc).not.toContain(ref);
    expect(fieldCrypto().decrypt(pay.reference_enc, `pay_payment:${pay.id}`)).toBe(ref);
    expect(pay.marked_by).toBe(preparer.id);
    const audit = await rows(sql`select metadata::text as m, action from ops.audit_log where target_id = ${runId} and action like 'payroll.payment.%'`);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(ref);
    expect(await rows(sql`select 1 from ops.notifications where body like ${`%${ref}%`}`)).toHaveLength(0);
    expect(await rows(sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'payment_marked'`)).toHaveLength(1);
  });

  it("makes the run paid only when every person has a payment, and a correction adds a row whose newest shows", async () => {
    const p = slot(11);
    const a = await person(null, "Aaapay");
    const b = await person(null, "Bbbpay");
    await giveLine(a, p);
    await giveLine(b, p);
    await giveLine(b, p, { alias: "Second", monthly: "5,000" }); // two lines, one transfer
    const runId = await approvedRun(p);
    as(preparer);
    expect(await markPaid({ runId, employeeId: a, reference: "RMT-A-1", paidOn: today() })).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("approved");

    // Correct a's reference before everyone is paid.
    expect(await markPaid({ runId, employeeId: a, reference: "RMT-A-2", paidOn: today() })).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("approved");
    expect(await paymentRows(runId)).toHaveLength(2);
    const view = (await getPayments(runId))!;
    expect(view.people.find((x) => x.employeeId === a)!.payment!.reference).toBe("RMT-A-2");
    expect(view.people.find((x) => x.employeeId === b)!.payment).toBeNull();

    expect(await markPaid({ runId, employeeId: b, reference: "RMT-B-1", paidOn: today() })).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("paid");
    expect(await rows(sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'run_paid'`)).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.audit_log where target_id = ${runId} and action = 'payroll.run.paid'`)).toHaveLength(1);

    // After paid, a correction is still recorded as a new row; the run stays paid and nothing else changes.
    expect(await markPaid({ runId, employeeId: b, reference: "RMT-B-2", paidOn: today() })).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("paid");
    expect(await paymentRows(runId)).toHaveLength(4);
    expect(await rows(sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'run_paid'`)).toHaveLength(1);
    const after = (await getPayments(runId))!;
    expect(after.people.find((x) => x.employeeId === b)!.payment!.reference).toBe("RMT-B-2");
    expect(after.status).toBe("paid");
    // The list can still be downloaded.
    expect(await exportRemitlyList({ runId })).toMatchObject({ ok: true });
  });

  it("two last payments at once make the run paid exactly once", async () => {
    const p = slot(12);
    const a = await person();
    const b = await person();
    await giveLine(a, p);
    await giveLine(b, p);
    const runId = await approvedRun(p);
    as(preparer);
    const results = await Promise.all([
      markPaid({ runId, employeeId: a, reference: "RMT-1", paidOn: today() }),
      markPaid({ runId, employeeId: b, reference: "RMT-2", paidOn: today() }),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await status(runId)).toBe("paid");
    expect(await rows(sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'run_paid'`)).toHaveLength(1);
  });

  it("works for people with no linked account (nothing to notify)", async () => {
    const p = slot(13);
    const emp = await person(null);
    await giveLine(emp, p);
    const runId = await approvedRun(p);
    as(preparer);
    const before = (await rows<{ n: number }>(sql`select count(*)::int as n from ops.notifications`))[0].n;
    expect(await markPaid({ runId, employeeId: emp, reference: REF, paidOn: today() })).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("paid");
    const after = (await rows<{ n: number }>(sql`select count(*)::int as n from ops.notifications`))[0].n;
    expect(after).toBe(before);
  });

  it("the database refuses any status jump to paid except from approved", async () => {
    const p = slot(14);
    await giveLine(await person(), p);
    const runId = await newRun(p);
    await expect(db.execute(sql`update payroll.pay_runs set status = 'paid' where id = ${runId}`)).rejects.toThrow();
    expect(await status(runId)).toBe("draft");
  });
});

describe("the payments view", () => {
  it("is for anyone who can open payroll, and marks the viewer's own line", async () => {
    const p = slot(15);
    const me = await account("preparer");
    const ownEmp = await person(me.id);
    await giveLine(ownEmp, p);
    const runId = await approvedRun(p);
    as(me);
    const mine = (await getPayments(runId))!;
    expect(mine.people.find((x) => x.employeeId === ownEmp)!.isOwn).toBe(true);
    expect(mine.canMarkPaid).toBe(true);
    as(viewer);
    const seen = (await getPayments(runId))!;
    expect(seen.canMarkPaid).toBe(false);
    expect(seen.canExport).toBe(false);
    as(await account(null));
    await expect(getPayments(runId)).rejects.toMatchObject({ name: "ForbiddenError" });
    as(preparer);
    expect(await getPayments(randomUUID())).toBeNull();
  });
});
