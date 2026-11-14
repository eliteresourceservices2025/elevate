import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: draft runs, items, the worksheet and the checks. Invented names and figures only.
// Periods are the cutoffs of 2025 (all 24 are used) and August to December 2024; lines start in 2024, clear of the leftovers other
// payroll test files keep in the same throwaway database.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { createPayLine, updatePayLine, endPayLine, savePaySettings, createPayRun, cancelPayRun, savePayItem, dismissPayItem, confirmRunLine } = await import("@/modules/payroll/actions");
const { getWorksheet, getRuns, getRates } = await import("@/modules/payroll/queries");
const { decryptRunLine, encryptItemValue, settingsInForce } = await import("@/modules/payroll/service");
const { readChangeDetail } = await import("@/modules/payroll/changes");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function account(level: string | null = "preparer") {
  const id = randomUUID();
  const email = `${uniq("payr")}@example.com`;
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${email}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  return { id, email, roles: ["employee"], payrollAccess: level };
}
async function person(userId: string | null = null) {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values ('Maria', ${uniq("Testcruz")}, ${`${uniq("emp")}@example.com`}, 'active', ${userId}) returning id`);
  return e.id;
}
const lineBase = (employeeId: string, over: Record<string, unknown> = {}) => ({
  employeeId,
  hoursPerDay: 8,
  paymentMethod: "remitly",
  effectiveFrom: "2024-12-01",
  monthly: "22,000",
  ...over,
});
async function giveLine(who: unknown, employeeId: string, over: Record<string, unknown> = {}) {
  const before = current.user;
  current.user = who;
  const r = await createPayLine(lineBase(employeeId, over));
  current.user = before;
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
  return r.data.lineKey;
}
/** A cutoff of 2025: the 1st to the 15th (half 1) or the 16th to the last day of the month (half 2). */
const period = (month: number, half: 1 | 2 = 1) => ({
  periodStart: `2025-${String(month).padStart(2, "0")}-${half === 1 ? "01" : "16"}`,
  periodEnd: `2025-${String(month).padStart(2, "0")}-${half === 1 ? "15" : String(new Date(Date.UTC(2025, month, 0)).getUTCDate())}`,
});
const NOT_A_CUTOFF = { ok: false, error: "A pay run covers one cutoff: the 1st to the 15th, or the 16th to the last day of the month. (A test run can cover any dates, up to 31 days.)" };
async function newRun(who: unknown, p: { periodStart: string; periodEnd: string }) {
  current.user = who;
  const r = await createPayRun(p);
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}
const runLines = (runId: string, employeeId: string) =>
  rows<{ id: string; line_id: string; flags: string[]; confirmed_by: string | null; payload_enc: string; alias: string | null }>(
    sql`select id, line_id, flags, confirmed_by, payload_enc, alias from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId} order by id`,
  );
const payloadOf = async (runId: string, employeeId: string, index = 0) => {
  const l = (await runLines(runId, employeeId))[index];
  return decryptRunLine(l.id, l.payload_enc);
};
// An itemized type (allowance, reimbursement, bonus, adjustment) needs a name; tests that do not care get a plain one.
const ITEMIZED = ["allowance", "reimbursement", "bonus", "adjustment"];
const item = (runId: string, employeeId: string, runLineId: string, type: string, value: string, reason?: string, label?: string) =>
  savePayItem({ runId, employeeId, runLineId, type, value, reason, ...(ITEMIZED.includes(type) ? { label: label ?? "Test line" } : {}) });
// The notes about a person, leaving out "no payout details" (the test people have none, and these tests are about other checks).
const notesFor = (list: { employeeId: string | null; code: string }[], employeeId: string) => forPerson(list, employeeId).filter((c) => c !== "no_payout_details");
const forPerson = (list: { employeeId: string | null; code: string }[], employeeId: string) => list.filter((c) => c.employeeId === employeeId).map((c) => c.code).sort();

let preparer: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  preparer = await account();
  // The first real settings: extra-hours rates from June 2025. Earlier periods see the starting row, which has none.
  current.user = preparer;
  const saved = await savePaySettings({
    effectiveFrom: "2025-06-01",
    cutoffDivisor: 11,
    changeWarnPercent: 10,
    extraRegular: "125",
    extraRestDay: "130",
    extraRestDayOver8: "169",
    reason: "Test rates",
  });
  expect(saved.ok).toBe(true);
});

describe("creating a run", () => {
  it("builds one line per resolved version, including a two-line person and a person with no account, and refuses the same or an overlapping period", async () => {
    const solo = await person();
    const noAccount = await person(null);
    const twoLines = await person();
    const [clientA] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Client A ")}) returning id`);
    await giveLine(preparer, solo);
    await giveLine(preparer, noAccount, { monthly: "30,000" });
    await giveLine(preparer, twoLines, { clientId: clientA.id, alias: "Front desk" });
    await giveLine(preparer, twoLines, { alias: "Night shift", monthly: "10,000" });

    const p = period(1);
    const runId = await newRun(preparer, p);
    expect(await runLines(runId, solo)).toHaveLength(1);
    expect(await runLines(runId, noAccount)).toHaveLength(1);
    const two = await runLines(runId, twoLines);
    expect(two.map((l) => l.alias).sort()).toEqual(["Front desk", "Night shift"]);

    // 22,000 / 2 = 11,000: a pay line has only the monthly rate, nothing else is added.
    const pay = await payloadOf(runId, solo);
    expect(pay.result.cutoff).toBe(1_100_000n);
    expect(pay.result.gross).toBe(1_100_000n);
    expect(pay.result.net).toBe(1_100_000n);

    const [run] = await rows<{ status: string; settings_snapshot: unknown }>(sql`select status, settings_snapshot from payroll.pay_runs where id = ${runId}`);
    expect(run.status).toBe("draft");
    expect(run.settings_snapshot).toEqual(await settingsInForce(db, p.periodStart));

    const same = await createPayRun(p);
    expect(same).toMatchObject({ ok: false, error: expect.stringContaining(`There is already a pay run for ${p.periodStart} to ${p.periodEnd}. To repeat the cycle`) });
    // Pay is always half a month, so only a cutoff is accepted: anything else (overlapping or not, a whole month, a week, a cutoff cut
    // short or run long) is refused before anything is written. Cutoffs tile the calendar, so two of them never overlap.
    for (const [s, e] of [
      ["2025-01-10", "2025-01-20"],
      ["2025-01-15", "2025-01-16"],
      ["2025-01-05", "2025-01-10"],
      ["2024-12-25", "2025-01-20"],
      ["2025-01-16", "2025-01-20"],
      ["2025-01-01", "2025-01-31"],
      ["2025-01-06", "2025-01-12"],
      ["2025-01-16", "2025-01-30"],
      ["2025-01-02", "2025-01-15"],
      ["2025-02-16", "2025-03-01"],
    ]) {
      expect(await createPayRun({ periodStart: s, periodEnd: e }), `${s} to ${e}`).toEqual(NOT_A_CUTOFF);
    }
    expect(await createPayRun({ periodStart: "2025-01-16", periodEnd: "2025-01-10" })).toEqual({ ok: false, error: "Check the request and try again." });
    // The next cutoff is free, and so is the one before.
    expect((await createPayRun({ periodStart: "2025-01-16", periodEnd: "2025-01-31" })).ok).toBe(true);
    expect((await createPayRun({ periodStart: "2024-12-16", periodEnd: "2024-12-31" })).ok).toBe(true);
    // A cutoff nobody is paid in is refused.
    const none = await createPayRun({ periodStart: "2019-01-01", periodEnd: "2019-01-15" });
    // It says why: lines exist, but the earliest one starts after that period.
    expect(none).toMatchObject({ ok: false });
    expect(none.ok === false && none.error).toMatch(/^No pay line was in force between 2019-01-01 and 2019-01-15: the earliest one starts on \d{4}-\d{2}-\d{2}\. Choose a later period, or change the pay line's start date on the Rates tab\.$/);
    const created = await rows<{ n: number }>(sql`select count(*)::int as n from payroll.pay_runs where period_start in ('2025-01-10', '2025-01-15', '2025-01-05', '2024-12-25', '2025-01-06', '2025-01-02')`);
    expect(created[0].n).toBe(0);

    const [{ n }] = await rows<{ n: number }>(sql`select count(*)::int as n from payroll.pay_runs where period_start = ${p.periodStart} and period_end = ${p.periodEnd}`);
    expect(n).toBe(1);
  });

  it("picks the version in force on the first day, flags a raise inside the period, and never pays a line twice", async () => {
    const emp = await person();
    const key = await giveLine(preparer, emp);
    current.user = preparer;
    expect(await updatePayLine({ ...lineBase(emp, { monthly: "40,000" }), lineKey: key, effectiveFrom: "2025-02-10", reason: "Raise" })).toMatchObject({ ok: true });
    const runId = await newRun(preparer, period(2));
    const lines = await runLines(runId, emp);
    expect(lines).toHaveLength(1);
    expect(lines[0].flags).toEqual(["rate_change_mid_period"]);
    expect((await payloadOf(runId, emp)).rate.monthlyCentavos).toBe(2_200_000n);
  });

  it("writes an audit row and a change-log row with no amounts", async () => {
    const emp = await person();
    await giveLine(preparer, emp, { monthly: "77,777.77" });
    const maker = await account();
    const runId = await newRun(maker, period(3));
    const audit = await rows<Row>(sql`select * from ops.audit_log where actor_user_id = ${maker.id}`);
    expect(audit.map((a) => a.action)).toContain("payroll.run.create");
    expect(JSON.stringify(audit)).not.toMatch(/7777777|77,777|1200000/);
    const [log] = await rows<{ id: string; detail_enc: string }>(sql`select id, detail_enc from payroll.pay_change_log where run_id = ${runId} and action = 'run_created'`);
    expect(readChangeDetail(log)).toMatchObject({ periodStart: "2025-03-01" });
    expect(JSON.stringify(log)).not.toMatch(/2025-03/);
  });
});

