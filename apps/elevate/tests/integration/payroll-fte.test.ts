import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: the FTE count on a rate, the run's total FTE, and an internal-team line paid per FTE (total FTE x its amount). Invented
// people and figures only. Every period is a half month of 2043, and each test's pay lines start and end inside its own period.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const actions = await import("@/modules/payroll/actions");
const { createPayLine, setLineFtes, savePaySettings, createPayRun, savePayItem, confirmRunLine, submitRun, approveRun, unapproveRun, updateRunPeople, removePersonFromRun, restorePersonToRun } = actions;
const { getWorksheet, getRates } = await import("@/modules/payroll/queries");
const { decryptRunLine } = await import("@/modules/payroll/service");
const { buildStatement } = await import("@/modules/payroll/payslip-queries");
const { payslipView } = await import("@/modules/payroll/payslip");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function account(level: "preparer" | "approver" = "preparer") {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("fte")}@example.com`}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  return { id, email: "x@example.com", roles: ["employee"], payrollAccess: level };
}
async function person() {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status)
    values ('Liza', ${uniq("Testreyes")}, ${`${uniq("emp")}@example.com`}, 'active') returning id`);
  return e.id;
}
/** Half month `n` of 2043 (0 = 1 to 15 January, 1 = 16 to 31 January, ...). */
function slot(n: number) {
  const month = Math.floor(n / 2) + 1;
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(2043, month, 0)).getUTCDate();
  return n % 2 === 0 ? { periodStart: `2043-${mm}-01`, periodEnd: `2043-${mm}-15` } : { periodStart: `2043-${mm}-16`, periodEnd: `2043-${mm}-${last}` };
}
const as = (who: unknown) => {
  current.user = who;
};
type Period = { periodStart: string; periodEnd: string };

/** A rate that lasts exactly one period. `over` sets the FTE count or turns it into an amount per FTE. */
async function giveLine(employeeId: string, p: Period, over: Record<string, unknown> = {}) {
  as(preparer);
  const r = await createPayLine({ employeeId, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: p.periodStart, endsOn: p.periodEnd, monthly: "22,000", ...over });
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
  return r.data.lineKey;
}
async function newRun(p: Period) {
  as(preparer);
  const r = await createPayRun(p);
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}
const runLineOf = async (runId: string, employeeId: string) =>
  (await rows<{ id: string; payload_enc: string; confirmed_by: string | null; excluded: boolean }>(sql`select id, payload_enc, confirmed_by, excluded from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId}`))[0];
