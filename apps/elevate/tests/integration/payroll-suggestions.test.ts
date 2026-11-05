import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Real-database test: suggested amounts from approved hours. Invented names and figures only. Periods are in 2023, lines end that year and no settings are added (the starting row has no extra-hours rates), clear
// of the 2025 periods and the open-ended lines the other payroll test files leave in the same throwaway database.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { createPayLine, createPayRun, refreshSuggestions, confirmSuggestion, assignSuggestion } = await import("@/modules/payroll/actions");
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
  const r = await createPayLine({ employeeId, hoursPerDay: 8, fte: "1", paymentMethod: "remitly", effectiveFrom: "2023-01-01", endsOn: "2023-12-31", monthly: "22,000", pesoAllowance: "0", dollarAllowance: "0", ...over });
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
}
async function newRun(who: unknown, month: number) {
  current.user = who;
  const p = String(month).padStart(2, "0");
  const r = await createPayRun({ periodStart: `2023-${p}-01`, periodEnd: `2023-${p}-28` });
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}

type Day = { date: string; worked?: number; scheduled?: number | null; late?: number; early?: number; extra?: number; approvedExtra?: number; flags?: string[]; sessions?: number };
async function addDay(employeeId: string, d: Day, approvedBy: string | null) {
  const scheduled = d.scheduled === undefined ? 480 : d.scheduled;
  const worked = d.worked ?? 0;
  const flags = `{${(d.flags ?? []).join(",")}}`;
  await db.execute(sql`insert into time.attendance_days (employee_id, date, sessions, worked_minutes, scheduled_minutes, late_minutes, early_leave_minutes, extra_minutes, approved_extra_minutes, flags)
    values (${employeeId}, ${d.date}, ${d.sessions ?? (worked > 0 ? 1 : 0)}, ${worked}, ${scheduled}, ${d.late ?? 0}, ${d.early ?? 0}, ${d.extra ?? 0}, ${d.approvedExtra ?? 0}, ${flags}::text[])`);
  if (approvedBy) {
    await db.execute(sql`insert into time.hours_approvals (employee_id, date, scheduled_minutes, worked_minutes, break_minutes, extra_minutes, approved_extra_minutes, approved_by)
      values (${employeeId}, ${d.date}, ${scheduled}, ${worked}, 0, ${d.extra ?? 0}, ${d.approvedExtra ?? 0}, ${approvedBy})`);
  }
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
const runLines = (runId: string, employeeId: string) =>
  rows<{ id: string; payload_enc: string }>(sql`select id, payload_enc from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId} order by alias, id`);
const netOf = async (runId: string, employeeId: string) => {
  const l = (await runLines(runId, employeeId))[0];
  return decryptRunLine(l.id, l.payload_enc).result.net;
};

let preparer: Awaited<ReturnType<typeof account>>;
let lead: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  preparer = await account();
  lead = await account(null);
  current.user = preparer;
});