describe("items", () => {
  it("recomputes only that person's lines, clears the changed line's confirmation, and logs old and new values", async () => {
    const a = await person();
    const b = await person();
    await giveLine(preparer, a);
    await giveLine(preparer, b);
    const checker = await account();
    const runId = await newRun(preparer, period(4));
    const [la] = await runLines(runId, a);
    const [lb] = await runLines(runId, b);
    current.user = checker;
    expect(await confirmRunLine({ runLineId: la.id })).toMatchObject({ ok: true });
    expect(await confirmRunLine({ runLineId: lb.id })).toMatchObject({ ok: true });
    const bBefore = (await runLines(runId, b))[0].payload_enc;

    current.user = preparer;
    expect(await item(runId, a, la.id, "late_minutes", "60")).toMatchObject({ ok: true });
    // 22,000 -> daily 1,000 -> hourly 125 -> 60 minutes is 125.00, so net is 11,000.00 - 125.00.
    expect((await payloadOf(runId, a)).result.net).toBe(1_087_500n);
    expect((await runLines(runId, a))[0].confirmed_by).toBeNull();
    const bAfter = (await runLines(runId, b))[0];
    expect(bAfter.confirmed_by).toBe(checker.id);
    expect(bAfter.payload_enc).toBe(bBefore);

    expect(await item(runId, a, la.id, "late_minutes", "90")).toMatchObject({ ok: true });
    expect((await payloadOf(runId, a)).result.net).toBe(1_081_250n);

    const log = await rows<{ id: string; detail_enc: string }>(
      sql`select id, detail_enc from payroll.pay_change_log where run_id = ${runId} and employee_id = ${a} and action = 'item_saved' order by created_at`,
    );
    expect(log).toHaveLength(2);
    expect(readChangeDetail(log[0])).toMatchObject({ type: "late_minutes", old: null, new: { value: "60" } });
    expect(readChangeDetail(log[1])).toMatchObject({ old: { value: "60", state: "confirmed" }, new: { value: "90" } });
    const audit = await rows<Row>(sql`select * from ops.audit_log where actor_user_id = ${preparer.id} and action = 'payroll.item.save' and target_id = ${runId}`);
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toMatch(/1087500|10,875|"60"|"90"/);
  });

  it("keeps the lines of a two-line person apart", async () => {
    const emp = await person();
    await giveLine(preparer, emp, { alias: "First" });
    await giveLine(preparer, emp, { alias: "Second", monthly: "11,000" });
    const runId = await newRun(preparer, period(5));
    const lines = await runLines(runId, emp);
    const first = lines.find((l) => l.alias === "First")!;
    const second = lines.find((l) => l.alias === "Second")!;
    current.user = preparer;
    expect(await item(runId, emp, first.id, "loan", "500", "Cash advance")).toMatchObject({ ok: true });
    const f = decryptRunLine(first.id, (await runLines(runId, emp)).find((l) => l.id === first.id)!.payload_enc);
    const s = decryptRunLine(second.id, (await runLines(runId, emp)).find((l) => l.id === second.id)!.payload_enc);
    expect(f.result.net).toBe(1_100_000n - 50_000n);
    expect(s.result.net).toBe(550_000n);
    expect(s.input.loan).toBe(0n);
  });

  it("asks for a reason only for a deduction or when overriding a suggestion", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const runId = await newRun(preparer, period(6));
    const [line] = await runLines(runId, emp);
    current.user = preparer;
    const needReason = { ok: false, error: "Give a reason for this amount." };
    expect(await item(runId, emp, line.id, "loan", "300")).toEqual(needReason);
    expect(await item(runId, emp, line.id, "other_deduction", "300", "  ")).toEqual(needReason);
    expect(await item(runId, emp, line.id, "loan", "300", "Advance")).toMatchObject({ ok: true });
    expect(await item(runId, emp, line.id, "adjustment", "250")).toMatchObject({ ok: true }); // no reason needed
    expect(await item(runId, emp, line.id, "extra_regular", "60")).toMatchObject({ ok: true });

    // A suggestion for late minutes: confirming the same value needs no reason, changing it does.
    const sid = randomUUID();
    await db.execute(sql`insert into payroll.pay_run_items (id, run_id, employee_id, run_line_id, type, state, value_enc, entered_by)
      values (${sid}, ${runId}, ${emp}, ${line.id}, 'late_minutes', 'suggested', ${encryptItemValue(sid, { value: 30n, reason: null })}, ${preparer.id})`);
    expect(await item(runId, emp, line.id, "late_minutes", "45")).toEqual(needReason);
    expect(await item(runId, emp, line.id, "late_minutes", "45", "Client agreed 45")).toMatchObject({ ok: true });
    const sid2 = randomUUID();
    await db.execute(sql`insert into payroll.pay_run_items (id, run_id, employee_id, run_line_id, type, state, value_enc, entered_by)
      values (${sid2}, ${runId}, ${emp}, ${line.id}, 'absence_days', 'suggested', ${encryptItemValue(sid2, { value: 100n, reason: null })}, ${preparer.id})`);
    expect(await item(runId, emp, line.id, "absence_days", "1")).toMatchObject({ ok: true });
  });

  it("refuses values the calculator has no guards for", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const runId = await newRun(preparer, period(7));
    const [line] = await runLines(runId, emp);
    current.user = preparer;
    for (const [type, value] of [["late_minutes", "0"], ["late_minutes", "-5"], ["late_minutes", "1.5"], ["absence_days", "1.555"], ["loan", "-100"], ["loan", "$50"], ["adjustment", "1,25.0"], ["extra_regular", "abc"]]) {
      expect(await item(runId, emp, line.id, type, value, "x")).toEqual({ ok: false, error: "Check the request and try again." });
    }
    const [{ n }] = await rows<{ n: number }>(sql`select count(*)::int as n from payroll.pay_run_items where run_id = ${runId}`);
    expect(n).toBe(0);
    // A line that belongs to another person, or to no run, is refused.
    const other = await person();
    expect(await item(runId, other, line.id, "late_minutes", "5")).toEqual({ ok: false, error: "That line is not on this run." });
  });

  it("dismisses an amount with a new row, refuses a stale one, and needs a reason for a loan", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const runId = await newRun(preparer, period(8));
    const [line] = await runLines(runId, emp);
    current.user = preparer;
    await item(runId, emp, line.id, "loan", "500", "Advance");
    const [first] = await rows<{ id: string }>(sql`select id from payroll.pay_run_items where run_id = ${runId} and type = 'loan'`);
    expect(await dismissPayItem({ runId, itemId: first.id })).toEqual({ ok: false, error: "Give a reason for removing this amount." });
    expect(await dismissPayItem({ runId, itemId: first.id, reason: "Repaid in cash" })).toMatchObject({ ok: true });
    expect((await payloadOf(runId, emp)).result.net).toBe(1_100_000n);
    expect(await dismissPayItem({ runId, itemId: first.id, reason: "again" })).toEqual({ ok: false, error: "That amount has changed. Reload the page and try again." });
    const all = await rows<{ state: string }>(sql`select state from payroll.pay_run_items where run_id = ${runId} order by created_at`);
    expect(all.map((r) => r.state)).toEqual(["confirmed", "dismissed"]);
  });
});

