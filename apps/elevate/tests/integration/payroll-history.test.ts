import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: the payroll change history. Invented names and figures only. Every period is in 2030; only the clock (Date) is
// moved to the end of 2030 (a payment can't be dated after today) and it is restored after the file.
//
// The first describe is the completeness test: one full cycle through the real actions, then the set of distinct `action` values in
// `pay_change_log` must equal CHANGE_ACTIONS, so a flow that forgot `logChange` fails here.

const current = vi.hoisted(() => ({ user: null as unknown, decrypts: 0, failNames: false }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => true) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));
// Counts every detail that is decrypted, so a test can prove only the rows of the requested page are opened.
vi.mock("@/modules/payroll/changes", async (original) => {
  const actual = await original<typeof import("@/modules/payroll/changes")>();
  return {
    ...actual,
    readChangeDetail: (row: Parameters<typeof actual.readChangeDetail>[0]) => {
      current.decrypts++;
      return actual.readChangeDetail(row);
    },
  };
});

// A switch that makes the name lookups fail, to prove the audit row is written before them.
vi.mock("@/modules/payroll/remitly", async (original) => {
  const actual = await original<typeof import("@/modules/payroll/remitly")>();
  return {
    ...actual,
    personName: (r: Parameters<typeof actual.personName>[0]) => {
      if (current.failNames) throw new Error("name lookup failed");
      return actual.personName(r);
    },
  };
});

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const actions = await import("@/modules/payroll/actions");
const { createPayLine, updatePayLine, endPayLine, withdrawPayLine, savePaySettings, createPayRun, cancelPayRun, savePayItem, dismissPayItem, confirmRunLine } = actions;
const { markRunAsTest, archivePayRun, restorePayRun, releaseStatements } = actions;
const { updateRunPeople, removePersonFromRun, restorePersonToRun, applyJibbleTimesheet, confirmAllSuggestions } = actions;
const { saveTimesheetUpload } = await import("@/modules/payroll/timesheet-import");
const { refreshSuggestions, confirmSuggestion, assignSuggestion, submitRun, sendBackRun, approveRun, exportRemitlyList, markPaid } = actions;
const { setPayrollAccess } = await import("@/modules/settings/actions");
const { getWorksheet } = await import("@/modules/payroll/queries");
const { getPayrollHistory, getHistoryFilterOptions } = await import("@/modules/payroll/history-queries");
const { listAuditEntries } = await import("@/modules/settings/queries");
const { CHANGE_ACTIONS, CHANGE_ACTION_LABELS } = await import("@/modules/payroll/constants");
const { GET: downloadPayslip } = await import("@/app/api/payroll/payslips/[runId]/route");

