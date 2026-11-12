import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const {
  createPayLine,
  savePaySettings,
  createPayRun,
  cancelPayRun,
  submitRun,
  approveRun,
  exportRemitlyList,
  markPaid,
  markRunAsTest,
} = await import("@/modules/payroll/actions");
const { getWorksheet, getPayments } = await import("@/modules/payroll/queries");
const { countMyPayslips } = await import("@/modules/payroll/payslip-queries");
const { PAYSLIP_LABELS } = await import("@/modules/payroll/constants");
const { sensitiveContext, maskFor } = await import("@/modules/people/sensitive");
const { decryptRunLine, payrollToday } = await import("@/modules/payroll/service");
const { fieldCrypto } = await import("@/lib/crypto");

type Row = Record<string, unknown>;
type Level = "preparer" | "approver" | "viewer" | null;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let seq = 0;
const uniq = (p: string) =>
  `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}x${seq++}`;
const NO_ACCESS = "You do not have access to do that.";
const BAD = "Check the request and try again.";

async function account(level: Level = "preparer") {
  const id = randomUUID();
  await db.execute(
    sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("pay")}@example.com`}, ${level})`,
  );
  await db.execute(
    sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`,
  );
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
  return n % 2 === 0
    ? { periodStart: `2028-${mm}-01`, periodEnd: `2028-${mm}-15` }
    : { periodStart: `2028-${mm}-16`, periodEnd: `2028-${mm}-${last}` };
}
const as = (who: unknown) => {
  current.user = who;
};
async function giveLine(
  employeeId: string,
  p: { periodStart: string; periodEnd: string },
  over: Record<string, unknown> = {},
  author: unknown = preparer,
) {
  as(author);
  const r = await createPayLine({
    employeeId,
    hoursPerDay: 8,
    paymentMethod: "remitly",
    effectiveFrom: p.periodStart,
    endsOn: p.periodEnd,
    monthly: "22,000",
    ...over,
  });
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
}
async function newRun(p: { periodStart: string; periodEnd: string }) {
  as(preparer);
  const r = await createPayRun(p);
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}
async function approvedRun(p: { periodStart: string; periodEnd: string }) {
  const runId = await newRun(p);
  as(preparer);
  const s = await submitRun({ runId });
  if (!s.ok) throw new Error(`submit failed: ${s.error}`);
  as(approver);
  const hash = (await getWorksheet(runId))!.expectedHash!;
  const a = await approveRun({ runId, expectedHash: hash });
  if (!a.ok) throw new Error(`approve failed: ${a.error}`);
  return runId;
}
const status = async (runId: string) =>
  (await rows<{ status: string }>(sql`select status from payroll.pay_runs where id = ${runId}`))[0]
    .status;
const paymentRows = (runId: string) =>
  rows<Row>(sql`select * from payroll.pay_payments where run_id = ${runId} order by created_at`);
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
const NOT_APPROVED = "The Remitly list is available once the run is approved.";

let preparer: Awaited<ReturnType<typeof account>>;
let other: Awaited<ReturnType<typeof account>>;
let approver: Awaited<ReturnType<typeof account>>;
let viewer: Awaited<ReturnType<typeof account>>;
afterAll(() => {
  vi.useRealTimers();
});

// The test periods are in 2028, and a payment can't be dated before its period starts or after today: only the clock (Date, nothing
// else) is moved to the end of 2028, so a payment dated "today" is inside every period used here.
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2028-12-30T12:00:00Z") });
  preparer = await account("preparer");
  other = await account("preparer");
  approver = await account("approver");
  viewer = await account("viewer");
  as(preparer);
  const rates = {
    cutoffDivisor: 11,
    changeWarnPercent: 10,
    extraRegular: "125",
    extraRestDay: "130",
    extraRestDayOver8: "169",
    reason: "Test rates",
  };
  expect(await savePaySettings({ ...rates, effectiveFrom: "2028-01-01" })).toMatchObject({
    ok: true,
  });
});

describe("the Remitly list", () => {
  it("is refused before approval, and for a cancelled run", async () => {
    const p = slot(0);
    const emp = await person();
    await giveLine(emp, p);
    const draft = await newRun(p);
    as(preparer);
    expect(await exportRemitlyList({ runId: draft })).toEqual({ ok: false, error: NOT_APPROVED });
    expect((await footprint(draft)).audits).toBe(0);
    expect(await submitRun({ runId: draft })).toMatchObject({ ok: true });
    expect(await exportRemitlyList({ runId: draft })).toEqual({ ok: false, error: NOT_APPROVED }); // in review
    expect((await footprint(draft)).changes).toBe(0);

    const q = slot(1);
    await giveLine(await person(), q);
    const cancelled = await newRun(q);
    as(preparer);
    expect(await cancelPayRun({ runId: cancelled, reason: "Pay lines changed" })).toMatchObject({
      ok: true,
    });
    expect(await exportRemitlyList({ runId: cancelled })).toEqual({
      ok: false,
      error: NOT_APPROVED,
    });

  });

  it("a pay line made with only the monthly rate needs nothing else to be sent, approved and listed, in pesos only", async () => {
    const r = slot(2);
    const emp = await person(null, "Pesoonly");
    await giveLine(emp, r); // no FTE, no allowance, and no dollar rate anywhere
    const runId = await newRun(r);
    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    as(approver);
    expect(await approveRun({ runId, expectedHash: (await getWorksheet(runId))!.expectedHash! })).toMatchObject({ ok: true });
    as(preparer);
    const list = await exportRemitlyList({ runId });
    expect(list).toMatchObject({ ok: true });
    // 22,000 / 2 = 11,000.00 pesos, and the list has no dollars column.
    const lines = list.ok ? list.data.csv.trim().split("\r\n") : [];
    expect(lines[0]).toBe("Person,Alias,Pesos,Bank,Account name,Account number");
    expect(lines.find((l) => l.includes("Pesoonly"))).toMatch(/,11000\.00,,,$/); // nothing on file: blank bank cells
  });

  it("gives one row per person, neutralizes a formula alias, and is audited without amounts", async () => {
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
    expect(lines[0]).toBe("Person,Alias,Pesos,Bank,Account name,Account number");
    expect(lines).toHaveLength(3);
    expect(r.data.missingDetails).toBe(2); // nobody here has payout details on file
    // Both aliases are listed. Their order depends on the database's sort rules (it differs between a local database and CI), so it is
    // not asserted. What matters is that no cell can start a spreadsheet formula: when the formula alias comes first the cell is
    // neutralized with a leading quote, and when it comes second the cell starts with the other alias.
    const aliasCell = lines.find((l) => l.includes("Lopezexport"))!.split(",")[1];
    expect(aliasCell).toContain("HYPERLINK(1)");
    expect(aliasCell).toContain("Billing");
    expect(aliasCell).not.toMatch(/^[=+\-@\t\r]/);
    if (aliasCell.startsWith("'")) expect(aliasCell.startsWith("'=HYPERLINK(1)")).toBe(true);

    // The pesos are the sum of the person's decrypted line nets.
    const nets = await rows<{ id: string; payload_enc: string }>(
      sql`select id, payload_enc from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${emp}`,
    );
    const total = nets.reduce((s, n) => s + decryptRunLine(n.id, n.payload_enc).result.net, 0n);
    const pesos = `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`;
    expect(lines.find((l) => l.includes("Lopezexport"))).toMatch(new RegExp(`,${pesos.replace(".", "\\.")},,,$`));

    const [audit] = await rows<{ metadata: unknown }>(
      sql`select metadata from ops.audit_log where target_id = ${runId} and action = 'payroll.remitly.export'`,
    );
    expect(JSON.stringify(audit.metadata)).toMatch(/"rows":\s*2/);
    expect(JSON.stringify(audit.metadata)).not.toContain(pesos);
    expect(
      await rows(
        sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'list_exported'`,
      ),
    ).toHaveLength(1);
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

  it("is for Preparers and Approvers only, and checks its input", async () => {
    const p = slot(5);
    await giveLine(await person(), p);
    const runId = await approvedRun(p);
    for (const who of [viewer, await account(null)]) {
      as(who);
      expect(await exportRemitlyList({ runId })).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(approver);
    expect(await exportRemitlyList({ runId })).toMatchObject({ ok: true });
    as(preparer);
    expect(await exportRemitlyList({ runId: "nope" })).toEqual({ ok: false, error: BAD });
    expect(await exportRemitlyList({ runId: randomUUID() })).toMatchObject({ ok: false });
  });
});