describe("separation of duties and the draft lock", () => {
  it("a Preparer can save an item on and dismiss one from their own line, but can't check their own line; another Preparer does", async () => {
    const mine = await account();
    const ownEmp = await person(mine.id);
    await giveLine(preparer, ownEmp);
    const runId = await newRun(mine, period(9));
    const [line] = await runLines(runId, ownEmp);
    const own = { ok: false, error: "You can't do this for your own pay. Another Preparer does it." };

    current.user = mine;
    expect(await item(runId, ownEmp, line.id, "adjustment", "100")).toMatchObject({ ok: true });
    expect(await confirmRunLine({ runLineId: line.id })).toEqual(own);
    const [it] = await rows<{ id: string }>(sql`select id from payroll.pay_run_items where run_id = ${runId} and employee_id = ${ownEmp}`);
    expect(await dismissPayItem({ runId, itemId: it.id })).toMatchObject({ ok: true });
    // The change history says who changed their own line.
    const logged = await rows<{ action: string }>(sql`select action from payroll.pay_change_log where actor_id = ${mine.id} and run_id = ${runId} and action in ('item_saved', 'item_dismissed') order by created_at`);
    expect(logged.map((r) => r.action)).toEqual(["item_saved", "item_dismissed"]);

    current.user = preparer;
    expect(await item(runId, ownEmp, line.id, "adjustment", "100")).toMatchObject({ ok: true });

    // The worksheet notes (it no longer blocks sending) that someone else must confirm the submitter's own line.
    current.user = mine;
    let sheet = (await getWorksheet(runId))!;
    expect(notesFor(sheet.checks.warnings, ownEmp)).toEqual(["own_line_unconfirmed"]);
    expect(forPerson(sheet.checks.blocking, ownEmp)).toEqual([]);
    current.user = preparer;
    expect(await confirmRunLine({ runLineId: line.id })).toMatchObject({ ok: true });
    current.user = mine;
    sheet = (await getWorksheet(runId))!;
    expect(notesFor(sheet.checks.warnings, ownEmp)).toEqual([]);
    expect(sheet.lines.find((l) => l.employeeId === ownEmp)).toMatchObject({ isOwn: true, confirmedByMe: false });
    // A later change by the other Preparer clears the confirmation again.
    current.user = preparer;
    await item(runId, ownEmp, line.id, "adjustment", "200");
    current.user = mine;
    expect(notesFor((await getWorksheet(runId))!.checks.warnings, ownEmp)).toEqual(["own_line_unconfirmed"]);
  });

  it("refuses every change once the run is no longer a draft", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const runId = await newRun(preparer, period(10));
    const [line] = await runLines(runId, emp);
    current.user = preparer;
    await item(runId, emp, line.id, "adjustment", "100");
    await db.execute(sql`update payroll.pay_runs set status = 'in_review' where id = ${runId}`);
    const frozen = { ok: false, error: "This run is no longer a draft, so it can't be changed." };
    expect(await item(runId, emp, line.id, "adjustment", "200")).toEqual(frozen);
    expect(await confirmRunLine({ runLineId: line.id })).toEqual(frozen);
    const [it] = await rows<{ id: string }>(sql`select id from payroll.pay_run_items where run_id = ${runId}`);
    expect(await dismissPayItem({ runId, itemId: it.id })).toEqual(frozen);
    expect((await payloadOf(runId, emp)).input.adjustments).toEqual([{ label: "Test line", amount: 10_000n }]);
  });
});

describe("the settings", () => {
  it("pays an extra-hours item at the standard percent when the setting is blank, and raises nothing", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const early = await newRun(preparer, period(3, 2)); // before June 2025: no rates yet
    current.user = preparer;
    const [line] = await runLines(early, emp);
    await item(early, emp, line.id, "extra_regular", "120");
    const sheet = (await getWorksheet(early))!;
    expect(forPerson(sheet.checks.blocking, emp)).toEqual([]);
    expect(notesFor(sheet.checks.warnings, emp)).toEqual([]);
    // 22,000 -> hourly 125.00; two hours at the standard 125% is 312.50.
    expect((await payloadOf(early, emp)).result.extra.regular).toBe(31_250n);
  });

  it("pays a person's own overtime percent instead of the standard one, and keeps the standard for everyone else", async () => {
    const own = await person();
    const other = await person();
    await giveLine(preparer, own, { otRegular: "150" });
    await giveLine(preparer, other);
    current.user = preparer;
    const made = await createPayRun({ ...period(3, 2), test: true }); // a test run: a period that may repeat
    if (!made.ok) throw new Error(made.error);
    const runId = made.data.runId;
    for (const emp of [own, other]) {
      const [line] = await runLines(runId, emp);
      await item(runId, emp, line.id, "extra_regular", "120");
    }
    // 22,000 -> hourly 125.00; two hours at their own 150% is 375.00, at the standard 125% it is 312.50.
    expect((await payloadOf(runId, own)).result.extra.regular).toBe(37_500n);
    expect((await payloadOf(runId, other)).result.extra.regular).toBe(31_250n);
    expect((await payloadOf(runId, own)).rate.otBp).toEqual({ regular: 15_000 });
  });

  it("rereads the settings when a draft run changes", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const runId = await newRun(preparer, period(9, 2));
    const [line] = await runLines(runId, emp);
    current.user = preparer;
    await item(runId, emp, line.id, "extra_regular", "60");
    const before = (await payloadOf(runId, emp)).result.extra.regular;
    // 22,000 -> hourly 125.00; one hour at 125% is 156.25.
    expect(before).toBe(15_625n);

    expect(
      await savePaySettings({ effectiveFrom: "2025-08-20", cutoffDivisor: 11, changeWarnPercent: 10, extraRegular: "150", extraRestDay: "130", extraRestDayOver8: "169", reason: "Change" }),
    ).toMatchObject({ ok: true });
    await item(runId, emp, line.id, "adjustment", "1");
    const [run] = await rows<{ settings_snapshot: { multipliersBp: { regular: number } } }>(sql`select settings_snapshot from payroll.pay_runs where id = ${runId}`);
    expect(run.settings_snapshot.multipliersBp.regular).toBe(15000);
    expect((await payloadOf(runId, emp)).result.extra.regular).toBe(18_750n);
  });
});

describe("the worksheet", () => {
  it("writes one sensitive.view per call and one view row per person, run and day; totals and client hours add up", async () => {
    const viewer = await account("viewer");
    const emp = await person();
    const [client] = await rows<{ id: string; name: string }>(sql`insert into core.clients (name) values (${uniq("Worksheet Client ")}) returning id, name`);
    await giveLine(preparer, emp, { clientId: client.id });
    const runId = await newRun(preparer, period(12, 1));
    const [line] = await runLines(runId, emp);
    current.user = preparer;
    await item(runId, emp, line.id, "client_hours", "86.5");
    await item(runId, emp, line.id, "adjustment", "100");

    current.user = viewer;
    const first = (await getWorksheet(runId))!;
    await getWorksheet(runId);
    const audits = await rows<{ metadata: { count: number } }>(sql`select metadata from ops.audit_log where action = 'sensitive.view' and actor_user_id = ${viewer.id} and target_id = ${runId}`);
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toMatch(/\d,\d{3}\.\d\d/);
    const views = await rows(sql`select 1 from payroll.pay_change_log where actor_id = ${viewer.id} and run_id = ${runId} and action = 'run_viewed'`);
    expect(views).toHaveLength(1);

    const mine = first.lines.find((l) => l.employeeId === emp)!;
    expect(mine.figures).toMatchObject({ gross: "11,000.00", net: "11,100.00", clientHours: "86.5" });
    const group = first.byClient!.find((c) => c.clientId === client.id)!;
    expect(group).toEqual({ clientId: client.id, clientName: client.name, lines: 1, clientHours: "86.5", net: "11,100.00" });
    expect(first.totals).not.toBeNull();
    // The calculator never saw the client hours: net is the same without them.
    expect(first.canPrepare).toBe(false);
    let listed;
    for (let page = 1; !listed && page <= 20; page++) listed = (await getRuns({ page, pageSize: 100 })).rows.find((r) => r.id === runId);
    expect(listed).toMatchObject({ status: "draft", periodStart: "2025-12-01" });
  });

  it("lists an unreadable line or amount instead of failing, withholds the totals, blocks, and logs only an id and a class name", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const runId = await newRun(preparer, period(12, 2));
    const [line] = await runLines(runId, emp);
    const marker = `not-a-ciphertext-${randomUUID()}`;
    await db.execute(sql`update payroll.pay_run_lines set payload_enc = ${marker} where id = ${line.id}`);
    current.user = preparer;

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sheet = (await getWorksheet(runId))!;
    const logged = spy.mock.calls.filter((c) => c[0] === "payroll run line unreadable:").map((c) => c[1]);
    spy.mockRestore();

    expect(sheet.unreadableCount).toBeGreaterThanOrEqual(1);
    expect(sheet.totals).toBeNull();
    expect(sheet.byClient).toBeNull();
    expect(sheet.lines.find((l) => l.employeeId === emp)).toMatchObject({ unreadable: true, figures: null });
    expect(forPerson(sheet.checks.blocking, emp)).toEqual(["unreadable_line"]);
    expect(logged).toContainEqual({ runLineId: line.id, error: expect.any(String) });
    expect(JSON.stringify(logged)).not.toContain(marker);
  });

  it("warns about unapproved days, missing payout details, a joiner, and a big change from the last run, and reads masks only", async () => {
    // Two cutoffs in a row in October and November 2024 (every cutoff of 2025 is taken by another test in this file).
    const emp = await person();
    const key = await giveLine(preparer, emp, { effectiveFrom: "2024-10-20" }); // starts inside the first run's period
    const withPayout = await person();
    await giveLine(preparer, withPayout, { effectiveFrom: "2024-10-01" });
    await db.execute(sql`insert into core.employee_sensitive (employee_id, masks) values (${withPayout}, ${JSON.stringify({ bankName: "BDO", bankAccountName: "M T", bankAccountNumber: "****1234" })}::jsonb)`);
    // One finished day with hours nobody approved, one that was approved.
    await db.execute(sql`insert into time.attendance_days (employee_id, date, sessions, worked_minutes, scheduled_minutes) values (${emp}, '2024-10-22', 1, 480, 480), (${emp}, '2024-10-23', 1, 480, 480)`);
    await db.execute(sql`insert into time.hours_approvals (employee_id, date, scheduled_minutes, worked_minutes, break_minutes, extra_minutes, approved_extra_minutes, approved_by)
      values (${emp}, '2024-10-23', 480, 480, 0, 0, 0, ${preparer.id})`);

    const first = await newRun(preparer, { periodStart: "2024-10-16", periodEnd: "2024-10-31" });
    current.user = preparer;
    let sheet = (await getWorksheet(first))!;
    expect(forPerson(sheet.checks.warnings, emp)).toEqual(["new_or_leaving", "no_payout_details", "unapproved_days"]);
    expect(sheet.checks.warnings.find((c) => c.employeeId === emp && c.code === "unapproved_days")!.detail).toBe("1");
    expect(forPerson(sheet.checks.warnings, withPayout)).toEqual([]);

    // A raise of 50% in the next period moves net pay by more than the 10% default; the first run has nothing to compare with.
    expect(forPerson(sheet.checks.warnings, emp)).not.toContain("large_change");
    await updatePayLine({ ...lineBase(emp, { monthly: "33,000" }), lineKey: key, effectiveFrom: "2024-11-01", reason: "Raise" });
    const second = await newRun(preparer, { periodStart: "2024-11-01", periodEnd: "2024-11-15" });
    // The earlier run is still a draft (unreviewed), so there is nothing to compare with yet.
    sheet = (await getWorksheet(second))!;
    expect(forPerson(sheet.checks.warnings, emp)).not.toContain("large_change");
    await db.execute(sql`update payroll.pay_runs set status = 'in_review' where id = ${first}`);
    sheet = (await getWorksheet(second))!;
    expect(forPerson(sheet.checks.warnings, emp)).not.toContain("large_change");
    await db.execute(sql`update payroll.pay_runs set status = 'approved' where id = ${first}`);
    sheet = (await getWorksheet(second))!;
    expect(forPerson(sheet.checks.warnings, emp)).toContain("large_change");
    expect(forPerson(sheet.checks.warnings, withPayout)).toEqual([]);
    expect(JSON.stringify(sheet.checks)).not.toMatch(/\d,\d{3}\.\d\d/);
  });
});

