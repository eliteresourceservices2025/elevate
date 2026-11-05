import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: suggested amounts from approved hours. Invented names and figures only.
// Each run gets its own half-month of 2026 (all before today), so no two runs overlap; the pay lines this file makes are ended
// afterwards by the shared helper.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { createPayLine, savePaySettings, createPayRun, refreshSuggestions, confirmSuggestion, assignSuggestion, dismissPayItem } = await import("@/modules/payroll/actions");
const { getWorksheet } = await import("@/modules/payroll/queries");
const { decryptItemValue, decryptRunLine } = await import("@/modules/payroll/service");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function account(level: string | null = "preparer") {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("sugg")}@example.com`}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  return { id, email: `${id}@example.com`, roles: ["employee"], payrollAccess: level };
}
async function person() {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status)
    values ('Ana', ${uniq("Testreyes")}, ${`${uniq("emp")}@example.com`}, 'active') returning id`);
  return e.id;
}
async function giveLine(who: unknown, employeeId: string, over: Record<string, unknown> = {}) {
  current.user = who;
  const r = await createPayLine({ employeeId, hoursPerDay: 8, fte: "1", paymentMethod: "remitly", effectiveFrom: "2023-01-01", monthly: "22,000", pesoAllowance: "0", dollarAllowance: "0", ...over });
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
}

/** Slot n is a cutoff of 2026: 0 = Jan 1-15, 1 = Jan 16-31, 2 = Feb 1-15 ... 19 = Oct 16-31. `day(i)` is the i-th day of it. */
function slot(n: number) {
  const month = Math.floor(n / 2) + 1;
  const mm = String(month).padStart(2, "0");
  const first = n % 2 === 0 ? 1 : 16;
  const at = (i: number) => `2026-${mm}-${String(first + i - 1).padStart(2, "0")}`;
  const last = n % 2 === 0 ? 15 : new Date(Date.UTC(2026, month, 0)).getUTCDate();
  return { periodStart: at(1), periodEnd: `2026-${mm}-${String(last).padStart(2, "0")}`, day: at };
}
async function newRun(who: unknown, period: { periodStart: string; periodEnd: string }) {
  current.user = who;
  const r = await createPayRun({ periodStart: period.periodStart, periodEnd: period.periodEnd });
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}

type Day = { date: string; worked?: number; scheduled?: number | null; late?: number; early?: number; extra?: number; approvedExtra?: number; flags?: string[]; sessions?: number };
async function approve(employeeId: string, date: string, approvedBy: string) {
  await db.execute(sql`insert into time.hours_approvals (employee_id, date, scheduled_minutes, worked_minutes, break_minutes, extra_minutes, approved_extra_minutes, approved_by)
    select employee_id, date, scheduled_minutes, worked_minutes, break_minutes, extra_minutes, approved_extra_minutes, ${approvedBy}::uuid
    from time.attendance_days where employee_id = ${employeeId} and date = ${date}`);
}
async function addDay(employeeId: string, d: Day, approvedBy: string | null) {
  const scheduled = d.scheduled === undefined ? 480 : d.scheduled;
  const worked = d.worked ?? 0;
  const flags = `{${(d.flags ?? []).join(",")}}`;
  await db.execute(sql`insert into time.attendance_days (employee_id, date, sessions, worked_minutes, scheduled_minutes, late_minutes, early_leave_minutes, extra_minutes, approved_extra_minutes, flags)
    values (${employeeId}, ${d.date}, ${d.sessions ?? (worked > 0 ? 1 : 0)}, ${worked}, ${scheduled}, ${d.late ?? 0}, ${d.early ?? 0}, ${d.extra ?? 0}, ${d.approvedExtra ?? 0}, ${flags}::text[])`);
  if (approvedBy) await approve(employeeId, d.date, approvedBy);
}

const itemRows = (runId: string, employeeId: string) =>
  rows<{ id: string; run_line_id: string | null; type: string; state: string; value_enc: string }>(
    sql`select id, run_line_id, type, state, value_enc from payroll.pay_run_items where run_id = ${runId} and employee_id = ${employeeId} order by created_at, id`,
  );