describe("refreshing suggestions", () => {
  it("writes suggested items from approved days only, and pay does not change until one is confirmed", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    await addDay(emp, { date: "2023-03-02", flags: ["absent"] }, lead.id);
    await addDay(emp, { date: "2023-03-03", worked: 450, late: 20, early: 10 }, lead.id);
    await addDay(emp, { date: "2023-03-04", worked: 540, extra: 60, approvedExtra: 45 }, lead.id);
    await addDay(emp, { date: "2023-03-05", worked: 400, late: 99 }, null); // not approved: a warning, never an amount
    const runId = await newRun(preparer, 3);
    const before = await netOf(runId, emp);

    current.user = preparer;
    expect(await refreshSuggestions({ runId })).toMatchObject({ ok: true, data: { written: 3 } });
    const found = await suggestions(runId, emp);
    const line = (await runLines(runId, emp))[0];
    expect(Object.fromEntries(found.map((s) => [s.type, s.value]))).toEqual({ absence_days: 100n, late_minutes: 30n, extra_regular: 45n });
    expect(found.every((s) => s.runLineId === line.id)).toBe(true);
    expect(await netOf(runId, emp)).toBe(before);

    const sheet = (await getWorksheet(runId))!;
    expect(sheet.checks.warnings.find((c) => c.employeeId === emp && c.code === "unapproved_days")!.detail).toBe("1");
    expect(sheet.checks.warnings.some((c) => c.employeeId === emp && c.code === "pending_suggestions")).toBe(true);
    expect(sheet.checks.blocking.some((c) => c.code === "unassigned_suggestion")).toBe(false);

    // Unchanged numbers add no rows.
    const rowsBefore = await count(runId, emp);
    expect(await refreshSuggestions({ runId })).toMatchObject({ ok: true, data: { written: 0 } });
    expect(await count(runId, emp)).toBe(rowsBefore);
  });

  it("never overwrites a confirmed item, and a confirmed absence is deducted only after confirming", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    await addDay(emp, { date: "2023-04-02", flags: ["absent"] }, lead.id);
    await addDay(emp, { date: "2023-04-03", worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, 4);
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
    await addDay(emp, { date: "2023-04-06", flags: ["absent"] }, lead.id);
    const rowsBefore = (await itemRows(runId, emp)).filter((r) => r.type === "absence_days").length;
    expect(await refreshSuggestions({ runId })).toMatchObject({ ok: true });
    expect((await itemRows(runId, emp)).filter((r) => r.type === "absence_days")).toHaveLength(rowsBefore);
    expect(decryptItemValue(confirmedRows[0].id, confirmedRows[0].value_enc).value).toBe(100n);
  });

  it("changing a confirmed amount away from the suggestion needs a reason", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    await addDay(emp, { date: "2023-05-04", worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, 5);
    current.user = preparer;
    await refreshSuggestions({ runId });
    const s = (await suggestions(runId, emp))[0];
    const line = (await runLines(runId, emp))[0];
    expect((await confirmSuggestion({ runId, itemId: s.id, runLineId: line.id, value: "15" })).ok).toBe(false);
    expect(await confirmSuggestion({ runId, itemId: s.id, runLineId: line.id, value: "15", reason: "Agreed with lead" })).toMatchObject({ ok: true });
  });

  it("removes a suggestion whose day changed after approval, and gives a person with no attendance nothing and no error", async () => {
    const emp = await person();
    const idle = await person();
    await giveLine(preparer, emp);
    await giveLine(preparer, idle);
    await addDay(emp, { date: "2023-06-02", worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, 6);
    current.user = preparer;
    expect(await refreshSuggestions({ runId })).toMatchObject({ ok: true });
    expect(await suggestions(runId, emp)).toHaveLength(1);
    expect(await count(runId, idle)).toBe(0);

    await db.execute(sql`update time.attendance_days set worked_minutes = 400 where employee_id = ${emp} and date = '2023-06-02'`);
    expect(await refreshSuggestions({ runId })).toMatchObject({ ok: true });
    const last = (await itemRows(runId, emp)).at(-1)!;
    expect(last.state).toBe("dismissed");
    expect(await suggestions(runId, emp)).toHaveLength(1); // the old suggested row is still in the history
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.lines.find((l) => l.employeeId === emp)!.items.filter((i) => i.state === "suggested")).toHaveLength(0);
  });

  it("uses the client's holiday calendar for holiday work", async () => {
    const emp = await person();
    const [client] = await rows<{ id: string }>(sql`insert into core.clients (name, holiday_calendar) values (${uniq("Client US ")}, 'US') returning id`);
    await giveLine(preparer, emp, { clientId: client.id });
    await db.execute(sql`insert into time.holidays (calendar, date, name, kind, verified) values ('US', '2023-07-03', ${uniq("Test day ")}, 'federal', true)`);
    await addDay(emp, { date: "2023-07-03", worked: 300, extra: 300, approvedExtra: 300 }, lead.id);
    await addDay(emp, { date: "2023-07-06", worked: 560, extra: 80, approvedExtra: 80 }, lead.id);
    const runId = await newRun(preparer, 7);
    current.user = preparer;
    await refreshSuggestions({ runId });
    expect(Object.fromEntries((await suggestions(runId, emp)).map((s) => [s.type, s.value]))).toEqual({ extra_holiday: 300n, extra_regular: 80n });
  });
});