const payloadOf = async (runId: string, employeeId: string) => {
  const l = await runLineOf(runId, employeeId);
  return decryptRunLine(l.id, l.payload_enc);
};
const sheetOf = async (runId: string, who: unknown = preparer) => {
  as(who);
  return (await getWorksheet(runId))!;
};
const money = (c: bigint) => `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;

let preparer: Awaited<ReturnType<typeof account>>;
let checker: Awaited<ReturnType<typeof account>>;
let approver: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  preparer = await account("preparer");
  checker = await account("preparer");
  approver = await account("approver");
  as(preparer);
  const saved = await savePaySettings({ cutoffDivisor: 11, changeWarnPercent: 10, extraRegular: "125", extraRestDay: "130", extraRestDayOver8: "169", reason: "Test rates", effectiveFrom: "2043-01-01" });
  expect(saved).toMatchObject({ ok: true });
});

describe("the run's total FTE and a line paid per FTE", () => {
  it("adds up the counts of the lines on the run, and pays the internal-team line the total times its amount", async () => {
    const p = slot(0);
    const [a, b, c, d, e, internal] = [await person(), await person(), await person(), await person(), await person(), await person()];
    await giveLine(a, p, { fte: "1" });
    await giveLine(b, p, { fte: "0.5" });
    await giveLine(c, p, { fte: "0" }); // 0 is a real count: it does not count, and it is not "not set"
    await giveLine(d, p); // no count yet
    await giveLine(e, p, { fte: "1" });
    await giveLine(internal, p, { basis: "per_fte", perFte: "1,500", monthly: "" });
    const runId = await newRun(p);

    const sheet = await sheetOf(runId);
    expect(sheet.totals?.fte).toBe("2.5");
    const line = sheet.lines.find((l) => l.employeeId === internal)!;
    expect(line.perFte).toBe(true);
    expect(line.figures).toMatchObject({ monthly: "2.5 × 1,500.00", cutoff: "3,750.00", base: "3,750.00", net: "3,750.00", fte: null });
    expect(sheet.lines.find((l) => l.employeeId === b)!.figures).toMatchObject({ fte: "0.5", fteFromRun: false });
    expect(sheet.lines.find((l) => l.employeeId === c)!.figures?.fte).toBe("0");
    expect(sheet.lines.find((l) => l.employeeId === d)!.figures?.fte).toBeNull();

    // The payload keeps how the line was worked out (the approval hash covers the payload, so a different total needs a new approval).
    const payload = await payloadOf(runId, internal);
    expect(payload.perFte).toEqual({ totalFteHundredths: 250 });
    expect(payload.rate).toMatchObject({ monthlyCentavos: 0n, perFteCentavos: 150_000n });
    expect(money(payload.result.net)).toBe("3,750.00".replace(",", ""));

    // FTE is only a reminder for the line with no count, and only because the run has a per-FTE line.
    const warned = sheet.checks.warnings.filter((w) => w.code === "fte_not_set");
    expect(warned.map((w) => w.employeeId)).toEqual([d]);
  });

  it("says so once when the run's total FTE is 0, and warns about nothing when no line is paid per FTE", async () => {
    const p = slot(1);
    const [a, internal] = [await person(), await person()];
    await giveLine(a, p, { fte: "0" });
    await giveLine(internal, p, { basis: "per_fte", perFte: "1,500", monthly: "" });
    const sheet = await sheetOf(await newRun(p));
    expect(sheet.checks.warnings.filter((w) => w.code === "per_fte_without_total")).toHaveLength(1);
    expect(sheet.lines.find((l) => l.employeeId === internal)!.figures?.net).toBe("0.00");

    // A run with contractors only needs no FTE at all.
    const q = slot(2);
    const only = await person();
    await giveLine(only, q);
    const plain = await sheetOf(await newRun(q));
    expect(plain.checks.warnings.filter((w) => w.code === "fte_not_set" || w.code === "per_fte_without_total")).toEqual([]);
  });

  it("uses a count typed for the run instead of the rate's, and follows a removed or restored line", async () => {
    const p = slot(3);
    const [a, b, internal] = [await person(), await person(), await person()];
    await giveLine(a, p, { fte: "1" });
    await giveLine(b, p, { fte: "1" });
    await giveLine(internal, p, { basis: "per_fte", perFte: "1,100", monthly: "" });
    const runId = await newRun(p);
    expect((await sheetOf(runId)).lines.find((l) => l.employeeId === internal)!.figures?.base).toBe("2,200.00");

    const lineA = await runLineOf(runId, a);
    as(preparer);
    expect(await savePayItem({ runId, employeeId: a, runLineId: lineA.id, type: "fte", value: "0.5" })).toMatchObject({ ok: true });
    let sheet = await sheetOf(runId);
    expect(sheet.totals?.fte).toBe("1.5");
    expect(sheet.lines.find((l) => l.employeeId === a)!.figures).toMatchObject({ fte: "0.5", fteFromRun: true });
    expect(sheet.lines.find((l) => l.employeeId === internal)!.figures?.base).toBe("1,650.00");
    // 0 may be typed for the run ("does not count this time").
    as(preparer);
    expect(await savePayItem({ runId, employeeId: a, runLineId: lineA.id, type: "fte", value: "0" })).toMatchObject({ ok: true });
    expect((await sheetOf(runId)).totals?.fte).toBe("1");

    // Taking a person off the run moves the total, and putting them back moves it again.
    as(preparer);
    expect(await removePersonFromRun({ runId, runLineId: (await runLineOf(runId, b)).id, reason: "Not on this run" })).toMatchObject({ ok: true });
    sheet = await sheetOf(runId);
    expect(sheet.totals?.fte).toBe("0");
    expect(sheet.lines.find((l) => l.employeeId === internal)!.figures?.base).toBe("0.00");
    as(preparer);
    expect(await restorePersonToRun({ runId, runLineId: (await runLineOf(runId, b)).id })).toMatchObject({ ok: true });
    expect((await sheetOf(runId)).lines.find((l) => l.employeeId === internal)!.figures?.base).toBe("1,100.00");

    // A line paid per FTE has no FTE of its own to type, and a count above 2 is refused.
    const lineInternal = await runLineOf(runId, internal);
    as(preparer);
    expect(await savePayItem({ runId, employeeId: internal, runLineId: lineInternal.id, type: "fte", value: "1" })).toEqual({ ok: false, error: "This line is paid per FTE, so it has no FTE of its own." });
    expect(await savePayItem({ runId, employeeId: a, runLineId: lineA.id, type: "fte", value: "3" })).toMatchObject({ ok: false });
  });

  it("still takes an absence off an internal-team line, from the pay the total FTE gave it", async () => {
    const p = slot(4);
    const [a, internal] = [await person(), await person()];
    await giveLine(a, p, { fte: "1" });
    await giveLine(a === internal ? await person() : internal, p, { basis: "per_fte", perFte: "1,500", monthly: "" });
    const runId = await newRun(p);
    const lineInternal = await runLineOf(runId, internal);
    as(preparer);
    expect(await savePayItem({ runId, employeeId: internal, runLineId: lineInternal.id, type: "absence_days", value: "1" })).toMatchObject({ ok: true });
    const f = (await sheetOf(runId)).lines.find((l) => l.employeeId === internal)!.figures!;
    expect(f.base).toBe("1,500.00"); // 1 FTE x 1,500
    expect(f.absences).toBe("136.36"); // monthly 3,000 / 22 days
    expect(f.net).toBe("1,363.64");
  });
});

describe("setting FTE on the rates", () => {
  it("writes a same-date correction, shows it on the Rates tab, and a draft run picks it up without clearing anyone's check", async () => {
    const p = slot(5);
    const [a, b, internal] = [await person(), await person(), await person()];
    const keyB = await giveLine(b, p, { fte: "0.5" });
    await giveLine(a, p, { fte: "1" });
    await giveLine(internal, p, { basis: "per_fte", perFte: "1,500", monthly: "" });
    const runId = await newRun(p);

    // Another Preparer checks B's line.
    as(checker);
    expect(await confirmRunLine({ runLineId: (await runLineOf(runId, b)).id })).toMatchObject({ ok: true });
    expect((await runLineOf(runId, b)).confirmed_by).toBe(checker.id);
    expect((await sheetOf(runId)).totals?.fte).toBe("1.5");

    as(preparer);
    expect(await setLineFtes({ rows: [{ lineKey: keyB, fte: "1" }, { lineKey: keyB, fte: "1" }] })).toEqual({ ok: true, data: { changed: 1, skipped: 0 } });
    // Nothing changes on the run until it is filled; the version it uses is the one it was made with.
    expect((await sheetOf(runId)).totals?.fte).toBe("1.5");

    // The same count again changes nothing and writes nothing.
    const versionsBefore = await rows(sql`select 1 from payroll.pay_lines where line_key = ${keyB}`);
    expect(await setLineFtes({ rows: [{ lineKey: keyB, fte: "1" }] })).toEqual({ ok: true, data: { changed: 0, skipped: 1 } });
    expect(await rows(sql`select 1 from payroll.pay_lines where line_key = ${keyB}`)).toHaveLength(versionsBefore.length);

    // The new version has the SAME effective date (a correction), so no new date and no "new rate" flag appear.
    const versions = await rows<{ effective_from: string }>(sql`select effective_from::text from payroll.pay_lines where line_key = ${keyB} order by created_at`);
    expect(versions.map((v) => v.effective_from)).toEqual([p.periodStart, p.periodStart]);
    as(preparer);
    expect((await getRates()).find((r) => r.lineKey === keyB)).toMatchObject({ fte: "1", basis: "monthly" });

    // Filling the run uses the new version: the total moves, the internal line follows, and B's check stays (only the FTE count changed).
    as(preparer);
    expect(await updateRunPeople({ runId })).toMatchObject({ ok: true });
    const sheet = await sheetOf(runId);
    expect(sheet.totals?.fte).toBe("2");
    expect(sheet.lines.find((l) => l.employeeId === internal)!.figures?.base).toBe("3,000.00");
    expect((await runLineOf(runId, b)).confirmed_by).toBe(checker.id);
  });

  it("skips a rate paid per FTE and a rate that was removed, and records the change without a figure in the audit log", async () => {
    const p = slot(6);
    const [a, internal] = [await person(), await person()];
    const keyA = await giveLine(a, p, { fte: "1" });
    const keyI = await giveLine(internal, p, { basis: "per_fte", perFte: "1,500", monthly: "" });
    as(preparer);
    expect(await setLineFtes({ rows: [{ lineKey: keyI, fte: "1" }, { lineKey: keyA, fte: "0.5" }] })).toEqual({ ok: true, data: { changed: 1, skipped: 1 } });
    as(preparer);
    expect((await getRates()).find((r) => r.lineKey === keyI)).toMatchObject({ basis: "per_fte", fte: null, monthly: "1,500.00" });

    const audit = JSON.stringify(await rows(sql`select * from ops.audit_log where action in ('payroll.line.set_fte', 'payroll.line.create') and actor_user_id = ${preparer.id}`));
    expect(audit).toContain("payroll.line.set_fte");
    expect(audit).not.toMatch(/fte[^a-z]*(50|100)\b|1500|150000|1,500/i);
    const log = await rows<{ detail_enc: string }>(sql`select detail_enc from payroll.pay_change_log where line_key = ${keyA} and action = 'line_updated'`);
    expect(JSON.stringify(log)).not.toMatch(/fteHundredths|FTE set/);
  });

  it("keeps the count and the amount per FTE only inside the encrypted rate", async () => {
    const p = slot(7);
    const [a, internal] = [await person(), await person()];
    await giveLine(a, p, { fte: "0.5" });
    await giveLine(internal, p, { basis: "per_fte", perFte: "1,500", monthly: "" });
    const stored = JSON.stringify(await rows(sql`select amounts_enc from payroll.pay_lines where employee_id in (${a}, ${internal})`));
    expect(stored).not.toMatch(/fteHundredths|perFte|150000/);
  });
});

describe("statements: FTE only for the internal team", () => {
  it("writes FTE on the internal-team line's statement and nothing about FTE on a contractor's", async () => {
    const p = slot(8);
    const [a, internal] = [await person(), await person()];
    await giveLine(a, p, { fte: "1" });
    await giveLine(internal, p, { basis: "per_fte", perFte: "1,500", monthly: "" });
    const runId = await newRun(p);
    const [run] = await rows<{ periodStart: string; periodEnd: string; settingsSnapshot: unknown; isTest: boolean }>(
      sql`select period_start::text as "periodStart", period_end::text as "periodEnd", settings_snapshot as "settingsSnapshot", is_test as "isTest" from payroll.pay_runs where id = ${runId}`,
    );
    const contractor = payslipView((await buildStatement(db, runId, a, run))!);
    expect(JSON.stringify(contractor)).not.toMatch(/bFTEb/i);
    const internalView = payslipView((await buildStatement(db, runId, internal, run))!);
    expect(JSON.stringify(internalView)).toMatch(/1 FTE × 1,500\.00/);
    expect(internalView.lines[0].net).toBe("1,500.00");
  });
});

describe("approval after a change of FTE", () => {
  it("needs a fresh approval after the run is unapproved and an FTE changes", async () => {
    const p = slot(9);
    const [a, internal] = [await person(), await person()];
    await giveLine(a, p, { fte: "1" });
    await giveLine(internal, p, { basis: "per_fte", perFte: "1,500", monthly: "" });
    const runId = await newRun(p);
    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    const hash = (await sheetOf(runId, approver)).expectedHash!;
    as(approver);
    expect(await approveRun({ runId, expectedHash: hash })).toMatchObject({ ok: true });

    expect(await unapproveRun({ runId, note: "The counts were wrong" })).toMatchObject({ ok: true });
    as(preparer);
    expect(await savePayItem({ runId, employeeId: a, runLineId: (await runLineOf(runId, a)).id, type: "fte", value: "0.5" })).toMatchObject({ ok: true });
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    as(approver);
    expect(await approveRun({ runId, expectedHash: hash })).toEqual({ ok: false, error: "This payroll changed. Reload and review it again." });
    const fresh = (await sheetOf(runId, approver)).expectedHash!;
    expect(fresh).not.toBe(hash);
    expect(await approveRun({ runId, expectedHash: fresh })).toMatchObject({ ok: true });
    expect((await payloadOf(runId, internal)).perFte).toEqual({ totalFteHundredths: 50 });
  });
});