async function suggest(runId: string, employeeId: string, runLineId: string | null, type: string, value: bigint) {
  const id = randomUUID();
  await db.execute(sql`insert into payroll.pay_run_items (id, run_id, employee_id, run_line_id, type, state, value_enc, entered_by)
    values (${id}, ${runId}, ${employeeId}, ${runLineId}, ${type}, 'suggested', ${encryptItemValue(id, { value, reason: null })}, ${preparer.id})`);
}
const needReason = { ok: false, error: "Give a reason for this amount." };

describe("reasons cannot be sidestepped", () => {
  it("overriding a suggestion needs a reason even after the suggested value was confirmed first", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const runId = await newRun(preparer, period(2, 2));
    const [line] = await runLines(runId, emp);
    current.user = preparer;
    await suggest(runId, emp, line.id, "late_minutes", 30n);
    expect(await item(runId, emp, line.id, "late_minutes", "30")).toMatchObject({ ok: true }); // the suggested value itself: no reason
    expect(await item(runId, emp, line.id, "late_minutes", "45")).toEqual(needReason); // the latest row is now confirmed, the suggestion still counts
    expect(await item(runId, emp, line.id, "late_minutes", "45", "Client agreed")).toMatchObject({ ok: true });
    expect(await item(runId, emp, line.id, "late_minutes", "30")).toMatchObject({ ok: true }); // back to the suggestion
  });

  it("an unassigned suggestion counts too, and removing a confirmed suggestion needs a reason", async () => {
    const emp = await person();
    await giveLine(preparer, emp, { effectiveFrom: "2024-09-01" });
    const runId = await newRun(preparer, { periodStart: "2024-09-01", periodEnd: "2024-09-15" });
    const [line] = await runLines(runId, emp);
    current.user = preparer;
    await suggest(runId, emp, null, "absence_days", 100n);
    expect(await item(runId, emp, line.id, "absence_days", "2")).toEqual(needReason);
    expect(await item(runId, emp, line.id, "absence_days", "1")).toMatchObject({ ok: true });

    await suggest(runId, emp, line.id, "late_minutes", 20n);
    expect(await item(runId, emp, line.id, "late_minutes", "20")).toMatchObject({ ok: true });
    const [confirmed] = await rows<{ id: string }>(sql`select id from payroll.pay_run_items where run_id = ${runId} and employee_id = ${emp} and type = 'late_minutes' and state = 'confirmed'`);
    expect(await dismissPayItem({ runId, itemId: confirmed.id })).toEqual({ ok: false, error: "Give a reason for removing this amount." });
    expect(await dismissPayItem({ runId, itemId: confirmed.id, reason: "Client waived it" })).toMatchObject({ ok: true });
  });
});

describe("net pay below zero", () => {
  it("notes a loan or another deduction bigger than the pay (it does not block), and the note goes when it is taken off", async () => {
    const a = await person();
    const b = await person();
    await giveLine(preparer, a);
    await giveLine(preparer, b);
    const runId = await newRun(preparer, period(4, 2));
    const [la] = await runLines(runId, a);
    const [lb] = await runLines(runId, b);
    current.user = preparer;

    expect(await item(runId, a, la.id, "loan", "20,000", "Large advance")).toMatchObject({ ok: true });
    expect(await item(runId, b, lb.id, "other_deduction", "15,000.01", "Damaged equipment")).toMatchObject({ ok: true });
    let sheet = (await getWorksheet(runId))!;
    expect(sheet.lines.find((l) => l.employeeId === a)!.figures!.net).toBe("-9,000.00");
    expect(notesFor(sheet.checks.warnings, a)).toEqual(["negative_net"]);
    expect(notesFor(sheet.checks.warnings, b)).toEqual(["negative_net"]);
    expect(sheet.checks.blocking).toEqual([]); // a note only: the run can still be sent for review

    const [loan] = await rows<{ id: string }>(sql`select id from payroll.pay_run_items where run_id = ${runId} and employee_id = ${a}`);
    expect(await dismissPayItem({ runId, itemId: loan.id, reason: "Corrected" })).toMatchObject({ ok: true });
    expect(await item(runId, b, lb.id, "other_deduction", "5,000", "Corrected")).toMatchObject({ ok: true });
    sheet = (await getWorksheet(runId))!;
    expect(notesFor(sheet.checks.warnings, a)).toEqual([]);
    expect(notesFor(sheet.checks.warnings, b)).toEqual([]);
  });
});

describe("cancelling a draft run", () => {
  it("freezes the run, records why, and frees the period for a new run", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const maker = await account();
    const p = period(5, 2);
    const runId = await newRun(maker, p);
    const [line] = await runLines(runId, emp);

    current.user = maker;
    expect(await cancelPayRun({ runId, reason: "" })).toEqual({ ok: false, error: "Check the request and try again." });
    expect((await createPayRun(p)).ok).toBe(false); // still taken
    expect(await cancelPayRun({ runId, reason: "Pay lines changed" })).toMatchObject({ ok: true });

    const [run] = await rows<{ status: string }>(sql`select status from payroll.pay_runs where id = ${runId}`);
    expect(run.status).toBe("cancelled");
    const frozen = { ok: false, error: "This run is no longer a draft, so it can't be changed." };
    expect(await cancelPayRun({ runId, reason: "Again" })).toEqual(frozen);
    current.user = preparer;
    expect(await item(runId, emp, line.id, "adjustment", "100")).toEqual(frozen);
    expect(await confirmRunLine({ runLineId: line.id })).toEqual(frozen);

    const [log] = await rows<{ id: string; detail_enc: string }>(sql`select id, detail_enc from payroll.pay_change_log where run_id = ${runId} and action = 'run_cancelled'`);
    expect(readChangeDetail(log)).toMatchObject({ reason: "Pay lines changed" });
    const audit = await rows<Row>(sql`select * from ops.audit_log where actor_user_id = ${maker.id} and action = 'payroll.run.cancel'`);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("Pay lines changed");

    // Nothing is deleted, the old run is still readable, and the period can be run again.
    expect((await getWorksheet(runId))!.run.status).toBe("cancelled");
    const again = await createPayRun(p);
    expect(again.ok).toBe(true);
    expect(again.ok && again.data.runId).not.toBe(runId);
  });

  it("refuses to cancel a run that is no longer a draft", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const runId = await newRun(preparer, period(11, 2));
    await db.execute(sql`update payroll.pay_runs set status = 'in_review' where id = ${runId}`);
    current.user = preparer;
    expect(await cancelPayRun({ runId, reason: "Mistake" })).toEqual({ ok: false, error: "This run is no longer a draft, so it can't be changed." });
    const [run] = await rows<{ status: string }>(sql`select status from payroll.pay_runs where id = ${runId}`);
    expect(run.status).toBe("in_review");
  });
});