const count = async (runId: string, employeeId: string) => (await itemRows(runId, employeeId)).length;
const suggestions = async (runId: string, employeeId: string) => {
  const all = await itemRows(runId, employeeId);
  return all.filter((r) => r.state === "suggested").map((r) => ({ id: r.id, runLineId: r.run_line_id, type: r.type, value: decryptItemValue(r.id, r.value_enc).value }));
};
const byType = (list: { type: string; value: bigint }[]) => Object.fromEntries(list.map((s) => [s.type, s.value]));
const runLines = (runId: string, employeeId: string) =>
  rows<{ id: string; payload_enc: string }>(sql`select id, payload_enc from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId} order by alias, id`);
const netOf = async (runId: string, employeeId: string, index = 0) => {
  const l = (await runLines(runId, employeeId))[index];
  return decryptRunLine(l.id, l.payload_enc).result.net;
};
const blockingFor = async (runId: string, employeeId: string) => (await getWorksheet(runId))!.checks.blocking.filter((c) => c.employeeId === employeeId).map((c) => c.code);

let preparer: Awaited<ReturnType<typeof account>>;
let lead: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  preparer = await account();
  lead = await account(null);
  // Extra-hours rates from 2026, so these periods price extra hours; earlier periods (2024) see the starting row with none.
  current.user = preparer;
  const saved = await savePaySettings({ effectiveFrom: "2026-01-01", cutoffDivisor: 11, changeWarnPercent: 10, extraRegular: "125", extraHoliday: "200", extraRestDay: "130", extraRestDayOver8: "169", holiday: "100", reason: "Test rates" });
  expect(saved.ok).toBe(true);
});

