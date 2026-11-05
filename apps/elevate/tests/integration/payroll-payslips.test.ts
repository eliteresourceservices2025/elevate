import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: payslips, the /my-pay list, the PDF route and the "paid" notification. Invented names and figures only.
// Every period is a half month of 2029; each test uses its own period and its pay lines start and end inside it.

const current = vi.hoisted(() => ({ user: null as unknown, allow: true }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => current.allow) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { createPayLine, savePaySettings, createPayRun, cancelPayRun, setRunUsdRate, submitRun, approveRun, markPaid } = await import("@/modules/payroll/actions");
const { getWorksheet } = await import("@/modules/payroll/queries");
const { listMyPayslips, countMyPayslips } = await import("@/modules/payroll/payslip-queries");
const { decryptRunLine } = await import("@/modules/payroll/service");
const { formatPesos } = await import("@/modules/payroll/money");
const { GET } = await import("@/app/api/payroll/payslips/[runId]/route");

type Row = Record<string, unknown>;
type Level = "preparer" | "approver" | "viewer" | null;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let seq = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}x${seq++}`;

async function account(level: Level = null, roles: string[] = ["employee"]) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("slip")}@example.com`}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  return { id, email: "x@example.com", roles, payrollAccess: level };
}
async function person(userId: string | null = null, last = uniq("Testreyes")) {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values ('Liza', ${last}, ${`${uniq("emp")}@example.com`}, 'active', ${userId}) returning id`);
  return e.id;
}
/** Half month `n` of 2029. */
function slot(n: number) {
  const month = Math.floor(n / 2) + 1;
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(2029, month, 0)).getUTCDate();
  return n % 2 === 0 ? { periodStart: `2029-${mm}-01`, periodEnd: `2029-${mm}-15` } : { periodStart: `2029-${mm}-16`, periodEnd: `2029-${mm}-${last}` };
}
const as = (who: unknown) => {
  current.user = who;
};
async function giveLine(employeeId: string, p: { periodStart: string; periodEnd: string }, over: Record<string, unknown> = {}) {
  as(preparer);
  const r = await createPayLine({
    employeeId,
    hoursPerDay: 8,
    fte: "1",
    paymentMethod: "remitly",
    effectiveFrom: p.periodStart,
    endsOn: p.periodEnd,
    monthly: "22,000",
    pesoAllowance: "1,000",
    dollarAllowance: "0",
    ...over,
  });
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
}
async function newRun(p: { periodStart: string; periodEnd: string }) {
  as(preparer);
  const r = await createPayRun(p);
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  await setRunUsdRate({ runId: r.data.runId, rate: "58.50" });
  return r.data.runId;
}
async function approvedRun(p: { periodStart: string; periodEnd: string }) {
  const runId = await newRun(p);
  as(preparer);
  const s = await submitRun({ runId });
  if (!s.ok) throw new Error(`submit failed: ${s.error}`);
  as(approver);
  const a = await approveRun({ runId, expectedHash: (await getWorksheet(runId))!.expectedHash! });
  if (!a.ok) throw new Error(`approve failed: ${a.error}`);
  return runId;
}
const today = () => "2029-12-30";
async function payAll(runId: string, employeeIds: string[]) {
  as(preparer);
  for (const employeeId of employeeIds) {
    const r = await markPaid({ runId, employeeId, reference: `RMT-SLIP-${uniq("r")}`, paidOn: today() });
    if (!r.ok) throw new Error(`pay failed: ${r.error}`);
  }
}
/** A paid run for the given people (each with one line), in period `p`. */
async function paidRun(p: { periodStart: string; periodEnd: string }, employeeIds: string[], over: Record<string, unknown> = {}) {
  for (const e of employeeIds) await giveLine(e, p, over);
  const runId = await approvedRun(p);
  await payAll(runId, employeeIds);
  return runId;
}
const call = (runId: string) => GET(new Request("http://localhost/api/payroll/payslips/x"), { params: Promise.resolve({ runId }) });
const netOf = async (runId: string, employeeId: string) =>
  (await rows<{ id: string; payload_enc: string }>(sql`select id, payload_enc from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId}`)).reduce(
    (s, n) => s + decryptRunLine(n.id, n.payload_enc).result.net,
    0n,
  );
const slipNotices = (userId: string) => rows<{ title: string; body: string; link: string; kind: string }>(sql`select title, body, link, kind from ops.notifications where user_id = ${userId} and link = '/my-pay'`);

let preparer: Awaited<ReturnType<typeof account>>;
let approver: Awaited<ReturnType<typeof account>>;
afterAll(() => {
  vi.useRealTimers();
});

// The test periods are in 2029 and a payment can't be dated after today: only the clock (Date) is moved to the end of 2029, and it
// is restored after the file.
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2029-12-30T12:00:00Z") });
  preparer = await account("preparer");
  approver = await account("approver");
  as(preparer);
  const saved = await savePaySettings({
    cutoffDivisor: 11,
    changeWarnPercent: 10,
    extraRegular: "125",
    extraHoliday: "200",
    extraRestDay: "130",
    extraRestDayOver8: "169",
    holiday: "100",
    reason: "Test rates",
    effectiveFrom: "2028-11-01",
  });
  expect(saved).toMatchObject({ ok: true });
});

describe("only a paid run has a payslip", () => {
  it("lists nothing and answers 404 for a draft, in-review, approved-but-unpaid and cancelled run, then lists it once paid", async () => {
    const owner = await account();
    const emp = await person(owner.id);

    const draftP = slot(0);
    await giveLine(emp, draftP);
    const draft = await newRun(draftP);
    const reviewP = slot(1);
    await giveLine(emp, reviewP);
    const review = await newRun(reviewP);
    as(preparer);
    expect(await submitRun({ runId: review })).toMatchObject({ ok: true });
    const approvedP = slot(2);
    await giveLine(emp, approvedP);
    const approved = await approvedRun(approvedP);
    const cancelP = slot(3);
    await giveLine(emp, cancelP);
    const cancelled = await newRun(cancelP);
    as(preparer);
    expect(await cancelPayRun({ runId: cancelled, reason: "Pay lines changed" })).toMatchObject({ ok: true });

    as(owner);
    expect(await listMyPayslips()).toEqual([]);
    expect(await countMyPayslips()).toBe(0);
    const missing = await call(randomUUID());
    expect(missing.status).toBe(404);
    const missingBody = await missing.text();
    for (const id of [draft, review, approved, cancelled]) {
      const r = await call(id);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe(missingBody);
    }

    await payAll(approved, [emp]);
    as(owner);
    const list = await listMyPayslips();
    expect(list).toHaveLength(1);
    expect(list[0].runId).toBe(approved);
    expect(list[0].periodLabel).toBe("2029-02-01 to 2029-02-15");
    expect(list[0].net).toBe(formatPesos(await netOf(approved, emp)));
    expect(await countMyPayslips()).toBe(1);
    expect((await call(approved)).status).toBe(200);
    expect((await call(draft)).status).toBe(404);
  });
});

describe("the payslip is the person's own", () => {
  it("answers 404 to another person's run for every role, including a Super Admin with a payroll level", async () => {
    const mine = await account();
    const myEmp = await person(mine.id);
    const theirs = await account();
    const theirEmp = await person(theirs.id);
    const runId = await paidRun(slot(4), [theirEmp]);
    await giveLine(myEmp, slot(5));

    const intruders = [
      { ...(await account("approver")), roles: ["super_admin"] },
      { ...(await account("preparer")), roles: ["hr_admin"] },
      { ...(await account()), roles: ["team_lead"] },
      { ...(await account()), roles: ["recruiter"] },
      { ...(await account()), roles: ["executive"] },
      mine,
    ];
    for (const who of intruders) {
      as(who);
      expect((await call(runId)).status).toBe(404);
      expect((await listMyPayslips()).filter((x) => x.runId === runId)).toEqual([]);
    }
    as(theirs);
    expect((await call(runId)).status).toBe(200);
  });

  it("gives a two-line person one payslip with both lines, and the total", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const p = slot(6);
    await giveLine(emp, p, { alias: "Front desk" });
    await giveLine(emp, p, { alias: "*Billing*", monthly: "10,000" });
    const runId = await approvedRun(p);
    await payAll(runId, [emp]);
    as(owner);
    const list = await listMyPayslips();
    expect(list).toHaveLength(1);
    expect(list[0].net).toBe(formatPesos(await netOf(runId, emp)));
    expect((await rows(sql`select 1 from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${emp}`)).length).toBe(2);
    const { getMyPayslip } = await import("@/modules/payroll/payslip-queries");
    const slip = await getMyPayslip(owner as never, runId);
    expect(slip?.lines).toHaveLength(2);
  });

  it("pages the list, newest period first", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const ids: string[] = [];
    for (const n of [7, 8, 9]) ids.push(await paidRun(slot(n), [emp]));
    as(owner);
    const first = await listMyPayslips({ page: 1, pageSize: 2 });
    const second = await listMyPayslips({ page: 2, pageSize: 2 });
    expect(first.map((x) => x.runId)).toEqual([ids[2], ids[1]]);
    expect(second.map((x) => x.runId)).toEqual([ids[0]]);
    expect(await countMyPayslips()).toBe(3);
  });
});

describe("the PDF", () => {
  it("is a private, uncached PDF, audited with the run id only and logged as a download", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const runId = await paidRun(slot(10), [emp]);
    as(owner);
    const r = await call(runId);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const bytes = Buffer.from(await r.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");

    const audit = await rows<{ metadata: unknown; target_id: string }>(sql`select metadata, target_id from ops.audit_log where actor_user_id = ${owner.id} and action = 'sensitive.view'`);
    expect(audit).toHaveLength(1);
    expect(audit[0].target_id).toBe(runId);
    const net = formatPesos(await netOf(runId, emp));
    expect(JSON.stringify(audit)).not.toContain(net);
    expect(JSON.stringify(audit)).not.toMatch(/\d{1,3},\d{3}\.\d{2}/);
    const log = await rows<{ employee_id: string }>(sql`select employee_id from payroll.pay_change_log where run_id = ${runId} and action = 'payslip_downloaded' and actor_id = ${owner.id}`);
    expect(log).toHaveLength(1);
    expect(log[0].employee_id).toBe(emp);
  });

  it("is rate limited, and leaves nothing behind when refused", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const runId = await paidRun(slot(11), [emp]);
    as(owner);
    current.allow = false;
    try {
      const r = await call(runId);
      expect(r.status).toBe(429);
    } finally {
      current.allow = true;
    }
    expect(await rows(sql`select 1 from ops.audit_log where actor_user_id = ${owner.id} and action = 'sensitive.view'`)).toHaveLength(0);
    expect(await rows(sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'payslip_downloaded'`)).toHaveLength(0);
  });

  it("gives a clean error, with no audit row, when a line can't be read", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const runId = await paidRun(slot(12), [emp]);
    // Break one line's ciphertext the only way possible: as the database owner, with the freeze trigger switched off for the statement.
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update payroll.pay_run_lines set payload_enc = 'garbage' where run_id = ${runId}`);
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      as(owner);
      const r = await call(runId);
      expect(r.status).toBe(500);
      const text = await r.text();
      expect(text).toMatch(/can't be read/i);
      expect(text).not.toMatch(/Error|stack|at /);
      expect(await rows(sql`select 1 from ops.audit_log where actor_user_id = ${owner.id} and action = 'sensitive.view'`)).toHaveLength(0);
      const list = await listMyPayslips();
      expect(list.find((x) => x.runId === runId)!.net).toBe("Can't be read");
      const logged = JSON.stringify(errors.mock.calls);
      expect(logged).not.toContain("garbage");
    } finally {
      errors.mockRestore();
    }
  });
});

describe("the notification when a run is paid", () => {
  it("goes to each linked person with a link and no amount, and marking paid works for a person with no account", async () => {
    const a = await account();
    const b = await account();
    const empA = await person(a.id);
    const empB = await person(b.id);
    const noAccount = await person(null);
    const p = slot(13);
    for (const e of [empA, empB, noAccount]) await giveLine(e, p);
    const runId = await approvedRun(p);

    as(preparer);
    expect(await markPaid({ runId, employeeId: empA, reference: "RMT-N-1", paidOn: today() })).toMatchObject({ ok: true });
    expect(await markPaid({ runId, employeeId: empB, reference: "RMT-N-2", paidOn: today() })).toMatchObject({ ok: true });
    expect(await slipNotices(a.id)).toHaveLength(0); // not paid until everyone is
    const last = await markPaid({ runId, employeeId: noAccount, reference: "RMT-N-3", paidOn: today() });
    expect(last).toEqual({ ok: true, data: { runPaid: true } });

    for (const [u, e] of [[a, empA], [b, empB]] as const) {
      const n = await slipNotices(u.id);
      expect(n).toHaveLength(1);
      expect(n[0].link).toBe("/my-pay");
      const text = `${n[0].title} ${n[0].body}`;
      expect(text).not.toMatch(/\d/);
      expect(text).not.toContain(formatPesos(await netOf(runId, e)));
      expect(text).not.toMatch(/overtime|pto/i);
    }
    // A correction after the run is paid sends nothing more.
    expect(await markPaid({ runId, employeeId: empA, reference: "RMT-N-9", paidOn: today() })).toMatchObject({ ok: true });
    expect(await slipNotices(a.id)).toHaveLength(1);
  });

  it("goes once to a person with two lines", async () => {
    const owner = await account();
    const emp = await person(owner.id);
    const p = slot(14);
    await giveLine(emp, p, { alias: "One" });
    await giveLine(emp, p, { alias: "Two" });
    const runId = await approvedRun(p);
    await payAll(runId, [emp]);
    expect(await slipNotices(owner.id)).toHaveLength(1);
  });
});