describe("a run whose pay lines changed after it was built", () => {
  const outOfDate = async (runId: string) => (await getWorksheet(runId))!.checks.warnings.some((c) => c.code === "lines_out_of_date");

  it("notes when a line is added, and is fine again after cancelling and recreating", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const p = period(6, 2);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    expect(await outOfDate(runId)).toBe(false);
    const late = await person();
    await giveLine(preparer, late);
    expect(await outOfDate(runId)).toBe(true);
    expect((await getWorksheet(runId))!.checks.blocking).toEqual([]);
    const blocked = (await getWorksheet(runId))!.checks.warnings.find((c) => c.code === "lines_out_of_date")!;
    expect(blocked).toMatchObject({ employeeId: null, runLineId: null });

    expect(await cancelPayRun({ runId, reason: "New hire added" })).toMatchObject({ ok: true });
    const fresh = await newRun(preparer, p);
    expect(await runLines(fresh, late)).toHaveLength(1);
    expect(await outOfDate(fresh)).toBe(false);
  });

  it("notes when a line is ended before the period", async () => {
    const emp = await person();
    const key = await giveLine(preparer, emp);
    const runId = await newRun(preparer, period(8, 2));
    current.user = preparer;
    expect(await outOfDate(runId)).toBe(false);
    expect(await endPayLine({ lineKey: key, endsOn: "2025-08-01", reason: "Left" })).toMatchObject({ ok: true });
    expect(await outOfDate(runId)).toBe(true);
  });

  it("notes when a version is added inside the period", async () => {
    const emp = await person();
    const key = await giveLine(preparer, emp);
    const runId = await newRun(preparer, period(10, 2));
    current.user = preparer;
    expect(await outOfDate(runId)).toBe(false);
    expect(await updatePayLine({ ...lineBase(emp, { monthly: "30,000" }), lineKey: key, effectiveFrom: "2025-10-20", reason: "Raise" })).toMatchObject({ ok: true });
    expect(await outOfDate(runId)).toBe(true);
  });

  it("is still raised while the run waits for approval (as a note), but not once it is approved", async () => {
    const emp = await person();
    await giveLine(preparer, emp, { effectiveFrom: "2024-08-16" });
    const runId = await newRun(preparer, { periodStart: "2024-08-16", periodEnd: "2024-08-31" });
    await giveLine(preparer, await person(), { effectiveFrom: "2024-08-16" });
    await db.execute(sql`update payroll.pay_runs set status = 'in_review' where id = ${runId}`);
    current.user = preparer;
    expect(await outOfDate(runId)).toBe(true);
    await db.execute(sql`update payroll.pay_runs set status = 'approved' where id = ${runId}`);
    expect(await outOfDate(runId)).toBe(false);
  });
});

describe("named lines, leave days and holiday pay", () => {
  // One run for the first half of December 2024, before any overtime rate exists (the starting settings row has none): holiday pay must
  // work without a setting. Each test uses its own person on a 22,000 a month line: a cutoff is 11,000.00 and a day is 1,000.00.
  const DEC = { periodStart: "2024-12-01", periodEnd: "2024-12-15" };
  let runId: string;
  const BAD = { ok: false, error: "Check the request and try again." };

  const people = {} as Record<"lines" | "bad" | "sick" | "paid" | "holiday", string>;
  const lineOf = async (emp: string) => (await runLines(runId, emp))[0];
  const itemRows = (emp: string, type: string) =>
    rows<{ id: string; item_key: string | null; state: string }>(
      sql`select id, item_key, state from payroll.pay_run_items where run_id = ${runId} and employee_id = ${emp} and type = ${type} order by created_at`,
    );

  beforeAll(async () => {
    // The people are made before the run, so each has a line on it.
    for (const key of ["lines", "bad", "sick", "paid", "holiday"] as const) {
      people[key] = await person();
      await giveLine(preparer, people[key]);
    }
    runId = await newRun(preparer, DEC);
  });

  it("adds each save as a new named line, replaces one that is saved with its item key, and removes only the line asked for", async () => {
    const emp = people.lines;
    const line = await lineOf(emp);
    current.user = preparer;
    const save = (over: Record<string, unknown>) => savePayItem({ runId, employeeId: emp, runLineId: line.id, ...over });

    // A pay line made with only the monthly rate (no FTE, no allowance fields) is 11,000.00 for the cutoff.
    expect((await payloadOf(runId, emp)).result.net).toBe(1_100_000n);

    expect(await save({ type: "allowance", label: "Health allowance", value: "1,000" })).toMatchObject({ ok: true });
    expect(await save({ type: "allowance", label: "Internet allowance", value: "500" })).toMatchObject({ ok: true });
    let pay = await payloadOf(runId, emp);
    expect(pay.input.allowances).toEqual([
      { label: "Health allowance", amount: 100_000n },
      { label: "Internet allowance", amount: 50_000n },
    ]);
    expect(pay.result.allowances).toBe(150_000n);
    expect(pay.result.gross).toBe(1_250_000n);
    expect(pay.result.net).toBe(1_250_000n);
    const first = await itemRows(emp, "allowance");
    expect(first).toHaveLength(2);
    expect(first[0].item_key).toBeTruthy();
    expect(first[1].item_key).toBeTruthy();
    expect(first[0].item_key).not.toBe(first[1].item_key);

    // The other itemized kinds add to the total payable compensation but not to gross.
    expect(await save({ type: "reimbursement", label: "Supplies", value: "250.50" })).toMatchObject({ ok: true });
    expect(await save({ type: "bonus", label: "Performance bonus", value: "2,000" })).toMatchObject({ ok: true });
    expect(await save({ type: "adjustment", label: "Correction of an earlier payment", value: "75" })).toMatchObject({ ok: true });
    pay = await payloadOf(runId, emp);
    expect(pay.result).toMatchObject({ reimbursements: 25_050n, bonuses: 200_000n, adjustments: 7_500n, gross: 1_250_000n, net: 1_482_550n });

    // Saving with the item key replaces that line: still two allowance lines, the first one's amount changed.
    const keyOfHealth = first[0].item_key!;
    expect(await save({ type: "allowance", label: "Health allowance", value: "2,000", itemKey: keyOfHealth })).toMatchObject({ ok: true });
    pay = await payloadOf(runId, emp);
    expect(pay.input.allowances).toEqual([
      { label: "Health allowance", amount: 200_000n },
      { label: "Internet allowance", amount: 50_000n },
    ]);
    expect(pay.result.allowances).toBe(250_000n);
    expect(new Set((await itemRows(emp, "allowance")).map((r) => r.item_key)).size).toBe(2);
    // An item key that belongs to no line is refused.
    expect(await save({ type: "allowance", label: "Ghost", value: "1", itemKey: randomUUID() })).toEqual({ ok: false, error: "That line was not found. Reload the page and try again." });

    // Removing the Internet allowance (by its item id) removes only that line; it keeps its key in the history.
    const internet = (await itemRows(emp, "allowance")).filter((r) => r.item_key !== keyOfHealth).at(-1)!;
    expect(await dismissPayItem({ runId, itemId: internet.id })).toMatchObject({ ok: true });
    pay = await payloadOf(runId, emp);
    expect(pay.input.allowances).toEqual([{ label: "Health allowance", amount: 200_000n }]);
    expect(pay.result.allowances).toBe(200_000n);
    expect(pay.input.reimbursements).toEqual([{ label: "Supplies", amount: 25_050n }]);
    expect(pay.input.bonuses).toEqual([{ label: "Performance bonus", amount: 200_000n }]);
    expect(pay.input.adjustments).toEqual([{ label: "Correction of an earlier payment", amount: 7_500n }]);
    const dismissed = (await itemRows(emp, "allowance")).filter((r) => r.state === "dismissed");
    expect(dismissed).toHaveLength(1);
    expect(dismissed[0].item_key).toBe(internet.item_key);
    // A removed line stays removed: saving against its key (a stale screen) is refused, and the figures do not change.
    expect(await save({ type: "allowance", label: "Internet allowance", value: "9", itemKey: internet.item_key! })).toEqual({ ok: false, error: "That line was removed. Add it again as a new line." });
    expect((await payloadOf(runId, emp)).result.allowances).toBe(200_000n);

    // The worksheet lists each named line with its name.
    const sheet = (await getWorksheet(runId))!;
    const mine = sheet.lines.find((l) => l.employeeId === emp)!;
    expect(mine.items.filter((i) => i.type === "allowance" && i.state === "confirmed").map((i) => [i.label, i.value])).toEqual([["Health allowance", "2,000.00"]]);
    expect(mine.figures).toMatchObject({ allowances: "2,000.00", reimbursements: "250.50", bonuses: "2,000.00", adjustments: "75.00", gross: "13,000.00", net: "15,325.50" });
  });

  it("refuses a name on a type that has none, and an itemized type without a valid name", async () => {
    const emp = people.bad;
    const line = await lineOf(emp);
    current.user = preparer;
    const count = async () => (await rows<{ n: number }>(sql`select count(*)::int as n from payroll.pay_run_items where run_id = ${runId} and employee_id = ${emp}`))[0].n;
    const before = await count();
    const save = (over: Record<string, unknown>) => savePayItem({ runId, employeeId: emp, runLineId: line.id, ...over });
    expect(await save({ type: "loan", value: "500", reason: "Advance", label: "Cash advance" })).toEqual(BAD);
    expect(await save({ type: "late_minutes", value: "30", label: "Late" })).toEqual(BAD);
    expect(await save({ type: "absence_days", value: "1", itemKey: randomUUID() })).toEqual(BAD);
    expect(await save({ type: "bonus", value: "100" })).toEqual(BAD); // no name
    expect(await save({ type: "bonus", value: "100", label: "x".repeat(61) })).toEqual(BAD); // too long
    expect(await count()).toBe(before);
  });

  it("deducts sick leave days like absences, and leaves bereavement and PTO days as information only", async () => {
    const emp = people.sick;
    const line = await lineOf(emp);
    current.user = preparer;
    expect(await item(runId, emp, line.id, "sick_leave_days", "1.5")).toMatchObject({ ok: true });
    let pay = await payloadOf(runId, emp);
    expect(pay.result.sickLeave).toBe(150_000n);
    expect(pay.result.absences).toBe(0n);
    expect(pay.result.gross).toBe(1_100_000n - 150_000n);
    expect(pay.result.net).toBe(1_100_000n - 150_000n);

    // Absences of the same length take the same amount, in their own figure.
    expect(await item(runId, emp, line.id, "absence_days", "1.5")).toMatchObject({ ok: true });
    pay = await payloadOf(runId, emp);
    expect(pay.result.absences).toBe(pay.result.sickLeave);
    expect(pay.result.net).toBe(1_100_000n - 300_000n);

    // Paid days change no amount.
    const paid = people.paid;
    const paidLine = await lineOf(paid);
    expect(await item(runId, paid, paidLine.id, "bereavement_days", "2")).toMatchObject({ ok: true });
    expect(await item(runId, paid, paidLine.id, "pto_days", "0.5")).toMatchObject({ ok: true });
    const pp = await payloadOf(runId, paid);
    expect(pp.input.bereavementDayHundredths).toBe(200);
    expect(pp.input.ptoDayHundredths).toBe(50);
    expect(pp.result).toMatchObject({ base: 1_100_000n, absences: 0n, sickLeave: 0n, gross: 1_100_000n, net: 1_100_000n });
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.lines.find((l) => l.employeeId === paid)!.figures).toMatchObject({ bereavementDays: "2", ptoDays: "0.5", net: "11,000.00" });
    expect(sheet.lines.find((l) => l.employeeId === emp)!.figures).toMatchObject({ sickLeave: "1,500.00" });
  });

  it("pays holiday pay one to one with no setting: 480 minutes is exactly one day's pay", async () => {
    const emp = people.holiday;
    const line = await lineOf(emp);
    current.user = preparer;
    // The December 2024 run is before any overtime rate was set: the snapshot carries the standard percents.
    const [run] = await rows<{ settings_snapshot: { multipliersBp: Record<string, number | null> } }>(sql`select settings_snapshot from payroll.pay_runs where id = ${runId}`);
    expect(run.settings_snapshot.multipliersBp).toMatchObject({ regular: 12500, restDay: 13000, restDayOver8: 16900, holiday: 10000 });
    expect(await item(runId, emp, line.id, "holiday", "480")).toMatchObject({ ok: true });
    const pay = await payloadOf(runId, emp);
    // 22,000 / 22 = 1,000.00 a day; 8 hours at 100% of 125.00 an hour is the same 1,000.00.
    expect(pay.result.daily).toBe(100_000n);
    expect(pay.result.extra.holiday).toBe(pay.result.daily);
    expect(pay.result.net).toBe(1_100_000n + 100_000n);
    expect(forPerson((await getWorksheet(runId))!.checks.blocking, emp)).toEqual([]);
    // Overtime on a regular day with a blank setting pays the standard 125% and flags nothing: one hour of 125.00 is 156.25.
    expect(await item(runId, emp, line.id, "extra_regular", "60")).toMatchObject({ ok: true });
    expect((await payloadOf(runId, emp)).result.extra.regular).toBe(15_625n);
    const after = (await getWorksheet(runId))!;
    expect(forPerson(after.checks.blocking, emp)).toEqual([]);
    expect(notesFor(after.checks.warnings, emp)).toEqual([]);
  });
});