describe("refreshing suggestions", () => {
  it("writes suggested items from approved days only, and pay does not change until one is confirmed", async () => {
    const p = slot(0);
    const emp = await person();
    await giveLine(preparer, emp);
    await addDay(emp, { date: p.day(2), flags: ["absent"] }, lead.id);
    await addDay(emp, { date: p.day(3), worked: 450, late: 20, early: 10 }, lead.id);
    await addDay(emp, { date: p.day(4), worked: 540, extra: 60, approvedExtra: 45 }, lead.id);
    await addDay(emp, { date: p.day(5), worked: 400, late: 99 }, null); // not approved: a warning, never an amount
    const runId = await newRun(preparer, p);
    const before = await netOf(runId, emp);

    current.user = preparer;
    expect(await refreshSuggestions({ runId })).toMatchObject({ ok: true, data: { written: 3 } });
    const found = await suggestions(runId, emp);
    const line = (await runLines(runId, emp))[0];
    expect(byType(found)).toEqual({ absence_days: 100n, late_minutes: 30n, extra_regular: 45n });
    expect(found.every((s) => s.runLineId === line.id)).toBe(true);
    expect(await netOf(runId, emp)).toBe(before);

    const sheet = (await getWorksheet(runId))!;
    expect(sheet.checks.warnings.find((c) => c.employeeId === emp && c.code === "unapproved_days")!.detail).toBe("1");
    expect(sheet.checks.warnings.some((c) => c.employeeId === emp && c.code === "pending_suggestions")).toBe(true);
    expect(await blockingFor(runId, emp)).not.toContain("unassigned_suggestion");

    // Unchanged numbers add no rows.
    const rowsBefore = await count(runId, emp);
    expect(await refreshSuggestions({ runId })).toMatchObject({ ok: true, data: { written: 0 } });
    expect(await count(runId, emp)).toBe(rowsBefore);
  });

  it("never overwrites a confirmed item, and an absence is deducted only after confirming", async () => {
    const p = slot(1);
    const emp = await person();
    await giveLine(preparer, emp);
    await addDay(emp, { date: p.day(2), flags: ["absent"] }, lead.id);
    await addDay(emp, { date: p.day(3), worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, p);
    const before = await netOf(runId, emp);
    current.user = preparer;
    await refreshSuggestions({ runId });
    const absence = (await suggestions(runId, emp)).find((s) => s.type === "absence_days")!;
    const line = (await runLines(runId, emp))[0];

    expect(await confirmSuggestion({ runId, itemId: absence.id, runLineId: line.id })).toMatchObject({ ok: true });
    expect(await netOf(runId, emp)).toBe(before - 100_000n); // one day: 22,000 / 22 = 1,000.00
    const confirmedRows = (await itemRows(runId, emp)).filter((r) => r.type === "absence_days" && r.state === "confirmed");
    expect(confirmedRows).toHaveLength(1);

    // More absences get approved; the confirmed amount stays as it is and the refresh adds no absence row.
    await addDay(emp, { date: p.day(6), flags: ["absent"] }, lead.id);
    const rowsBefore = (await itemRows(runId, emp)).filter((r) => r.type === "absence_days").length;
    expect(await refreshSuggestions({ runId })).toMatchObject({ ok: true });
    expect((await itemRows(runId, emp)).filter((r) => r.type === "absence_days")).toHaveLength(rowsBefore);
    expect(decryptItemValue(confirmedRows[0].id, confirmedRows[0].value_enc).value).toBe(100n);
  });

  it("changing a confirmed amount away from the suggestion needs a reason", async () => {
    const p = slot(2);
    const emp = await person();
    await giveLine(preparer, emp);
    await addDay(emp, { date: p.day(2), worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    await refreshSuggestions({ runId });
    const s = (await suggestions(runId, emp))[0];
    const line = (await runLines(runId, emp))[0];
    expect((await confirmSuggestion({ runId, itemId: s.id, runLineId: line.id, value: "15" })).ok).toBe(false);
    expect(await confirmSuggestion({ runId, itemId: s.id, runLineId: line.id, value: "15", reason: "Agreed with lead" })).toMatchObject({ ok: true });
  });

  it("removes a suggestion whose day changed after approval, and gives a person with no attendance nothing and no error", async () => {
    const p = slot(3);
    const emp = await person();
    const idle = await person();
    await giveLine(preparer, emp);
    await giveLine(preparer, idle);
    await addDay(emp, { date: p.day(2), worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    expect(await refreshSuggestions({ runId })).toMatchObject({ ok: true });
    expect(await suggestions(runId, emp)).toHaveLength(1);
    expect(await count(runId, idle)).toBe(0);

    await db.execute(sql`update time.attendance_days set worked_minutes = 400 where employee_id = ${emp} and date = ${p.day(2)}`);
    expect(await refreshSuggestions({ runId })).toMatchObject({ ok: true });
    expect((await itemRows(runId, emp)).at(-1)!.state).toBe("dismissed");
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.lines.find((l) => l.employeeId === emp)!.items.filter((i) => i.state === "suggested")).toHaveLength(0);
  });

  it("does not bring back a suggestion a Preparer removed, but does when the amount changes", async () => {
    const p = slot(4);
    const emp = await person();
    await giveLine(preparer, emp);
    await addDay(emp, { date: p.day(2), worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    await refreshSuggestions({ runId });
    const s = (await suggestions(runId, emp))[0];
    expect(await dismissPayItem({ runId, itemId: s.id, reason: "Agreed it was fine" })).toMatchObject({ ok: true });
    const rowsBefore = await count(runId, emp);
    await refreshSuggestions({ runId });
    expect(await count(runId, emp)).toBe(rowsBefore);

    await addDay(emp, { date: p.day(3), worked: 450, late: 15 }, lead.id);
    await refreshSuggestions({ runId });
    expect((await suggestions(runId, emp)).at(-1)!.value).toBe(45n);
  });
});

describe("holidays and rest days", () => {
  it("uses the client's calendar for a person assigned to that client", async () => {
    const p = slot(5);
    const emp = await person();
    const [client] = await rows<{ id: string }>(sql`insert into core.clients (name, holiday_calendar) values (${uniq("Client US ")}, 'US') returning id`);
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${emp}, ${client.id}, '2025-01-01')`);
    await giveLine(preparer, emp, { clientId: client.id });
    await db.execute(sql`insert into time.holidays (calendar, date, name, kind, verified) values ('US', ${p.day(2)}, ${uniq("Test day ")}, 'federal', true)`);
    await addDay(emp, { date: p.day(2), worked: 300, extra: 300, approvedExtra: 300 }, lead.id);
    await addDay(emp, { date: p.day(3), worked: 560, extra: 80, approvedExtra: 80 }, lead.id);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    await refreshSuggestions({ runId });
    expect(byType(await suggestions(runId, emp))).toEqual({ extra_holiday: 300n, extra_regular: 80n });
  });

  it("counts a Philippine holiday on a US client's person's day too, as the nightly rebuild does", async () => {
    const p = slot(6);
    const emp = await person();
    const [client] = await rows<{ id: string }>(sql`insert into core.clients (name, holiday_calendar) values (${uniq("Client US ")}, 'US') returning id`);
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${emp}, ${client.id}, '2025-01-01')`);
    await giveLine(preparer, emp, { clientId: client.id });
    await db.execute(sql`insert into time.holidays (calendar, date, name, kind, verified) values ('PH', ${p.day(2)}, ${uniq("Test day ")}, 'regular', true)`);
    await addDay(emp, { date: p.day(2), worked: 240, extra: 240, approvedExtra: 240 }, lead.id);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    await refreshSuggestions({ runId });
    expect(byType(await suggestions(runId, emp))).toEqual({ extra_holiday: 240n });
  });

  it("splits a rest day at 8 hours, prices each part with the settings, and blocks when a rate is missing", async () => {
    const p = slot(7);
    const emp = await person();
    await giveLine(preparer, emp);
    await addDay(emp, { date: p.day(2), scheduled: null, worked: 600, extra: 600, approvedExtra: 600 }, lead.id);
    await addDay(emp, { date: p.day(3), worked: 540, extra: 60, approvedExtra: 60 }, lead.id);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    await refreshSuggestions({ runId });
    expect(byType(await suggestions(runId, emp))).toEqual({ extra_regular: 60n, extra_rest_day: 480n, extra_rest_day_over_8: 120n });

    // Hourly rate 125.00: 1 hour at 125% = 156.25; 8 hours at 130% = 1,300.00; 2 hours at 169% = 422.50.
    const before = await netOf(runId, emp);
    const line = (await runLines(runId, emp))[0];
    for (const s of await suggestions(runId, emp)) expect(await confirmSuggestion({ runId, itemId: s.id, runLineId: line.id })).toMatchObject({ ok: true });
    expect(await netOf(runId, emp)).toBe(before + 15_625n + 130_000n + 42_250n);
    expect(await blockingFor(runId, emp)).not.toContain("missing_multiplier");
  });

  it("with no rate set for the period, a confirmed extra-hours amount blocks the run and adds no pay", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    // June 2024 is before the first rates: the starting settings have none.
    await addDay(emp, { date: "2024-06-04", worked: 540, extra: 60, approvedExtra: 60 }, lead.id);
    const runId = await newRun(preparer, { periodStart: "2024-06-01", periodEnd: "2024-06-15" });
    current.user = preparer;
    await refreshSuggestions({ runId });
    const s = (await suggestions(runId, emp))[0];
    const line = (await runLines(runId, emp))[0];
    const before = await netOf(runId, emp);
    expect(await confirmSuggestion({ runId, itemId: s.id, runLineId: line.id })).toMatchObject({ ok: true });
    expect(await netOf(runId, emp)).toBe(before);
    expect(await blockingFor(runId, emp)).toContain("missing_multiplier");
  });
});

describe("a person with two lines", () => {
  it("gets unassigned suggestions that block submission until a line is chosen, and assigning clears the check", async () => {
    const p = slot(8);
    const emp = await person();
    await giveLine(preparer, emp, { alias: "Front desk" });
    await giveLine(preparer, emp, { alias: "Night shift", fte: "0.5" });
    await addDay(emp, { date: p.day(2), worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    await refreshSuggestions({ runId });

    const [s] = await suggestions(runId, emp);
    expect(s.runLineId).toBeNull();
    let sheet = (await getWorksheet(runId))!;
    expect(await blockingFor(runId, emp)).toContain("unassigned_suggestion");
    expect(sheet.unassigned.find((u) => u.employeeId === emp)!.items).toHaveLength(1);

    const [first] = await runLines(runId, emp);
    const rowsBefore = await count(runId, emp);
    await refreshSuggestions({ runId });
    expect(await count(runId, emp)).toBe(rowsBefore);

    expect(await assignSuggestion({ runId, itemId: s.id, runLineId: first.id })).toMatchObject({ ok: true });
    sheet = (await getWorksheet(runId))!;
    expect(await blockingFor(runId, emp)).not.toContain("unassigned_suggestion");
    expect(sheet.unassigned.find((u) => u.employeeId === emp)).toBeUndefined();
    expect(sheet.lines.find((l) => l.runLineId === first.id)!.items.filter((i) => i.state === "suggested")).toHaveLength(1);

    const afterAssign = await count(runId, emp);
    await refreshSuggestions({ runId });
    expect(await count(runId, emp)).toBe(afterAssign);
    expect((await assignSuggestion({ runId, itemId: s.id, runLineId: first.id })).ok).toBe(false);
  });

  it("suggests again when an assigned amount went away and then came back", async () => {
    const p = slot(9);
    const emp = await person();
    await giveLine(preparer, emp, { alias: "A line" });
    await giveLine(preparer, emp, { alias: "B line" });
    const date = p.day(2);
    await addDay(emp, { date, worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    await refreshSuggestions({ runId });
    const [first] = await runLines(runId, emp);
    const [s] = await suggestions(runId, emp);
    expect(await assignSuggestion({ runId, itemId: s.id, runLineId: first.id })).toMatchObject({ ok: true });

    // The day changes after approval: the suggestion on the line is taken away.
    await db.execute(sql`update time.attendance_days set worked_minutes = 400 where employee_id = ${emp} and date = ${date}`);
    await refreshSuggestions({ runId });
    expect((await getWorksheet(runId))!.lines.find((l) => l.runLineId === first.id)!.items.filter((i) => i.state === "suggested")).toHaveLength(0);

    // It is approved again with the same late minutes: the suggestion comes back (unassigned again, the person has two lines).
    await approve(emp, date, lead.id);
    expect(await refreshSuggestions({ runId })).toMatchObject({ ok: true, data: { written: 1 } });
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.unassigned.find((u) => u.employeeId === emp)!.items.map((i) => i.value)).toEqual(["30"]);
    expect(await blockingFor(runId, emp)).toContain("unassigned_suggestion");
  });

  it("confirming an unassigned suggestion on a line assigns it and changes that line's pay only", async () => {
    const p = slot(10);
    const emp = await person();
    await giveLine(preparer, emp, { alias: "A line" });
    await giveLine(preparer, emp, { alias: "B line" });
    await addDay(emp, { date: p.day(2), worked: 450, late: 60 }, lead.id);
    await addDay(emp, { date: p.day(3), worked: 540, extra: 60, approvedExtra: 60 }, lead.id);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    await refreshSuggestions({ runId });
    const found = await suggestions(runId, emp);
    const lateItem = found.find((x) => x.type === "late_minutes")!;
    const [a, b] = await runLines(runId, emp);
    const netA = decryptRunLine(a.id, a.payload_enc).result.net;
    const netB = decryptRunLine(b.id, b.payload_enc).result.net;

    expect(await confirmSuggestion({ runId, itemId: lateItem.id, runLineId: b.id })).toMatchObject({ ok: true });
    expect(await netOf(runId, emp, 1)).toBeLessThan(netB);
    expect(await netOf(runId, emp, 0)).toBe(netA);
    const sheet = (await getWorksheet(runId))!;
    // The extra-hours suggestion was not confirmed, so it is still waiting and still needs a line.
    expect(await blockingFor(runId, emp)).toEqual(["unassigned_suggestion"]);
    expect(sheet.unassigned.find((u) => u.employeeId === emp)!.items.map((i) => i.type)).toEqual(["extra_regular"]);

    // What the code does with an amount confirmed on one line: the amount is the person's, so it now sits on that line alone.
    // A refresh leaves the other line without a suggestion of that type, and with no pay change.
    const rowsBefore = await count(runId, emp);
    await refreshSuggestions({ runId });
    expect(await count(runId, emp)).toBe(rowsBefore);
    const lines = (await getWorksheet(runId))!.lines.filter((l) => l.employeeId === emp);
    const lineA = lines.find((l) => l.runLineId === a.id)!;
    expect(lineA.items.filter((i) => i.type === "late_minutes")).toHaveLength(0);
    expect(await netOf(runId, emp, 0)).toBe(netA);
  });

  it("a person with a single line never gets an unassigned suggestion", async () => {
    const p = slot(11);
    const emp = await person();
    await giveLine(preparer, emp);
    await addDay(emp, { date: p.day(2), worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, p);
    current.user = preparer;
    await refreshSuggestions({ runId });
    expect((await itemRows(runId, emp)).every((r) => r.run_line_id !== null)).toBe(true);
  });
});

describe("authorization and stale requests", () => {
  it("refuses people without the Preparer level and a bad request", async () => {
    const p = slot(12);
    const viewer = await account("viewer");
    const emp = await person();
    await giveLine(preparer, emp);
    const runId = await newRun(preparer, p);
    current.user = viewer;
    await expect(refreshSuggestions({ runId })).resolves.toMatchObject({ ok: false });
    current.user = preparer;
    expect((await refreshSuggestions({ runId: "nope" })).ok).toBe(false);
  });
});