type Row = Record<string, unknown>;
type Level = "preparer" | "approver" | "viewer" | null;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let seq = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}x${seq++}`;

async function account(level: Level = null, role = "employee", name?: { first: string; last: string }) {
  const id = randomUUID();
  const email = `${uniq("hist")}@example.com`;
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${email}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  if (name) {
    await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${name.first}, ${name.last}, ${`${uniq("w")}@example.com`}, 'active', ${id})`);
  }
  return { id, email, roles: [role], payrollAccess: level };
}
async function person(last: string, userId: string | null = null) {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values ('Liza', ${last}, ${`${uniq("emp")}@example.com`}, 'active', ${userId}) returning id`);
  return e.id;
}
/**
 * Period `n`: the second cutoff (16th to the last day) of month n + 10 of 2030 (October, November). The schema test inserts runs
 * starting on the first or second day of every month of 2030, 15 days long (up to the 16th of January to July), and the leaver's line
 * below is paid in August and September, so these periods meet neither.
 */
function slot(n: number) {
  const month = n + 10;
  const mm = String(month).padStart(2, "0");
  const at = (i: number) => `2030-${mm}-${String(16 + i).padStart(2, "0")}`;
  return { periodStart: at(0), periodEnd: `2030-${mm}-${new Date(Date.UTC(2030, month, 0)).getUTCDate()}`, day: at };
}
const as = (who: unknown) => {
  current.user = who;
};
const ok = <T extends { ok: boolean }>(r: T, what: string): T => {
  if (!r.ok) throw new Error(`${what} failed: ${JSON.stringify(r)}`);
  return r;
};

async function addApprovedDay(employeeId: string, date: string, d: { worked?: number; late?: number; absent?: boolean }, approvedBy: string) {
  const flags = d.absent ? "{absent}" : "{}";
  await db.execute(sql`insert into time.attendance_days (employee_id, date, sessions, worked_minutes, scheduled_minutes, late_minutes, early_leave_minutes, extra_minutes, approved_extra_minutes, flags)
    values (${employeeId}, ${date}, ${d.worked ? 1 : 0}, ${d.worked ?? 0}, 480, ${d.late ?? 0}, 0, 0, 0, ${flags}::text[])`);
  await db.execute(sql`insert into time.hours_approvals (employee_id, date, scheduled_minutes, worked_minutes, break_minutes, extra_minutes, approved_extra_minutes, approved_by)
    select employee_id, date, scheduled_minutes, worked_minutes, break_minutes, extra_minutes, approved_extra_minutes, ${approvedBy}::uuid
    from time.attendance_days where employee_id = ${employeeId} and date = ${date}`);
}

// Distinctive figures and reasons, so the audit checks can search for them.
const MONTHLY_A = "31,415.92";
const MONTHLY_B = "27,182.81";
const SECRET_REASONS = ["Zqreason cost-of-living", "Zqreason promotion review", "Zqreason large advance", "Zqreason check lates", "Zqreason wrong day", "Zqreason draft not needed", "Zqreason left the team", "Zqreason not on this run"];
const SENT_BACK_NOTE = "Zqnote please look at the lates";

let superAdmin: Awaited<ReturnType<typeof account>>;
let preparer: Awaited<ReturnType<typeof account>>;
let checker: Awaited<ReturnType<typeof account>>;
let approver: Awaited<ReturnType<typeof account>>;
let viewer: Awaited<ReturnType<typeof account>>;
let lead: Awaited<ReturnType<typeof account>>;
let paidOwner: Awaited<ReturnType<typeof account>>;
let empA: string; // two lines, linked to an account (gets a payslip)
let empB: string; // one line
let empLeaver: string; // line created, changed and ended
let runId: string;
let draftRunId: string;
let lastNameA: string;
let lastNameB: string;
let cycleStart: string;
const reasonOf = (i: number) => SECRET_REASONS[i];

afterAll(() => {
  vi.useRealTimers();
});

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2030-12-30T12:00:00Z") });
  [{ t: cycleStart }] = await rows<{ t: string }>(sql`select clock_timestamp()::text as t`);
  superAdmin = await account(null, "super_admin", { first: "Maria", last: uniq("Adminreyes") });
  preparer = await account("preparer", "employee", { first: "Paolo", last: uniq("Preparerlim") });
  checker = await account("preparer", "employee", { first: "Carla", last: uniq("Checkerdizon") });
  approver = await account("approver", "employee", { first: "Ariel", last: uniq("Approvertan") });
  viewer = await account(null); // given the Viewer level in the cycle, by a Super Admin
  lead = await account(null);
  paidOwner = await account(null);
  lastNameA = uniq("Testreyes");
  lastNameB = uniq("Testsantos");
  empA = await person(lastNameA, paidOwner.id);
  empB = await person(lastNameB);
  empLeaver = await person(uniq("Testleaver"));
});

describe("the completeness test: one full cycle writes every kind of change", () => {
  it("produces exactly the set of actions in CHANGE_ACTIONS", async () => {
    // 1. Payroll access is chosen by a Super Admin.
    as(superAdmin);
    ok(await setPayrollAccess({ userId: viewer.id, level: "viewer" }), "access");
    viewer.payrollAccess = "viewer" as never;

    // 2. Settings.
    as(preparer);
    ok(
      await savePaySettings({
        effectiveFrom: "2029-11-01",
        cutoffDivisor: 11,
        changeWarnPercent: 10,
        extraRegular: "125",
        extraRestDay: "130",
        extraRestDayOver8: "169",
        reason: "Zqreason settings",
      }),
      "settings",
    );

    // 3. A line is created, changed and ended (a person who leaves).
    const created = ok(
      await createPayLine({ employeeId: empLeaver, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2030-08-01", monthly: "20,000" }),
      "create leaver line",
    );
    const leaverKey = (created as { data: { lineKey: string } }).data.lineKey;
    ok(
      await updatePayLine({ lineKey: leaverKey, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2030-09-01", monthly: "21,000", reason: reasonOf(0) }),
      "update leaver line",
    );
    ok(await endPayLine({ lineKey: leaverKey, endsOn: "2030-09-30", reason: reasonOf(6) }), "end leaver line");
    // A rate added by mistake is withdrawn (it was never on a real run).
    const mistake = ok(await createPayLine({ employeeId: empLeaver, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2030-12-01", monthly: "9,000" }), "create mistaken line");
    ok(await withdrawPayLine({ lineKey: (mistake as { data: { lineKey: string } }).data.lineKey, reason: "Added by mistake" }), "withdraw mistaken line");

    // 4. Lines for the cycle's run: A has two lines, B has one.
    const p = slot(0);
    for (const [emp, alias, monthly] of [
      [empA, "Front desk", MONTHLY_A],
      [empA, "Billing", "10,000"],
      [empB, null, MONTHLY_B],
    ] as const) {
      ok(
        await createPayLine({ employeeId: emp, alias, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: p.periodStart, endsOn: p.periodEnd, monthly }),
        "create line",
      );
    }
    for (const emp of [empA, empB]) {
      await addApprovedDay(emp, p.day(2), { worked: 450, late: 30 }, lead.id);
      await addApprovedDay(emp, p.day(3), { absent: true }, lead.id);
    }

    // 5. The run: created, suggestions, assignments and confirmations, items.
    const created2 = ok(await createPayRun({ periodStart: p.periodStart, periodEnd: p.periodEnd }), "create run");
    runId = (created2 as { data: { runId: string } }).data.runId;
    ok(await refreshSuggestions({ runId }), "refresh");

    const runLines = await rows<{ id: string; employee_id: string }>(sql`select id, employee_id from payroll.pay_run_lines where run_id = ${runId} order by employee_id, id`);
    const lineOf = (emp: string) => runLines.find((l) => l.employee_id === emp)!.id;
    const open = () =>
      rows<{ id: string; employee_id: string; run_line_id: string | null; type: string }>(
        sql`select distinct on (type, employee_id, coalesce(run_line_id::text, '')) id, employee_id, run_line_id, type from payroll.pay_run_items where run_id = ${runId} and state = 'suggested' order by type, employee_id, coalesce(run_line_id::text, ''), created_at desc`,
      );
    const suggestions = await open();
    const forA = suggestions.filter((s) => s.employee_id === empA && s.run_line_id === null);
    const forB = suggestions.filter((s) => s.employee_id === empB);
    expect(forA.length).toBeGreaterThanOrEqual(2);
    expect(forB.length).toBeGreaterThanOrEqual(1);
    // A: one suggestion is confirmed (assigns and confirms), the others are assigned to the line.
    ok(await confirmSuggestion({ runId, itemId: forA[0].id, runLineId: lineOf(empA) }), "confirm suggestion A");
    for (const s of forA.slice(1)) ok(await assignSuggestion({ runId, itemId: s.id, runLineId: lineOf(empA) }), "assign suggestion A");
    // B: suggestions already sit on the line; confirm each.
    for (const s of forB) ok(await confirmSuggestion({ runId, itemId: s.id, runLineId: lineOf(empB) }), "confirm suggestion B");

    ok(await savePayItem({ runId, employeeId: empB, runLineId: lineOf(empB), type: "loan", value: "2,000", reason: reasonOf(2) }), "save loan");
    const [loan] = await rows<{ id: string }>(sql`select id from payroll.pay_run_items where run_id = ${runId} and employee_id = ${empB} and type = 'loan' order by created_at desc limit 1`);
    ok(await dismissPayItem({ runId, itemId: loan.id, reason: reasonOf(4) }), "dismiss loan");
    // A named allowance: the history shows the name the Preparer gave it.
    ok(await savePayItem({ runId, employeeId: empA, runLineId: lineOf(empA), type: "allowance", label: "Zqhealth allowance", value: "1,234.56" }), "save allowance");

    // 5b. Draft run people: a line added to the period afterwards is pulled in, removed, brought back and removed again.
    const extraLine = ok(
      await createPayLine({ employeeId: empLeaver, alias: "Late hire", hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: p.periodStart, endsOn: p.periodEnd, monthly: "18,000" }),
      "create late line",
    );
    expect(extraLine).toBeTruthy();
    expect(await updateRunPeople({ runId })).toMatchObject({ ok: true, data: { added: 1, updated: 0, removed: 0 } });
    const [lateRunLine] = await rows<{ id: string }>(sql`select id from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${empLeaver}`);
    ok(await removePersonFromRun({ runId, runLineId: lateRunLine.id, reason: reasonOf(7) }), "remove person");
    ok(await restorePersonToRun({ runId, runLineId: lateRunLine.id }), "restore person");
    ok(await removePersonFromRun({ runId, runLineId: lateRunLine.id, reason: reasonOf(7) }), "remove person again");

    // 5c. A Jibble timesheet is uploaded and applied (matching nobody, so it writes nothing), then every suggestion is confirmed at once.
    const upload = await db.transaction((tx) => saveTimesheetUpload(tx, preparer as never, runId, { periodText: null, members: [{ code: uniq("HIST-"), name: "Hist Member", days: [] }] }));
    ok(await applyJibbleTimesheet({ runId, importId: upload.importId, assignments: [] }), "apply timesheet");
    ok(await confirmAllSuggestions({ runId }), "confirm all suggestions");

    // 6. Another Preparer checks every line; the run is sent for review, sent back, sent again and approved.
    as(checker);
    for (const l of runLines) ok(await confirmRunLine({ runLineId: l.id }), "confirm line");
    as(preparer);
    ok(await submitRun({ runId }), "submit");
    as(approver);
    ok(await sendBackRun({ runId, note: SENT_BACK_NOTE }), "send back");
    as(preparer);
    ok(await submitRun({ runId }), "resubmit");
    as(approver);
    const hash = (await getWorksheet(runId))!.expectedHash!;
    ok(await approveRun({ runId, expectedHash: hash }), "approve");

    // 7. Payment: the list, each person marked paid (the last one makes the run paid), a payslip, and a view of the run.
    as(preparer);
    ok(await exportRemitlyList({ runId }), "export");
    for (const emp of [empA, empB]) ok(await markPaid({ runId, employeeId: emp, reference: `RMT-HIST-${uniq("r")}`, paidOn: "2030-12-30" }), "mark paid");
    // The Approver releases the statements, and only then can the person open theirs.
    as(approver);
    ok(await releaseStatements({ runId }), "release statements");
    as(paidOwner);
    const slip = await downloadPayslip(new Request("http://localhost/api/payroll/payslips/x"), { params: Promise.resolve({ runId }) });
    expect(slip.status).toBe(200);
    as(viewer);
    await getWorksheet(runId);

    // 8. A draft run that is cancelled.
    as(preparer);
    const q = slot(1);
    ok(await createPayLine({ employeeId: empB, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: q.periodStart, endsOn: q.periodEnd, monthly: "20,000" }), "create draft line");
    const second = ok(await createPayRun({ periodStart: q.periodStart, periodEnd: q.periodEnd }), "create draft run");
    draftRunId = (second as { data: { runId: string } }).data.runId;
    // The same draft is marked as a test run, archived, restored and made a real run again before it is cancelled.
    ok(await markRunAsTest({ runId: draftRunId, test: true, reason: reasonOf(5) }), "mark test");
    ok(await archivePayRun({ runId: draftRunId, reason: reasonOf(5) }), "archive");
    ok(await restorePayRun({ runId: draftRunId }), "restore");
    ok(await markRunAsTest({ runId: draftRunId, test: false, reason: reasonOf(5) }), "mark real");
    ok(await cancelPayRun({ runId: draftRunId, reason: reasonOf(5) }), "cancel");

    // Only this cycle's rows: written by this file's own accounts, about this cycle's runs or about no run (access, lines, settings).
    // Other test files share the database, so a time filter alone could let their rows stand in for a missing action here.
    const actors = sql.join(
      [superAdmin, preparer, checker, approver, viewer, paidOwner].map((a) => sql`${a.id}::uuid`),
      sql`, `,
    );
    const seen = (
      await rows<{ action: string }>(sql`
        select distinct action from payroll.pay_change_log
        where created_at >= ${cycleStart}::timestamptz
          and actor_id in (${actors})
          and (run_id is null or run_id in (${runId}::uuid, ${draftRunId}::uuid))`)
    )
      .map((r) => r.action)
      .sort();
    // "signatory_changed" is proved in payroll-payslips.test.ts: that file owns the payslip signatory table (it expects it empty at the
    // start), so this file must not write a signatory.
    expect(seen).toEqual(CHANGE_ACTIONS.filter((a) => a !== "signatory_changed").sort());
  });

  it("has a plain label for every kind of change, and none says extra hours or PTO", () => {
    for (const a of CHANGE_ACTIONS) {
      expect(CHANGE_ACTION_LABELS[a]).toBeTruthy();
      expect(CHANGE_ACTION_LABELS[a]).not.toMatch(/extra hours|pto/i);
    }
  });
});

const all = (over: Record<string, unknown> = {}) => getPayrollHistory({ page: 1, pageSize: 100, ...over } as never);

describe("who may read the history", () => {
  it("lets a Preparer, an Approver and a Viewer read it", async () => {
    for (const who of [preparer, approver, viewer]) {
      as(who);
      const r = await all({ runId });
      expect(r.error).toBeNull();
      expect(r.total).toBeGreaterThan(0);
    }
  });

  it("refuses a Super Admin with no level, and every other role with no level, before reading any data", async () => {
    const outsiders = [superAdmin, await account(null, "hr_admin"), await account(null, "executive"), await account(null, "team_lead"), await account(null, "recruiter"), await account(null, "employee")];
    for (const who of outsiders) {
      as(who);
      current.decrypts = 0;
      await expect(all({ runId })).rejects.toMatchObject({ name: "ForbiddenError" });
      await expect(getHistoryFilterOptions()).rejects.toMatchObject({ name: "ForbiddenError" });
      expect(current.decrypts).toBe(0);
      expect(await rows(sql`select 1 from ops.audit_log where actor_user_id = ${who.id} and action = 'sensitive.view'`)).toHaveLength(0);
    }
  });
});

describe("what a row shows", () => {
  it("names the person, the run period, the actor and the time, with old and new values side by side", async () => {
    as(preparer);
    const r = await all({ runId });
    const created = r.rows.find((x) => x.action === "run_created")!;
    expect(created.runLabel).toBe("2030-10-16 to 2030-10-31");
    expect(created.actorName).toMatch(/^Paolo Preparerlim/);
    expect(created.actionLabel).toBe(CHANGE_ACTION_LABELS.run_created);
    expect(Number.isNaN(Date.parse(created.at))).toBe(false);

    // An itemized line is listed under its kind and the name it was given.
    const allowance = r.rows.find((x) => x.action === "item_saved" && x.changes.some((c) => c.label === "Allowance: Zqhealth allowance"))!;
    expect(allowance.changes.find((c) => c.label === "Allowance: Zqhealth allowance")!.after).toContain("1,234.56");

    const loanSaved = r.rows.find((x) => x.action === "item_saved" && x.personName?.includes(lastNameB) && x.changes.some((c) => c.after?.includes("2,000.00")))!;
    expect(loanSaved).toBeTruthy();
    expect(loanSaved.changes.find((c) => c.after?.includes("2,000.00"))!.before).toMatch(/none|-/i);

    const sentBack = r.rows.find((x) => x.action === "run_sent_back")!;
    expect(sentBack.facts.some((f) => f.value === SENT_BACK_NOTE)).toBe(true);

    const paid = r.rows.find((x) => x.action === "payment_marked" && x.personName?.includes(lastNameA))!;
    expect(paid.personName).toBe(`Liza ${lastNameA}`);

    // No login email anywhere.
    expect(JSON.stringify(r.rows)).not.toMatch(/@example\.com/);
  });

  it("shows rate changes with the old and the new figure", async () => {
    as(preparer);
    const r = await all();
    const updated = r.rows.find((x) => x.action === "line_updated")!;
    expect(updated.changes.find((c) => c.before === "20,000.00" && c.after === "21,000.00")).toBeTruthy();
    expect(updated.facts.some((f) => f.value === reasonOf(0))).toBe(true);
    const settings = r.rows.find((x) => x.action === "settings_changed")!;
    expect(settings.changes.length).toBeGreaterThan(0);
    const access = r.rows.find((x) => x.action === "access_changed")!;
    expect(access.changes[0]).toMatchObject({ before: expect.any(String), after: "Viewer" });
  });

  it("uses 'overtime (OT)', never 'extra hours'", async () => {
    as(preparer);
    expect(JSON.stringify((await all()).rows)).not.toMatch(/extra hours|\bpto\b/i);
  });

  it("lists the newest first, in a stable order", async () => {
    as(preparer);
    const first = await all({ runId });
    const times = first.rows.map((x) => Date.parse(x.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    const again = await all({ runId });
    expect(again.rows.map((x) => x.id)).toEqual(first.rows.map((x) => x.id));
  });
});

describe("filters", () => {
  it("narrows by run", async () => {
    as(preparer);
    const mine = await all({ runId });
    expect(mine.total).toBeGreaterThan(5);
    expect(mine.rows.every((x) => x.runLabel === "2030-10-16 to 2030-10-31")).toBe(true);
    const cancelled = await all({ runId: draftRunId });
    expect(cancelled.rows.map((x) => x.action).sort()).toEqual(["run_archived", "run_cancelled", "run_created", "run_marked_real", "run_marked_test", "run_restored"]);
    expect((await all()).total).toBeGreaterThan(mine.total);
  });

  it("narrows by person", async () => {
    as(preparer);
    const r = await all({ employeeId: empB });
    expect(r.total).toBeGreaterThan(0);
    expect(r.rows.every((x) => x.personName === `Liza ${lastNameB}`)).toBe(true);
  });

  it("narrows by the person who made the change", async () => {
    as(preparer);
    const r = await all({ actorId: approver.id });
    expect(r.total).toBeGreaterThan(0);
    expect(new Set(r.rows.map((x) => x.action))).toEqual(new Set(["run_sent_back", "run_approved", "run_viewed", "statements_released"]));
    expect(r.rows.every((x) => x.actorName.startsWith("Ariel Approvertan"))).toBe(true);
  });

  it("narrows by date, in the company time zone, both ends included", async () => {
    as(preparer);
    // Everything in this file was written "today" in real time (the clock fake moves Date only for the view day, not for created_at).
    const [{ d }] = await rows<{ d: string }>(sql`select (now() at time zone 'America/Phoenix')::date::text as d`);
    expect((await all({ runId, from: d, to: d })).total).toBe((await all({ runId })).total);
    expect((await all({ runId, from: "2000-01-01", to: "2000-01-02" })).total).toBe(0);
    expect((await all({ runId, from: "2999-01-01" })).total).toBe(0);
    expect((await all({ runId, to: "2000-01-01" })).total).toBe(0);
  });

  it("answers a bad date or id with a message, not a crash", async () => {
    as(preparer);
    for (const bad of [{ from: "2030-13-45" }, { to: "yesterday" }, { from: "2030-02-30" }, { runId: "not-an-id" }, { employeeId: "1; drop table" }, { actorId: "x" }]) {
      const r = await all(bad);
      expect(r.error).toEqual(expect.any(String));
      expect(r.error).not.toBe("");
      expect(r.rows).toEqual([]);
      expect(r.total).toBe(0);
    }
    const reversed = await all({ from: "2030-02-01", to: "2030-01-01" });
    expect(reversed.error).toMatch(/before/i);
    expect(await rows(sql`select 1 from ops.audit_log where actor_user_id = ${preparer.id} and action = 'sensitive.view' and target_type = 'pay_change_log' and metadata ->> 'count' = '0'`)).toHaveLength(0);
  });

  it("keeps a page number past the end on the last page, and a bad page on the first", async () => {
    as(preparer);
    const total = (await all({ runId })).total;
    const last = await getPayrollHistory({ runId, page: 999, pageSize: 10 });
    expect(last.rows.length).toBe(total % 10 || 10);
    const first = await getPayrollHistory({ runId, page: -3, pageSize: 10 });
    expect(first.rows).toHaveLength(10);
  });
});

describe("paging and decrypting", () => {
  it("decrypts only the rows of the requested page", async () => {
    as(preparer);
    const total = (await all({ runId })).total;
    expect(total).toBeGreaterThan(12);
    current.decrypts = 0;
    const r = await getPayrollHistory({ runId, page: 2, pageSize: 10 });
    expect(r.rows).toHaveLength(10);
    expect(current.decrypts).toBe(10);
    const ids = new Set((await getPayrollHistory({ runId, page: 1, pageSize: 10 })).rows.map((x) => x.id));
    expect(r.rows.some((x) => ids.has(x.id))).toBe(false);
  });

  it("writes one sensitive.view audit per page view, with ids and counts only", async () => {
    const reader = await account("viewer");
    as(reader);
    const r = await getPayrollHistory({ runId, page: 1, pageSize: 10 });
    const audits = await rows<{ target_type: string; metadata: unknown }>(sql`select target_type, metadata from ops.audit_log where actor_user_id = ${reader.id} and action = 'sensitive.view'`);
    expect(audits).toHaveLength(1);
    expect(audits[0].target_type).toBe("pay_change_log");
    expect((audits[0].metadata as { count: number }).count).toBe(r.rows.length);
    const text = JSON.stringify(audits);
    expect(text).not.toMatch(/\d{1,3},\d{3}\.\d{2}/);
    for (const s of [...SECRET_REASONS, SENT_BACK_NOTE, MONTHLY_A, MONTHLY_B]) expect(text).not.toContain(s);

    await getPayrollHistory({ runId, page: 2, pageSize: 10 });
    expect(await rows(sql`select 1 from ops.audit_log where actor_user_id = ${reader.id} and action = 'sensitive.view'`)).toHaveLength(2);
  });

  it("writes no audit row when nothing was decrypted", async () => {
    const reader = await account("viewer");
    as(reader);
    expect((await all({ runId, from: "2999-01-01" })).rows).toEqual([]);
    expect((await all({ runId: "nope" })).error).toBeTruthy();
    expect(await rows(sql`select 1 from ops.audit_log where actor_user_id = ${reader.id}`)).toHaveLength(0);
  });

  it("shows a row that can't be read as such, and logs only its id and the kind of error", async () => {
    const [victim] = await rows<{ id: string; detail_enc: string }>(sql`select id, detail_enc from payroll.pay_change_log where run_id = ${runId} and action = 'run_submitted' order by created_at limit 1`);
    // Break one row's ciphertext the only way possible: as the database owner, with the append-only trigger switched off for the statement.
    // The original is put back afterwards, so later tests (and later files) read a clean log.
    const setDetail = (value: string) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`update payroll.pay_change_log set detail_enc = ${value} where id = ${victim.id}`);
      });
    await setDetail("garbage");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const reader = await account("viewer");
      as(reader);
      const r = await all({ runId });
      const bad = r.rows.find((x) => x.id === victim.id)!;
      expect(bad.unreadable).toBe(true);
      expect(bad.changes).toEqual([]);
      expect(bad.facts).toEqual([]);
      expect(r.rows.filter((x) => !x.unreadable).length).toBe(r.rows.length - 1);
      const logged = JSON.stringify(errors.mock.calls);
      expect(logged).toContain(victim.id);
      expect(logged).not.toContain("garbage");
      expect(logged).not.toMatch(/\d{1,3},\d{3}\.\d{2}/);
      const [audit] = await rows<{ metadata: { count: number } }>(sql`select metadata from ops.audit_log where actor_user_id = ${reader.id} and action = 'sensitive.view'`);
      expect(audit.metadata.count).toBe(r.rows.length - 1);
    } finally {
      errors.mockRestore();
      await setDetail(victim.detail_enc);
    }
  });
  it("marks a row whose action this version does not know as unreadable, not as a blank line", async () => {
    const stranger = await account(null);
    const id = randomUUID();
    const enc = (await import("@/lib/crypto")).fieldCrypto().encrypt(JSON.stringify({}), `pay_change:${id}`);
    await db.execute(sql`insert into payroll.pay_change_log (id, actor_id, action, detail_enc) values (${id}, ${stranger.id}, 'action_from_a_newer_release', ${enc})`);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      as(viewer);
      const r = await all({ actorId: stranger.id });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].unreadable).toBe(true);
      expect(r.rows[0].changes).toEqual([]);
      expect(JSON.stringify(errors.mock.calls)).toContain(id);
    } finally {
      errors.mockRestore();
      // Put the log back as it was: remove the test row as the database owner, with the append-only trigger off for the statement.
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.execute(sql`delete from payroll.pay_change_log where id = ${id}`);
      });
    }
  });

  it("still leaves the sensitive.view audit row when the name lookups fail", async () => {
    const target = await account(null, "employee", { first: "Nena", last: uniq("Lookupcruz") });
    as(superAdmin);
    ok(await setPayrollAccess({ userId: target.id, level: "viewer" }), "access for lookup test");
    const reader = await account("viewer");
    as(reader);
    current.failNames = true;
    try {
      await expect(all({ actorId: superAdmin.id })).rejects.toThrow("name lookup failed");
    } finally {
      current.failNames = false;
    }
    const audits = await rows<{ metadata: { count: number } }>(sql`select metadata from ops.audit_log where actor_user_id = ${reader.id} and action = 'sensitive.view'`);
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata.count).toBeGreaterThan(0);
    as(superAdmin);
    ok(await setPayrollAccess({ userId: target.id, level: null }), "remove lookup test access");
  });
});

describe("the filter choices", () => {
  it("lists runs, people and the people who made changes, by display name", async () => {
    as(viewer);
    const o = await getHistoryFilterOptions();
    expect(o.runs.map((x) => x.id)).toEqual(expect.arrayContaining([runId, draftRunId]));
    expect(o.runs.find((x) => x.id === runId)!.label).toBe("2030-10-16 to 2030-10-31");
    expect(o.people.find((x) => x.id === empA)!.name).toBe(`Liza ${lastNameA}`);
    expect(o.actors.find((x) => x.id === approver.id)!.name).toMatch(/^Ariel Approvertan/);
    expect(JSON.stringify(o)).not.toMatch(/@example\.com/);
  });
});

describe("the general audit log shows the same events with no amounts or reasons", () => {
  it("has payroll rows for the cycle, and none of them carries a figure, a reason or a note", async () => {
    const ids = [superAdmin, preparer, checker, approver, viewer, paidOwner].map((u) => u.id);
    const audit = await rows<{ action: string; metadata: unknown; before: unknown; after: unknown; target_id: string | null }>(
      sql`select action, metadata, before, after, target_id from ops.audit_log where actor_user_id = any(${sql.raw(`array['${ids.join("','")}']::uuid[]`)})`,
    );
    const actionsSeen = new Set(audit.map((a) => a.action));
    for (const a of ["payroll.line.create", "payroll.line.update", "payroll.line.end", "payroll.settings.update", "payroll.run.create", "payroll.remitly.export", "user.payroll_access.update", "sensitive.view"]) {
      expect(actionsSeen.has(a)).toBe(true);
    }
    const text = JSON.stringify(audit);
    for (const s of [...SECRET_REASONS, "Zqreason settings", SENT_BACK_NOTE, MONTHLY_A, MONTHLY_B, "3141592", "2718281", "58.50"]) expect(text).not.toContain(s);
    expect(text).not.toMatch(/\d{1,3},\d{3}\.\d{2}/);
    expect(text).not.toMatch(/RMT-HIST/);
  });

  it("reads through the audit log page query without decrypting anything", async () => {
    as(superAdmin);
    current.decrypts = 0;
    const page = await listAuditEntries({ page: "1", size: "100", action: "payroll." });
    expect(page.rows.length).toBeGreaterThan(0);
    const text = JSON.stringify(page.rows);
    for (const s of [...SECRET_REASONS, SENT_BACK_NOTE, MONTHLY_A, MONTHLY_B]) expect(text).not.toContain(s);
    expect(text).not.toMatch(/\d{1,3},\d{3}\.\d{2}/);
    expect(current.decrypts).toBe(0);
  });
});