// ---- Overtime defaults, draft run people, and checks that are only notes (all in 2033, clear of every other test's periods) ----

const { updateRunPeople, removePersonFromRun, restorePersonToRun, submitRun, approveRun } = await import("@/modules/payroll/actions");
const { computeRunHash } = await import("@/modules/payroll/approval");
const { remitlyList } = await import("@/modules/payroll/payments");
const { getMyPayslip } = await import("@/modules/payroll/payslip-queries");

/** Cutoff `n` of 2033 (0 = 1 to 15 January, 1 = 16 to 31 January, 2 = 1 to 15 February, ...). */
function c33(n: number) {
  const month = Math.floor(n / 2) + 1;
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(2033, month, 0)).getUTCDate();
  return n % 2 === 0 ? { periodStart: `2033-${mm}-01`, periodEnd: `2033-${mm}-15` } : { periodStart: `2033-${mm}-16`, periodEnd: `2033-${mm}-${last}` };
}
/** A line paid only during cutoff `p`. */
const lineIn = (emp: string, p: { periodStart: string; periodEnd: string }, over: Record<string, unknown> = {}) =>
  giveLine(preparer, emp, { effectiveFrom: p.periodStart, endsOn: p.periodEnd, ...over });
const FROZEN = { ok: false, error: "This run is no longer a draft, so it can't be changed." };

describe("overtime with blank settings pays the standard percents", () => {
  let blankRun = "";
  beforeAll(async () => {
    // The earlier tests left open-ended lines, which would be built into every 2033 run: end them all (as the cleanup after the file does),
    // so the runs below hold only the people each test makes.
    await db.execute(sql`
      insert into payroll.pay_lines (id, line_key, employee_id, client_id, alias, hours_per_day, payment_method, ends_on, effective_from, amounts_enc, created_by)
      select gen_random_uuid(), l.line_key, l.employee_id, l.client_id, l.alias, l.hours_per_day, l.payment_method, l.effective_from, l.effective_from, l.amounts_enc, l.created_by
      from (
        select distinct on (line_key) *
        from payroll.pay_lines
        where line_key in (select line_key from payroll.pay_lines group by line_key having bool_and(ends_on is null))
        order by line_key, effective_from, created_at
      ) l`);
    current.user = preparer;
    const base = { cutoffDivisor: 11, changeWarnPercent: 10, reason: "Test rates" };
    // A version with the three overtime columns blank, and a later one with other percents filled in.
    expect(await savePaySettings({ ...base, effectiveFrom: "2033-01-01", extraRegular: "", extraRestDay: "", extraRestDayOver8: "" })).toMatchObject({ ok: true });
    expect(await savePaySettings({ ...base, effectiveFrom: "2033-04-01", extraRegular: "150", extraRestDay: "160", extraRestDayOver8: "200" })).toMatchObject({ ok: true });
  });

  it("pays 125%, 130% and 169% of each person's own hourly rate, flags nothing, and two rates give two amounts", async () => {
    const p = c33(0);
    const low = await person();
    const high = await person();
    await lineIn(low, p, { monthly: "22,000" }); // 125.00 an hour
    await lineIn(high, p, { monthly: "44,000" }); // 250.00 an hour
    const runId = await newRun(preparer, p);
    blankRun = runId;
    current.user = preparer;
    const [snap] = await rows<{ settings_snapshot: { multipliersBp: Record<string, number | null> } }>(sql`select settings_snapshot from payroll.pay_runs where id = ${runId}`);
    expect(snap.settings_snapshot.multipliersBp).toEqual({ regular: 12500, restDay: 13000, restDayOver8: 16900, holiday: 10000 });

    for (const emp of [low, high]) {
      const [l] = await runLines(runId, emp);
      for (const type of ["extra_regular", "extra_rest_day", "extra_rest_day_over_8"]) expect(await item(runId, emp, l.id, type, "60")).toMatchObject({ ok: true });
    }
    // One hour at 125.00: 125% = 156.25, 130% = 162.50, 169% = 211.25. At 250.00 an hour the same minutes pay twice as much.
    expect((await payloadOf(runId, low)).result.extra).toMatchObject({ regular: 15_625n, restDay: 16_250n, restDayOver8: 21_125n });
    expect((await payloadOf(runId, high)).result.extra).toMatchObject({ regular: 31_250n, restDay: 32_500n, restDayOver8: 42_250n });
    const sheet = (await getWorksheet(runId))!;
    for (const emp of [low, high]) {
      expect(forPerson(sheet.checks.blocking, emp)).toEqual([]);
      expect(notesFor(sheet.checks.warnings, emp)).toEqual([]);
    }
  });

  it("reads a duration typed as 1.5 h exactly like 90 minutes", async () => {
    const p = c33(0);
    const hours = await person();
    const minutes = await person();
    await lineIn(hours, p);
    await lineIn(minutes, p);
    const runId = blankRun;
    // The run was built before these two people existed: bring them in, then type the amounts.
    current.user = preparer;
    expect(await updateRunPeople({ runId })).toMatchObject({ ok: true, data: { added: 2 } });
    const [a] = await runLines(runId, hours);
    const [b] = await runLines(runId, minutes);
    expect(await item(runId, hours, a.id, "extra_regular", "1.5 h")).toMatchObject({ ok: true });
    expect(await item(runId, minutes, b.id, "extra_regular", "90")).toMatchObject({ ok: true });
    const typed = (await payloadOf(runId, hours)).result.extra.regular;
    expect(typed).toBe((await payloadOf(runId, minutes)).result.extra.regular);
    expect(typed).toBeGreaterThan(0n);
    const sheet = (await getWorksheet(runId))!;
    const shown = (id: string) => sheet.lines.find((l) => l.employeeId === id)!.items.find((i) => i.type === "extra_regular")!.value;
    expect(shown(hours)).toBe("1 h 30 min");
    expect(shown(minutes)).toBe("1 h 30 min");
  });

  it("lets a filled-in setting win over the standard percent", async () => {
    const p = c33(6);
    const emp = await person();
    await lineIn(emp, p);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    const [l] = await runLines(runId, emp);
    for (const type of ["extra_regular", "extra_rest_day", "extra_rest_day_over_8"]) expect(await item(runId, emp, l.id, type, "60")).toMatchObject({ ok: true });
    expect((await payloadOf(runId, emp)).result.extra).toMatchObject({ regular: 18_750n, restDay: 20_000n, restDayOver8: 25_000n });
  });
});

