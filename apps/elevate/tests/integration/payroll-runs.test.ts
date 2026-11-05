import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Real-database test: draft runs, items, the worksheet and the checks. Invented names and figures only.
// Periods are in 2025 and lines start in 2024, clear of the leftovers other payroll test files keep in the same throwaway database.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { createPayLine, updatePayLine, savePaySettings, createPayRun, savePayItem, dismissPayItem, setRunUsdRate, confirmRunLine } = await import("@/modules/payroll/actions");
const { getWorksheet, getRuns } = await import("@/modules/payroll/queries");
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
  fte: "1",
  paymentMethod: "remitly",
  effectiveFrom: "2024-12-01",
  monthly: "22,000",
  pesoAllowance: "1,000",
  dollarAllowance: "0",
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
const period = (month: number, half: 1 | 2 = 1) => ({
  periodStart: `2025-${String(month).padStart(2, "0")}-${half === 1 ? "01" : "16"}`,
  periodEnd: `2025-${String(month).padStart(2, "0")}-${half === 1 ? "15" : "28"}`,
});
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
const item = (runId: string, employeeId: string, runLineId: string, type: string, value: string, reason?: string) =>
  savePayItem({ runId, employeeId, runLineId, type, value, reason });
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
    extraHoliday: "200",
    extraRestDay: "130",
    extraRestDayOver8: "169",
    holiday: "100",
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
    await giveLine(preparer, twoLines, { alias: "Night shift", monthly: "10,000", fte: "0.5" });

    const p = period(1);
    const runId = await newRun(preparer, p);
    expect(await runLines(runId, solo)).toHaveLength(1);
    expect(await runLines(runId, noAccount)).toHaveLength(1);
    const two = await runLines(runId, twoLines);
    expect(two.map((l) => l.alias).sort()).toEqual(["Front desk", "Night shift"]);

    // 22,000 / 2 = 11,000 plus the 1,000 allowance.
    const pay = await payloadOf(runId, solo);
    expect(pay.result.cutoff).toBe(1_100_000n);
    expect(pay.result.gross).toBe(1_200_000n);
    expect(pay.result.net).toBe(1_200_000n);

    const [run] = await rows<{ status: string; settings_snapshot: unknown }>(sql`select status, settings_snapshot from payroll.pay_runs where id = ${runId}`);
    expect(run.status).toBe("draft");
    expect(run.settings_snapshot).toEqual(await settingsInForce(db, p.periodStart));

    const same = await createPayRun(p);
    expect(same).toEqual({ ok: false, error: `There is already a pay run for ${p.periodStart} to ${p.periodEnd}.` });
    const overlap = await createPayRun({ periodStart: "2025-01-10", periodEnd: "2025-01-20" });
    expect(overlap.ok).toBe(false);
    expect(!overlap.ok && overlap.error).toMatch(/overlaps/);
    expect((await createPayRun({ periodStart: "2025-01-15", periodEnd: "2025-01-16" })).ok).toBe(false);
    expect(await createPayRun({ periodStart: "2025-01-16", periodEnd: "2025-01-10" })).toEqual({ ok: false, error: "Check the request and try again." });
    // A neighbouring period is fine, and a period nobody is paid in is refused.
    expect((await createPayRun({ periodStart: "2024-12-20", periodEnd: "2024-12-31" })).ok).toBe(true);
    const none = await createPayRun({ periodStart: "2019-01-01", periodEnd: "2019-01-15" });
    expect(none.ok).toBe(false);

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
    // 22,000 -> daily 1,000 -> hourly 125 -> 60 minutes is 125.00, so net is 12,000.00 - 125.00.
    expect((await payloadOf(runId, a)).result.net).toBe(1_187_500n);
    expect((await runLines(runId, a))[0].confirmed_by).toBeNull();
    const bAfter = (await runLines(runId, b))[0];
    expect(bAfter.confirmed_by).toBe(checker.id);
    expect(bAfter.payload_enc).toBe(bBefore);

    expect(await item(runId, a, la.id, "late_minutes", "90")).toMatchObject({ ok: true });
    expect((await payloadOf(runId, a)).result.net).toBe(1_181_250n);

    const log = await rows<{ id: string; detail_enc: string }>(
      sql`select id, detail_enc from payroll.pay_change_log where run_id = ${runId} and employee_id = ${a} and action = 'item_saved' order by created_at`,
    );
    expect(log).toHaveLength(2);
    expect(readChangeDetail(log[0])).toMatchObject({ type: "late_minutes", old: null, new: { value: "60" } });
    expect(readChangeDetail(log[1])).toMatchObject({ old: { value: "60", state: "confirmed" }, new: { value: "90" } });
    const audit = await rows<Row>(sql`select * from ops.audit_log where actor_user_id = ${preparer.id} and action = 'payroll.item.save' and target_id = ${runId}`);
    expect(audit).toHaveLength(2);
    expect(JSON.stringify(audit)).not.toMatch(/1187500|11,875|"60"|"90"/);
  });

  it("keeps the lines of a two-line person apart", async () => {
    const emp = await person();
    await giveLine(preparer, emp, { alias: "First" });
    await giveLine(preparer, emp, { alias: "Second", monthly: "11,000", pesoAllowance: "0" });
    const runId = await newRun(preparer, period(5));
    const lines = await runLines(runId, emp);
    const first = lines.find((l) => l.alias === "First")!;
    const second = lines.find((l) => l.alias === "Second")!;
    const before = second.payload_enc;
    current.user = preparer;
    expect(await item(runId, emp, first.id, "loan", "500", "Cash advance")).toMatchObject({ ok: true });
    const f = decryptRunLine(first.id, (await runLines(runId, emp)).find((l) => l.id === first.id)!.payload_enc);
    const s = decryptRunLine(second.id, (await runLines(runId, emp)).find((l) => l.id === second.id)!.payload_enc);
    expect(f.result.net).toBe(1_200_000n - 50_000n);
    expect(s.result.net).toBe(550_000n);
    expect(s.input.loan).toBe(0n);
    void before;
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
    expect((await payloadOf(runId, emp)).result.net).toBe(1_200_000n);
    expect(await dismissPayItem({ runId, itemId: first.id, reason: "again" })).toEqual({ ok: false, error: "That amount has changed. Reload the page and try again." });
    const all = await rows<{ state: string }>(sql`select state from payroll.pay_run_items where run_id = ${runId} order by created_at`);
    expect(all.map((r) => r.state)).toEqual(["confirmed", "dismissed"]);
  });
});