describe("a person with two lines", () => {
  it("gets unassigned suggestions that block submission until a line is chosen, and assigning clears the check", async () => {
    const emp = await person();
    await giveLine(preparer, emp, { alias: "Front desk" });
    await giveLine(preparer, emp, { alias: "Night shift", fte: "0.5" });
    await addDay(emp, { date: "2023-08-03", worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, 8);
    current.user = preparer;
    await refreshSuggestions({ runId });

    const [s] = await suggestions(runId, emp);
    expect(s.runLineId).toBeNull();
    let sheet = (await getWorksheet(runId))!;
    expect(sheet.checks.blocking.filter((c) => c.employeeId === emp).map((c) => c.code)).toContain("unassigned_suggestion");
    expect(sheet.unassigned.find((u) => u.employeeId === emp)!.items).toHaveLength(1);

    const [first] = await runLines(runId, emp);
    // A refresh does not write the same amount again, assigned or not.
    const rowsBefore = await count(runId, emp);
    await refreshSuggestions({ runId });
    expect(await count(runId, emp)).toBe(rowsBefore);

    expect(await assignSuggestion({ runId, itemId: s.id, runLineId: first.id })).toMatchObject({ ok: true });
    sheet = (await getWorksheet(runId))!;
    expect(sheet.checks.blocking.filter((c) => c.employeeId === emp).map((c) => c.code)).not.toContain("unassigned_suggestion");
    expect(sheet.unassigned.find((u) => u.employeeId === emp)).toBeUndefined();
    expect(sheet.lines.find((l) => l.runLineId === first.id)!.items.filter((i) => i.state === "suggested")).toHaveLength(1);

    const afterAssign = await count(runId, emp);
    await refreshSuggestions({ runId });
    expect(await count(runId, emp)).toBe(afterAssign);
    // It cannot be assigned twice, and the old row is no longer the newest.
    expect((await assignSuggestion({ runId, itemId: s.id, runLineId: first.id })).ok).toBe(false);
  });

  it("confirming an unassigned suggestion on a line assigns it and changes that line's pay", async () => {
    const emp = await person();
    await giveLine(preparer, emp, { alias: "A line" });
    await giveLine(preparer, emp, { alias: "B line" });
    await addDay(emp, { date: "2023-09-02", worked: 450, late: 60 }, lead.id);
    const runId = await newRun(preparer, 9);
    current.user = preparer;
    await refreshSuggestions({ runId });
    const [s] = await suggestions(runId, emp);
    const [a, b] = await runLines(runId, emp);
    const before = decryptRunLine(b.id, b.payload_enc).result.net;

    expect(await confirmSuggestion({ runId, itemId: s.id, runLineId: b.id })).toMatchObject({ ok: true });
    const lines = await runLines(runId, emp);
    expect(decryptRunLine(lines[1].id, lines[1].payload_enc).result.net).toBeLessThan(before);
    expect(decryptRunLine(lines[0].id, lines[0].payload_enc).result.late).toBe(decryptRunLine(a.id, a.payload_enc).result.late);
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.checks.blocking.some((c) => c.employeeId === emp && c.code === "unassigned_suggestion")).toBe(false);
  });

  it("a person with a single line never gets an unassigned suggestion", async () => {
    const emp = await person();
    await giveLine(preparer, emp);
    await addDay(emp, { date: "2023-10-02", worked: 450, late: 30 }, lead.id);
    const runId = await newRun(preparer, 10);
    current.user = preparer;
    await refreshSuggestions({ runId });
    expect((await itemRows(runId, emp)).every((r) => r.run_line_id !== null)).toBe(true);
  });
});

describe("authorization and stale requests", () => {
  it("refuses people without the Preparer level and a bad request", async () => {
    const viewer = await account("viewer");
    const emp = await person();
    await giveLine(preparer, emp);
    const runId = await newRun(preparer, 11);
    current.user = viewer;
    await expect(refreshSuggestions({ runId })).resolves.toMatchObject({ ok: false });
    current.user = preparer;
    expect((await refreshSuggestions({ runId: "nope" })).ok).toBe(false);
  });
});