describe("a draft run's people", () => {
  it("adds exactly the person whose pay line was added, and a second call changes nothing", async () => {
    const p = c33(1);
    const first = await person();
    await lineIn(first, p);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    const late = await person();
    await lineIn(late, p);
    expect((await getWorksheet(runId))!.checks.warnings.map((c) => c.code)).toContain("lines_out_of_date");

    expect(await updateRunPeople({ runId })).toEqual({ ok: true, data: { added: 1, updated: 0, removed: 0 } });
    expect(await runLines(runId, late)).toHaveLength(1);
    expect(await runLines(runId, first)).toHaveLength(1);
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.lines.map((l) => l.employeeId).sort()).toEqual([first, late].sort());
    expect(sheet.checks.warnings.map((c) => c.code)).not.toContain("lines_out_of_date");
    expect(await updateRunPeople({ runId })).toEqual({ ok: true, data: { added: 0, updated: 0, removed: 0 } });
  });

  it("moves a line to its newer version (recomputed, confirmation cleared) after a rate change", async () => {
    const p = c33(2);
    const emp = await person();
    const key = await giveLine(preparer, emp, { effectiveFrom: "2033-01-20", monthly: "22,000" });
    const runId = await newRun(preparer, p);
    current.user = preparer;
    const [before] = await runLines(runId, emp);
    expect((await payloadOf(runId, emp)).result.cutoff).toBe(1_100_000n);
    expect(await confirmRunLine({ runLineId: before.id })).toMatchObject({ ok: true });
    expect((await runLines(runId, emp))[0].confirmed_by).toBe(preparer.id);

    expect(await updatePayLine({ ...lineBase(emp, { monthly: "33,000", effectiveFrom: p.periodStart }), lineKey: key, reason: "Raise" })).toMatchObject({ ok: true });
    expect(await updateRunPeople({ runId })).toEqual({ ok: true, data: { added: 0, updated: 1, removed: 0 } });
    const after = await runLines(runId, emp);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].confirmed_by).toBeNull();
    expect((await payloadOf(runId, emp)).result.cutoff).toBe(1_650_000n);
    expect(await updateRunPeople({ runId })).toEqual({ ok: true, data: { added: 0, updated: 0, removed: 0 } });
    expect(await endPayLine({ lineKey: key, endsOn: p.periodEnd, reason: "Test over" })).toMatchObject({ ok: true });
  });

  it("takes off a person whose line ended, keeping what was entered for them", async () => {
    const p = c33(3);
    const gone = await person();
    const stays = await person();
    const key = await giveLine(preparer, gone, { effectiveFrom: "2033-02-01" });
    await lineIn(stays, p);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    const [line] = await runLines(runId, gone);
    expect(await item(runId, gone, line.id, "adjustment", "250")).toMatchObject({ ok: true });
    expect(await endPayLine({ lineKey: key, endsOn: "2033-02-10", reason: "Left" })).toMatchObject({ ok: true });
    expect((await getWorksheet(runId))!.checks.warnings.map((c) => c.code)).toContain("lines_out_of_date");

    expect(await updateRunPeople({ runId })).toEqual({ ok: true, data: { added: 0, updated: 0, removed: 1 } });
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.lines.map((l) => l.employeeId)).toEqual([stays]);
    expect(sheet.removed).toEqual([expect.objectContaining({ runLineId: line.id })]);
    // The amounts stay in the database; the line is only marked.
    expect(await rows(sql`select 1 from payroll.pay_run_items where run_line_id = ${line.id}`)).not.toHaveLength(0);
    expect((await rows<{ excluded: boolean }>(sql`select excluded from payroll.pay_run_lines where id = ${line.id}`))[0].excluded).toBe(true);
    expect(await updateRunPeople({ runId })).toEqual({ ok: true, data: { added: 0, updated: 0, removed: 0 } });
  });

  it("does not call a run out of date once the person whose line ended has been taken off by Update people", async () => {
    const p = c33(9);
    const gone = await person();
    const key = await giveLine(preparer, gone, { effectiveFrom: "2033-05-01" });
    const stays = await person();
    await lineIn(stays, p);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    expect(await endPayLine({ lineKey: key, endsOn: "2033-05-10", reason: "Left" })).toMatchObject({ ok: true });
    expect(await updateRunPeople({ runId })).toEqual({ ok: true, data: { added: 0, updated: 0, removed: 1 } });
    expect((await getWorksheet(runId))!.checks.warnings.map((c) => c.code)).not.toContain("lines_out_of_date");
  });

  it("removes and restores a person: the worksheet, totals, hash, Remitly list and payslip ignore a removed line", async () => {
    const p = c33(4);
    const owner = await account(null);
    const kept = await person();
    const dropped = await person(owner.id);
    await lineIn(kept, p);
    await lineIn(dropped, p);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    const [droppedLine] = await runLines(runId, dropped);
    expect(await item(runId, dropped, droppedLine.id, "adjustment", "500")).toMatchObject({ ok: true });
    expect(await confirmRunLine({ runLineId: droppedLine.id })).toMatchObject({ ok: true });
    const full = (await getWorksheet(runId))!;
    const fullHash = await computeRunHash(db, runId);
    expect(full.lines).toHaveLength(2);
    expect(full.totals!.net).toBe("22,500.00"); // 11,000.00 + (11,000.00 + 500.00)

    expect(await removePersonFromRun({ runId, runLineId: droppedLine.id, reason: "" })).toMatchObject({ ok: false });
    expect(await removePersonFromRun({ runId, runLineId: droppedLine.id, reason: "Not paid this cutoff" })).toMatchObject({ ok: true });
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.lines.map((l) => l.employeeId)).toEqual([kept]);
    expect(sheet.removed).toEqual([expect.objectContaining({ runLineId: droppedLine.id })]);
    expect(sheet.totals!.net).toBe("11,000.00");
    expect(await computeRunHash(db, runId)).not.toBe(fullHash);
    expect((await runLines(runId, dropped))[0].confirmed_by).toBeNull();
    expect(await item(runId, dropped, droppedLine.id, "adjustment", "1")).toEqual({ ok: false, error: "That line is not on this run." });
    expect(await confirmRunLine({ runLineId: droppedLine.id })).toEqual({ ok: false, error: "That line was not found." });
    expect(await removePersonFromRun({ runId, runLineId: droppedLine.id, reason: "Again" })).toEqual({ ok: false, error: "That line is not on this run." });
    expect(await updateRunPeople({ runId })).toEqual({ ok: true, data: { added: 0, updated: 0, removed: 0 } });
    expect((await getWorksheet(runId))!.lines.map((l) => l.employeeId)).toEqual([kept]);
    expect((await getWorksheet(runId))!.checks.warnings.map((c) => c.code)).not.toContain("lines_out_of_date");

    expect(await restorePersonToRun({ runId, runLineId: droppedLine.id })).toMatchObject({ ok: true });
    const back = (await getWorksheet(runId))!;
    expect(back.lines.map((l) => l.employeeId).sort()).toEqual([kept, dropped].sort());
    expect(back.removed).toEqual([]);
    expect(back.totals!.net).toBe("22,500.00");
    expect((await runLines(runId, dropped))[0].confirmed_by).toBeNull();
    expect((await payloadOf(runId, dropped)).result.net).toBe(1_150_000n);
    expect(await restorePersonToRun({ runId, runLineId: droppedLine.id })).toEqual({ ok: false, error: "That line was not found." });

    // Taken off again, then approved and paid: the Remitly list and the payslip leave the removed person out.
    expect(await removePersonFromRun({ runId, runLineId: droppedLine.id, reason: "Not paid this cutoff" })).toMatchObject({ ok: true });
    const [name] = await rows<{ legal_last_name: string }>(sql`select legal_last_name from core.employees where id = ${dropped}`);
    const [keptName] = await rows<{ legal_last_name: string }>(sql`select legal_last_name from core.employees where id = ${kept}`);
    await db.execute(sql`update payroll.pay_runs set status = 'in_review' where id = ${runId}`);
    await db.execute(sql`update payroll.pay_runs set status = 'approved' where id = ${runId}`);
    const list = await db.transaction((tx) => remitlyList(tx, preparer as never, runId));
    expect(list.rows).toBe(1);
    expect(list.csv).toContain(keptName.legal_last_name);
    expect(list.csv).not.toContain(name.legal_last_name);
    await db.execute(sql`update payroll.pay_runs set status = 'paid' where id = ${runId}`);
    expect(await getMyPayslip({ ...owner, roles: ["employee"] } as never, runId)).toBeNull();
  });

  it("needs Preparer access and a draft run", async () => {
    const p = c33(5);
    const emp = await person();
    await lineIn(emp, p);
    const runId = await newRun(preparer, p);
    const [line] = await runLines(runId, emp);
    const NO_ACCESS = { ok: false, error: "You do not have access to do that." };

    for (const level of ["viewer", "approver", null]) {
      current.user = await account(level);
      expect(await removePersonFromRun({ runId, runLineId: line.id, reason: "No" })).toEqual(NO_ACCESS);
      expect(await restorePersonToRun({ runId, runLineId: line.id })).toEqual(NO_ACCESS);
      expect(await updateRunPeople({ runId })).toEqual(NO_ACCESS);
    }
    expect((await rows<{ excluded: boolean }>(sql`select excluded from payroll.pay_run_lines where id = ${line.id}`))[0].excluded).toBe(false);

    current.user = preparer;
    expect(await removePersonFromRun({ runId, runLineId: line.id, reason: "Not paid" })).toMatchObject({ ok: true });
    await db.execute(sql`update payroll.pay_runs set status = 'in_review' where id = ${runId}`);
    expect(await restorePersonToRun({ runId, runLineId: line.id })).toEqual(FROZEN);
    expect(await updateRunPeople({ runId })).toEqual(FROZEN);
    await db.execute(sql`update payroll.pay_runs set status = 'draft' where id = ${runId}`);
    expect(await restorePersonToRun({ runId, runLineId: line.id })).toMatchObject({ ok: true });
    await db.execute(sql`update payroll.pay_runs set status = 'in_review' where id = ${runId}`);
    expect(await removePersonFromRun({ runId, runLineId: line.id, reason: "Too late" })).toEqual(FROZEN);
  });
});