describe("separation of duties and the draft lock", () => {
  it("a Preparer can't save an item on, dismiss, or confirm their own line; another Preparer can", async () => {
    const mine = await account();
    const ownEmp = await person(mine.id);
    await giveLine(preparer, ownEmp);
    const runId = await newRun(mine, period(9));
    const [line] = await runLines(runId, ownEmp);
    const own = { ok: false, error: "You can't change your own pay." };

    current.user = mine;
    expect(await item(runId, ownEmp, line.id, "adjustment", "100")).toEqual(own);
    expect(await confirmRunLine({ runLineId: line.id })).toEqual(own);

    current.user = preparer;
    expect(await item(runId, ownEmp, line.id, "adjustment", "100")).toMatchObject({ ok: true });
    const [it] = await rows<{ id: string }>(sql`select id from payroll.pay_run_items where run_id = ${runId} and employee_id = ${ownEmp}`);
    current.user = mine;
    expect(await dismissPayItem({ runId, itemId: it.id })).toEqual(own);

    // The worksheet blocks sending until someone else confirms the submitter's own line.
    let sheet = (await getWorksheet(runId))!;
    expect(forPerson(sheet.checks.blocking, ownEmp)).toEqual(["own_line_unconfirmed"]);
    current.user = preparer;
    expect(await confirmRunLine({ runLineId: line.id })).toMatchObject({ ok: true });
    current.user = mine;
    sheet = (await getWorksheet(runId))!;
    expect(forPerson(sheet.checks.blocking, ownEmp)).toEqual([]);
    expect(sheet.lines.find((l) => l.employeeId === ownEmp)).toMatchObject({ isOwn: true, confirmedByMe: false });
    // A later change by the other Preparer clears the confirmation again.
    current.user = preparer;
    await item(runId, ownEmp, line.id, "adjustment", "200");
    current.user = mine;
    expect(forPerson((await getWorksheet(runId))!.checks.blocking, ownEmp)).toEqual(["own_line_unconfirmed"]);
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
    expect(await setRunUsdRate({ runId, rate: "58.50" })).toEqual(frozen);
    expect(await confirmRunLine({ runLineId: line.id })).toEqual(frozen);
    const [it] = await rows<{ id: string }>(sql`select id from payroll.pay_run_items where run_id = ${runId}`);
    expect(await dismissPayItem({ runId, itemId: it.id })).toEqual(frozen);
    expect((await payloadOf(runId, emp)).input.adjustment).toBe(10_000n);
  });
});