// ---- Payout details in the list (owner decision 2026-11-12: full details for Preparers and Approvers on a real run) ----

/** Half month `n` of 2029: the list does not check payment dates, so these runs can sit after the fake "today". */
function slot29(n: number) {
  const month = Math.floor(n / 2) + 1;
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(2029, month, 0)).getUTCDate();
  return n % 2 === 0 ? { periodStart: `2029-${mm}-01`, periodEnd: `2029-${mm}-15` } : { periodStart: `2029-${mm}-16`, periodEnd: `2029-${mm}-${last}` };
}
const BANK = { bankName: "Testbank Philippines", bankAccountName: "Lopez Testperson", bankAccountNumber: "0012345678901" };
async function giveBankDetails(employeeId: string, over: Partial<typeof BANK> = {}) {
  const v = { ...BANK, ...over };
  const c = fieldCrypto();
  const masks = { bankName: maskFor("bankName", v.bankName), bankAccountName: maskFor("bankAccountName", v.bankAccountName), bankAccountNumber: maskFor("bankAccountNumber", v.bankAccountNumber) };
  await db.execute(sql`insert into core.employee_sensitive (employee_id, bank_name_enc, bank_account_name_enc, bank_account_number_enc, masks)
    values (${employeeId}, ${c.encrypt(v.bankName, sensitiveContext("bankName", employeeId))}, ${c.encrypt(v.bankAccountName, sensitiveContext("bankAccountName", employeeId))},
      ${c.encrypt(v.bankAccountNumber, sensitiveContext("bankAccountNumber", employeeId))}, ${JSON.stringify(masks)}::jsonb)`);
}
const bankAudits = (runId: string) =>
  rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where target_id = ${runId} and action = 'sensitive.view' and metadata::text like '%bankAccountNumber%'`);

describe("payout details in the list", () => {
  it("a real run carries the full bank details for a Preparer and an Approver, blank cells for someone with none, and one audited read with field names only", async () => {
    const p = slot29(0);
    const paid = await person(null, "Withbank");
    const unpaid = await person(null, "Nobank");
    await giveLine(paid, p);
    await giveLine(unpaid, p);
    await giveBankDetails(paid);
    const runId = await approvedRun(p);

    for (const who of [preparer, approver]) {
      as(who);
      const r = await exportRemitlyList({ runId });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data).toMatchObject({ test: false, missingDetails: 1, rows: 2 });
      const lines = r.data.csv.trim().split("\r\n");
      expect(lines[0]).toBe("Person,Alias,Pesos,Bank,Account name,Account number");
      expect(lines.find((l) => l.includes("Withbank"))).toMatch(/,Testbank Philippines,Lopez Testperson,0012345678901$/);
      expect(lines.find((l) => l.includes("Nobank"))).toMatch(/,,,$/);
      expect(r.data.csv).not.toContain("TEST");
    }

    // Two downloads, two audit rows: the field names and how many people, never a value.
    const audits = await bankAudits(runId);
    expect(audits).toHaveLength(2);
    const text = JSON.stringify(audits);
    expect(text).toContain("bankName");
    expect(text).toMatch(/"people":\s*1/);
    for (const secret of [BANK.bankName, BANK.bankAccountName, BANK.bankAccountNumber]) expect(text).not.toContain(secret);
    // The audit row of the export itself holds counts only.
    const [exportAudit] = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where target_id = ${runId} and action = 'payroll.remitly.export' order by id limit 1`);
    for (const secret of [BANK.bankName, BANK.bankAccountNumber]) expect(JSON.stringify(exportAudit.metadata)).not.toContain(secret);
  });

  it("a test run carries masked details and a TEST note, never a full number, and reads nothing sensitive", async () => {
    const p = slot29(1);
    const emp = await person(null, "Practicebank");
    await giveLine(emp, p);
    await giveBankDetails(emp);
    const runId = await approvedRun(p);
    as(preparer);
    expect(await markRunAsTest({ runId, test: true, reason: "Practice cycle" })).toMatchObject({ ok: true });

    const r = await exportRemitlyList({ runId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ test: true, missingDetails: 0 });
    expect(r.data.fileName).toMatch(/^remitly-TEST-2029-01-16-to-2029-01-31\.csv$/);
    const lines = r.data.csv.trim().split("\r\n");
    expect(lines[0]).toBe("Person,Alias,Pesos,Bank,Account name,Account number,Note");
    const row = lines.find((l) => l.includes("Practicebank"))!;
    expect(row).toContain("TEST - do not pay");
    expect(row).toContain(maskFor("bankAccountNumber", BANK.bankAccountNumber));
    for (const secret of [BANK.bankName, BANK.bankAccountName, BANK.bankAccountNumber]) expect(r.data.csv).not.toContain(secret);
    expect(await bankAudits(runId)).toHaveLength(0); // nothing was decrypted
  });

  it("refuses the file, writing nothing, when someone's details can't be read", async () => {
    const p = slot29(2);
    const emp = await person(null, "Brokenbank");
    await giveLine(emp, p);
    await giveBankDetails(emp);
    await db.execute(sql`update core.employee_sensitive set bank_name_enc = 'not-a-ciphertext' where employee_id = ${emp}`);
    const runId = await approvedRun(p);
    as(preparer);
    const before = await footprint(runId);
    const r = await exportRemitlyList({ runId });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/payout details can't be read/) });
    expect(await footprint(runId)).toEqual(before);
    expect(await bankAudits(runId)).toHaveLength(0);
  });

  it("an Approver can mark a payment too, but still not their own", async () => {
    const p = slot(22);
    const other2 = await account("approver");
    const ownEmp = await person(other2.id);
    const colleague = await person(null, "Colleaguepay");
    await giveLine(ownEmp, p);
    await giveLine(colleague, p);
    const runId = await approvedRun(p); // approved by the shared Approver, so other2 is free to pay
    as(other2);
    expect(await markPaid({ runId, employeeId: ownEmp, reference: REF, paidOn: today() })).toMatchObject({ ok: false, error: expect.stringMatching(/own/i) });
    expect(await markPaid({ runId, employeeId: colleague, reference: REF, paidOn: today() })).toMatchObject({ ok: true });
    // The Approver who marked it can read the reference (they hold mark_paid), a viewer cannot.
    expect((await getPayments(runId))!.people.find((x) => x.employeeId === colleague)!.payment!.reference).toBe(REF);
    as(viewer);
    expect((await getPayments(runId))!.people.find((x) => x.employeeId === colleague)!.payment!.reference).toBeNull();
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
    expect(
      await markPaid({ runId: draft, employeeId: emp, reference: REF, paidOn: today() }),
    ).toMatchObject({ ok: false });
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

  it("is for Preparers and Approvers only and checks its input", async () => {
    const p = slot(8);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await approvedRun(p);
    for (const who of [viewer, await account(null)]) {
      as(who);
      expect(await markPaid({ runId, employeeId: emp, reference: REF, paidOn: today() })).toEqual({
        ok: false,
        error: NO_ACCESS,
      });
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
      expect(
        await markPaid({ runId, employeeId: emp, reference: REF, paidOn: today(), ...bad }),
      ).toEqual({ ok: false, error: BAD });
    }
    const future = await markPaid({ runId, employeeId: emp, reference: REF, paidOn: "2999-01-01" });
    expect(future).toEqual({ ok: false, error: "The payment date can't be in the future." });
    const early = await markPaid({ runId, employeeId: emp, reference: REF, paidOn: "2028-04-30" }); // the period starts 2028-05-01
    expect(early).toEqual({
      ok: false,
      error: "The payment date can't be before the pay period starts.",
    });
    expect(
      await markPaid({ runId, employeeId: emp, reference: REF, paidOn: "2028-05-01" }),
    ).toMatchObject({ ok: true }); // the first day is fine
    expect(await paymentRows(runId)).toHaveLength(1);
  });

  it("a Preparer can't mark their own payment; another Preparer can", async () => {
    const p = slot(9);
    const owner = await account("preparer");
    const ownEmp = await person(owner.id);
    await giveLine(ownEmp, p);
    const runId = await approvedRun(p);
    as(owner);
    expect(await markPaid({ runId, employeeId: ownEmp, reference: REF, paidOn: today() })).toEqual({
      ok: false,
      error: "You can't do this for your own pay. Another Preparer does it.",
    });
    expect(await paymentRows(runId)).toHaveLength(0);
    as(other);
    expect(
      await markPaid({ runId, employeeId: ownEmp, reference: REF, paidOn: today() }),
    ).toMatchObject({ ok: true });
    expect(await paymentRows(runId)).toHaveLength(1);
  });

  it("encrypts the reference and keeps it out of the audit entry, the change log's clear columns and notices", async () => {
    const p = slot(10);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await approvedRun(p);
    as(preparer);
    const ref = "RMT-SECRET-77";
    const notices = async () =>
      (
        await rows<{ n: number }>(
          sql`select count(*)::int as n from ops.notifications where link = ${`/payroll/${runId}`}`,
        )
      )[0].n;
    const noticesBefore = await notices(); // the submit and approval notices already exist
    expect(
      await markPaid({ runId, employeeId: emp, reference: ref, paidOn: today() }),
    ).toMatchObject({ ok: true });
    const [pay] = await rows<{ id: string; reference_enc: string; marked_by: string }>(
      sql`select id, reference_enc, marked_by from payroll.pay_payments where run_id = ${runId}`,
    );
    expect(pay.reference_enc).not.toContain(ref);
    expect(fieldCrypto().decrypt(pay.reference_enc, `pay_payment:${pay.id}`)).toBe(ref);
    expect(pay.marked_by).toBe(preparer.id);
    const audit = await rows(
      sql`select metadata::text as m, action from ops.audit_log where target_id = ${runId} and action like 'payroll.payment.%'`,
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain(ref);
    expect(await notices()).toBe(noticesBefore); // marking a payment sends no notice in this task
    expect(
      await rows(sql`select 1 from ops.notifications where body like ${`%${ref}%`}`),
    ).toHaveLength(0);
    expect(
      await rows(
        sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'payment_marked'`,
      ),
    ).toHaveLength(1);
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
    expect(
      await markPaid({ runId, employeeId: a, reference: "RMT-A-1", paidOn: today() }),
    ).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("approved");

    // Correct a's reference before everyone is paid.
    expect(
      await markPaid({ runId, employeeId: a, reference: "RMT-A-2", paidOn: today() }),
    ).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("approved");
    expect(await paymentRows(runId)).toHaveLength(2);
    const view = (await getPayments(runId))!;
    expect(view.people.find((x) => x.employeeId === a)!.payment!.reference).toBe("RMT-A-2");
    expect(view.people.find((x) => x.employeeId === b)!.payment).toBeNull();

    expect(
      await markPaid({ runId, employeeId: b, reference: "RMT-B-1", paidOn: today() }),
    ).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("paid");
    expect(
      await rows(
        sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'run_paid'`,
      ),
    ).toHaveLength(1);
    expect(
      await rows(
        sql`select 1 from ops.audit_log where target_id = ${runId} and action = 'payroll.run.paid'`,
      ),
    ).toHaveLength(1);

    // After paid, a correction is still recorded as a new row; the run stays paid and nothing else changes.
    expect(
      await markPaid({ runId, employeeId: b, reference: "RMT-B-2", paidOn: today() }),
    ).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("paid");
    expect(await paymentRows(runId)).toHaveLength(4);
    expect(
      await rows(
        sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'run_paid'`,
      ),
    ).toHaveLength(1);
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
    expect(
      await rows(
        sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'run_paid'`,
      ),
    ).toHaveLength(1);
  });

  it("works for people with no linked account (nothing to notify)", async () => {
    const p = slot(13);
    const emp = await person(null);
    await giveLine(emp, p);
    const runId = await approvedRun(p);
    as(preparer);
    const noticesOfRun = async () =>
      (
        await rows<{ n: number }>(
          sql`select count(*)::int as n from ops.notifications where link = ${`/payroll/${runId}`}`,
        )
      )[0].n;
    const before = await noticesOfRun();
    expect(
      await markPaid({ runId, employeeId: emp, reference: REF, paidOn: today() }),
    ).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("paid");
    const after = await noticesOfRun();
    expect(after).toBe(before);
  });

  it("a test run reaches paid without a statement notice and is never listed under My pay; a real run gets both", async () => {
    const worker = await account("viewer");
    const emp = await person(worker.id);
    const realPeriod = slot(20);
    const testPeriod = slot(21);
    await giveLine(emp, realPeriod);
    await giveLine(emp, testPeriod);
    const real = await approvedRun(realPeriod);
    const practice = await approvedRun(testPeriod);

    // A run that is already approved can be marked as a test until it is paid.
    as(preparer);
    expect(await markRunAsTest({ runId: practice, test: true, reason: "Practice cycle" })).toMatchObject({ ok: true });
    for (const runId of [real, practice]) {
      expect(await markPaid({ runId, employeeId: emp, reference: REF, paidOn: today() })).toMatchObject({ ok: true });
      expect(await status(runId)).toBe("paid");
    }

    const notices = async () =>
      (await rows<{ n: number }>(sql`select count(*)::int as n from ops.notifications where user_id = ${worker.id} and kind = ${PAYSLIP_LABELS.noticeKind}`))[0].n;
    expect(await notices()).toBe(1); // the real run only
    as(worker);
    expect(await countMyPayslips()).toBe(1);

    // Once paid, a run can no longer be marked: a real payout is never hidden.
    as(preparer);
    expect(await markRunAsTest({ runId: real, test: true, reason: "Hide it" })).toMatchObject({ ok: false, error: expect.stringMatching(/paid run can't be changed/) });
  });

  it("the database refuses any status jump to paid except from approved", async () => {
    const p = slot(14);
    await giveLine(await person(), p);
    const runId = await newRun(p);
    await expect(
      db.execute(sql`update payroll.pay_runs set status = 'paid' where id = ${runId}`),
    ).rejects.toThrow();
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

  it("shows references only to Preparers and Approvers; a viewer sees who marked it and when; the sensitive read is logged only when one was decrypted", async () => {
    const p = slot(16);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await approvedRun(p);
    const reads = async () =>
      (
        await rows(
          sql`select 1 from ops.audit_log where target_id = ${runId} and action = 'sensitive.view' and metadata::text like '%payment references%'`,
        )
      ).length;

    // Nothing paid yet: nothing decrypted, nothing logged (for anyone).
    as(preparer);
    expect((await getPayments(runId))!.people[0].payment).toBeNull();
    as(viewer);
    await getPayments(runId);
    expect(await reads()).toBe(0);

    as(preparer);
    expect(
      await markPaid({ runId, employeeId: emp, reference: "RMT-VISIBLE-1", paidOn: today() }),
    ).toMatchObject({ ok: true });
    as(viewer);
    const seen = (await getPayments(runId))!.people[0].payment!;
    expect(seen.reference).toBeNull();
    expect(JSON.stringify(seen)).not.toContain("RMT-VISIBLE-1");
    expect(seen.markedBy).toBe(
      (
        await rows<{ email: string }>(sql`select email from core.users where id = ${preparer.id}`)
      )[0].email,
    );
    expect(seen.paidOn).toBe(today());
    expect(Number.isNaN(Date.parse(seen.markedAt))).toBe(false);
    expect(await reads()).toBe(0); // a viewer decrypts nothing

    as(approver);
    expect((await getPayments(runId))!.people[0].payment!.reference).toBe("RMT-VISIBLE-1"); // an Approver holds mark_paid too
    expect(await reads()).toBe(1);

    as(preparer);
    expect((await getPayments(runId))!.people[0].payment!.reference).toBe("RMT-VISIBLE-1");
    expect(await reads()).toBe(2);
    const [entry] = await rows<{ metadata: unknown }>(
      sql`select metadata from ops.audit_log where target_id = ${runId} and action = 'sensitive.view' and metadata::text like '%payment references%'`,
    );
    expect(JSON.stringify(entry.metadata)).not.toContain("RMT-VISIBLE-1");
  });
});