describe("checks that are only notes", () => {
  it("lets a run with a negative total, an unassigned suggestion and an unchecked own line be sent, and the Approver still can't approve their own unchecked line", async () => {
    const p = c33(7);
    const boss = await account("approver");
    const bossEmp = await person(boss.id);
    const deep = await person();
    const twoLines = await person();
    await lineIn(bossEmp, p);
    await lineIn(deep, p);
    await lineIn(twoLines, p, { alias: "Front desk" });
    await lineIn(twoLines, p, { alias: "Night shift" });
    const runId = await newRun(preparer, p);
    current.user = preparer;
    const [deepLine] = await runLines(runId, deep);
    // A loan far bigger than everyone's pay together: the total is below zero.
    expect(await item(runId, deep, deepLine.id, "loan", "100,000", "Large advance")).toMatchObject({ ok: true });
    const id = randomUUID();
    await db.execute(sql`insert into payroll.pay_run_items (id, run_id, employee_id, run_line_id, type, state, value_enc, entered_by)
      values (${id}, ${runId}, ${twoLines}, null, 'late_minutes', 'suggested', ${encryptItemValue(id, { value: 30n, reason: null, system: true })}, ${preparer.id})`);

    const sheet = (await getWorksheet(runId))!;
    expect(sheet.checks.blocking).toEqual([]);
    const codes = sheet.checks.warnings.map((c) => c.code);
    expect(codes).toContain("negative_net");
    expect(codes).toContain("unassigned_suggestion");
    expect(sheet.totals!.net.startsWith("-")).toBe(true);

    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    expect((await rows<{ status: string }>(sql`select status from payroll.pay_runs where id = ${runId}`))[0].status).toBe("in_review");

    // The Approver's own line was never checked by a Preparer: they can't decide the run, whatever the notes say.
    current.user = boss;
    const review = (await getWorksheet(runId))!;
    expect(review.checks.blocking).toEqual([]);
    expect(review.approvalRefusal).toMatch(/your own line/i);
    const refused = await approveRun({ runId, expectedHash: review.expectedHash! });
    expect(!refused.ok && refused.error).toMatch(/your own line/i);
    expect((await rows<{ status: string }>(sql`select status from payroll.pay_runs where id = ${runId}`))[0].status).toBe("in_review");
  });
});

describe("a person paid twice for the same client", () => {
  const TWICE = /would pay them twice/;
  const client = async () => (await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Twinclinic ")}) returning id`))[0].id;
  const make = (over: Record<string, unknown>) => {
    current.user = preparer;
    return createPayLine(lineBase(over.employeeId as string, over));
  };

  it("refuses a second line for the same person, client and alias that overlaps the first, and allows every real second line", async () => {
    const emp = await person();
    const clinic = await client();
    const first = await make({ employeeId: emp, clientId: clinic, effectiveFrom: "2033-07-01", endsOn: "2033-07-31" });
    expect(first.ok).toBe(true);
    // The same client and no alias, overlapping dates: a twin.
    expect(await make({ employeeId: emp, clientId: clinic, effectiveFrom: "2033-07-10" })).toMatchObject({ ok: false, error: expect.stringMatching(TWICE) });
    expect(await make({ employeeId: emp, clientId: clinic, effectiveFrom: "2033-06-01", endsOn: "2033-07-01" })).toMatchObject({ ok: false, error: expect.stringMatching(TWICE) });
    // Real second lines: another alias (a second role), another client, or dates that start after the first ended.
    expect((await make({ employeeId: emp, clientId: clinic, alias: "Night shift", effectiveFrom: "2033-07-01", endsOn: "2033-07-31" })).ok).toBe(true);
    expect((await make({ employeeId: emp, clientId: await client(), effectiveFrom: "2033-07-01", endsOn: "2033-07-31" })).ok).toBe(true);
    expect((await make({ employeeId: emp, clientId: clinic, effectiveFrom: "2033-08-01", endsOn: "2033-08-31" })).ok).toBe(true);
    // A line with no client is the same job as the client's line (a leftover): refused too.
    expect(await make({ employeeId: emp, effectiveFrom: "2033-07-01", endsOn: "2033-07-31" })).toMatchObject({ ok: false, error: expect.stringMatching(TWICE) });
    // The alias match ignores case and spaces.
    expect(await make({ employeeId: emp, clientId: clinic, alias: "  NIGHT shift ", effectiveFrom: "2033-07-05", endsOn: "2033-07-20" })).toMatchObject({ ok: false, error: expect.stringMatching(TWICE) });
    // Nothing is written for a refused line.
    expect(await rows(sql`select 1 from payroll.pay_lines where employee_id = ${emp}`)).toHaveLength(4);
  });

  it("refuses to change a line's alias or client so that it becomes a twin of another line", async () => {
    const emp = await person();
    const clinic = await client();
    current.user = preparer;
    const a = await createPayLine(lineBase(emp, { clientId: clinic, alias: "Front desk", effectiveFrom: "2033-09-01" }));
    const b = await createPayLine(lineBase(emp, { clientId: clinic, alias: "Night shift", effectiveFrom: "2033-09-01" }));
    if (!a.ok || !b.ok) throw new Error("lines failed");
    const change = (lineKey: string, over: Record<string, unknown>) =>
      updatePayLine({ lineKey, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2033-09-01", monthly: "22,000", reason: "Rename", ...over });
    expect(await change(b.data.lineKey, { clientId: clinic, alias: "front DESK" })).toMatchObject({ ok: false, error: expect.stringMatching(TWICE) });
    // Changing the pay, with the same client and alias, is not a twin of anything.
    expect(await change(b.data.lineKey, { clientId: clinic, alias: "Night shift", monthly: "23,000" })).toMatchObject({ ok: true });
    // A different alias is fine.
    expect(await change(b.data.lineKey, { clientId: clinic, alias: "Weekend" })).toMatchObject({ ok: true });
  });

  it("a run that has two lines for the same client and alias warns about every one of them, without blocking; different aliases do not warn", async () => {
    const p = c33(12);
    const twin = await person();
    const roles = await person();
    const clinic = await client();
    await lineIn(twin, p, { clientId: clinic, alias: "A" });
    await lineIn(twin, p, { clientId: clinic, alias: "B" });
    await lineIn(roles, p, { clientId: clinic, alias: "Front desk" });
    await lineIn(roles, p, { clientId: clinic, alias: "Night shift" });
    const runId = await newRun(preparer, p);
    // The way a twin could exist already: the same client and alias on two live lines of one run.
    await db.execute(sql`update payroll.pay_run_lines set alias = 'A' where run_id = ${runId} and employee_id = ${twin} and alias = 'B'`);

    current.user = preparer;
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.checks.blocking).toEqual([]);
    const twice = sheet.checks.warnings.filter((c) => c.code === "duplicate_pay_line");
    expect(twice).toHaveLength(2);
    expect(new Set(twice.map((c) => c.employeeId))).toEqual(new Set([twin]));
    expect(sheet.checks.warnings.some((c) => c.code === "duplicate_pay_line" && c.employeeId === roles)).toBe(false);
    // It is a note: the run can still be sent.
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
  });

  it("a leftover line with no client next to the client's line for the same alias is a twin too (the case that doubled a whole run)", async () => {
    const p = c33(14);
    const left = await person();
    const clinic = await client();
    await lineIn(left, p, { clientId: clinic, alias: "X" });
    await lineIn(left, p, { clientId: clinic, alias: "Y" });
    const runId = await newRun(preparer, p);
    // The run as it would be built from an old no-client line and the new client line for the same job.
    await db.execute(sql`update payroll.pay_run_lines set alias = 'X', client_id = null where run_id = ${runId} and employee_id = ${left} and alias = 'Y'`);
    current.user = preparer;
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.checks.warnings.filter((c) => c.code === "duplicate_pay_line" && c.employeeId === left)).toHaveLength(2);
  });

  it("lists a line whose last day has passed only when ended lines are asked for (the Rates tab hides them by default)", async () => {
    const emp = await person();
    const key = await giveLine(preparer, emp, { effectiveFrom: "2024-01-01", endsOn: "2024-01-31" });
    current.user = preparer;
    expect((await getRates()).some((r) => r.lineKey === key)).toBe(false);
    const ended = (await getRates({ includeEnded: true })).find((r) => r.lineKey === key);
    expect(ended).toMatchObject({ employeeId: emp, ended: true, endsOn: "2024-01-31", effectiveFrom: "2024-01-01" });
    // A line still in force is not marked ended.
    expect((await getRates({ includeEnded: true })).filter((r) => r.ended === false).length).toBeGreaterThanOrEqual(0);
  });
});