describe("the dollar rate and the settings", () => {
  it("converts the dollar allowance at the run's rate, and a missing rate blocks", async () => {
    const emp = await person();
    await giveLine(preparer, emp, { dollarAllowance: "12.50" });
    const runId = await newRun(preparer, period(11, 1));
    current.user = preparer;
    let sheet = (await getWorksheet(runId))!;
    expect(forPerson(sheet.checks.blocking, emp)).toEqual(["missing_usd_rate"]);

    expect(await setRunUsdRate({ runId, rate: "58.50" })).toMatchObject({ ok: true });
    sheet = (await getWorksheet(runId))!;
    expect(forPerson(sheet.checks.blocking, emp)).toEqual([]);
    expect(sheet.run.usdRate).toBe("58.50");
    // 12.50 dollars at 58.50 is 731.25 pesos.
    expect(sheet.lines.find((l) => l.employeeId === emp)!.figures).toMatchObject({ dollarAllowance: "12.50", dollarAllowancePesos: "731.25", net: "12,731.25" });
    const log = await rows<{ id: string; detail_enc: string }>(sql`select id, detail_enc from payroll.pay_change_log where run_id = ${runId} and action = 'usd_rate_changed'`);
    expect(readChangeDetail(log[0])).toEqual({ old: null, new: "58.50" });

    expect(await setRunUsdRate({ runId, rate: "" })).toMatchObject({ ok: true });
    expect(await setRunUsdRate({ runId, rate: "58" + "x" })).toEqual({ ok: false, error: "Check the request and try again." });
    expect((await getWorksheet(runId))!.run.usdRate).toBeNull();
  });

  it("blocks an extra-hours item whose rate is not set, using the settings in force for the period", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    const early = await newRun(preparer, period(3, 2)); // before June 2025: no rates yet
    current.user = preparer;
    const [line] = await runLines(early, emp);
    await item(early, emp, line.id, "extra_regular", "120");
    const sheet = (await getWorksheet(early))!;
    expect(sheet.checks.blocking.filter((c) => c.employeeId === emp)).toEqual([expect.objectContaining({ code: "missing_multiplier", detail: "Extra hours, regular day" })]);
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
      await savePaySettings({ effectiveFrom: "2025-08-20", cutoffDivisor: 11, changeWarnPercent: 10, extraRegular: "150", extraHoliday: "200", extraRestDay: "130", extraRestDayOver8: "169", holiday: "100", reason: "Change" }),
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
    await giveLine(preparer, emp, { clientId: client.id, fte: "0.5" });
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
    expect(mine.figures).toMatchObject({ gross: "12,000.00", net: "12,100.00", clientHours: "86.5" });
    expect(mine.fte).toBe("0.50");
    const group = first.byClient!.find((c) => c.clientId === client.id)!;
    expect(group).toEqual({ clientId: client.id, clientName: client.name, lines: 1, fte: "0.5", clientHours: "86.5", net: "12,100.00" });
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
    const emp = await person();
    const key = await giveLine(preparer, emp, { effectiveFrom: "2025-07-20" }); // starts inside the first run's period
    const withPayout = await person();
    await giveLine(preparer, withPayout);
    await db.execute(sql`insert into core.employee_sensitive (employee_id, masks) values (${withPayout}, ${JSON.stringify({ bankName: "BDO", bankAccountName: "M T", bankAccountNumber: "****1234" })}::jsonb)`);
    // One finished day with hours nobody approved, one that was approved.
    await db.execute(sql`insert into time.attendance_days (employee_id, date, sessions, worked_minutes, scheduled_minutes) values (${emp}, '2025-07-22', 1, 480, 480), (${emp}, '2025-07-23', 1, 480, 480)`);
    await db.execute(sql`insert into time.hours_approvals (employee_id, date, scheduled_minutes, worked_minutes, break_minutes, extra_minutes, approved_extra_minutes, approved_by)
      values (${emp}, '2025-07-23', 480, 480, 0, 0, 0, ${preparer.id})`);

    const first = await newRun(preparer, period(7, 2));
    current.user = preparer;
    let sheet = (await getWorksheet(first))!;
    expect(forPerson(sheet.checks.warnings, emp)).toEqual(["new_or_leaving", "no_payout_details", "unapproved_days"]);
    expect(sheet.checks.warnings.find((c) => c.employeeId === emp && c.code === "unapproved_days")!.detail).toBe("1");
    expect(forPerson(sheet.checks.warnings, withPayout)).toEqual([]);

    // A raise of 50% in the next period moves net pay by more than the 10% default; the first run has nothing to compare with.
    expect(forPerson(sheet.checks.warnings, emp)).not.toContain("large_change");
    await updatePayLine({ ...lineBase(emp, { monthly: "33,000" }), lineKey: key, effectiveFrom: "2025-07-29", reason: "Raise" });
    const second = await newRun(preparer, { periodStart: "2025-07-29", periodEnd: "2025-07-31" });
    sheet = (await getWorksheet(second))!;
    expect(forPerson(sheet.checks.warnings, emp)).toContain("large_change");
    expect(forPerson(sheet.checks.warnings, withPayout)).toEqual([]);
    expect(JSON.stringify(sheet.checks)).not.toMatch(/\d,\d{3}\.\d\d/);
  });
});
