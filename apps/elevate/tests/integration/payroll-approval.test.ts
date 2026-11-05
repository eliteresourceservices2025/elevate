import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: sending a run for review, sending it back, approving it, and the separation of duties. Invented names and
// figures only. Every period is a half month of 2027, and each test's pay lines start and end inside its own period, so no test
// builds another test's people into its run.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { createPayLine, endPayLine, savePaySettings, createPayRun, cancelPayRun, savePayItem, setRunUsdRate, confirmRunLine, submitRun, sendBackRun, approveRun } = await import(
  "@/modules/payroll/actions"
);
const { getWorksheet, payrollRunsAwaitingApproval } = await import("@/modules/payroll/queries");
const { computeRunHash, countAwaiting, decryptApprovalHash, touchedBy } = await import("@/modules/payroll/approval");
const { decryptItemValue, encryptItemValue } = await import("@/modules/payroll/service");
const { readChangeDetail } = await import("@/modules/payroll/changes");

type Row = Record<string, unknown>;
type Level = "preparer" | "approver" | "viewer" | null;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

const NO_ACCESS = "You do not have access to do that.";
const BAD = "Check the request and try again.";
const STALE = "This payroll changed. Reload and review it again.";

async function account(level: Level = "preparer") {
  const id = randomUUID();
  const email = `${uniq("appr")}@example.com`;
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${email}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  return { id, email, roles: ["employee"], payrollAccess: level };
}
async function person(userId: string | null = null) {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values ('Liza', ${uniq("Testreyes")}, ${`${uniq("emp")}@example.com`}, 'active', ${userId}) returning id`);
  return e.id;
}

/** Half month `n` of 2027 (0 = 1 to 15 January, 1 = 16 to 31 January, ...). */
function slot(n: number) {
  const month = Math.floor(n / 2) + 1;
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(2027, month, 0)).getUTCDate();
  return n % 2 === 0 ? { periodStart: `2027-${mm}-01`, periodEnd: `2027-${mm}-15` } : { periodStart: `2027-${mm}-16`, periodEnd: `2027-${mm}-${last}` };
}

/** A line paid only during `p` (it starts on its first day and ends on its last). */
async function giveLine(employeeId: string, p: { periodStart: string; periodEnd: string }, over: Record<string, unknown> = {}, author: unknown = preparer) {
  const before = current.user;
  current.user = author;
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
  current.user = before;
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
  return r.data.lineKey;
}
/** A draft run for `p`, created by `who`, who also sets the dollar rate (every run needs one before review) unless `rate` is null. */
async function newRun(p: { periodStart: string; periodEnd: string }, who: unknown = preparer, rate: string | null = "58.50") {
  current.user = who;
  const r = await createPayRun(p);
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  if (rate !== null) {
    const set = await setRunUsdRate({ runId: r.data.runId, rate });
    if (!set.ok) throw new Error(`rate failed: ${set.error}`);
  }
  return r.data.runId;
}
const runLines = (runId: string, employeeId: string) =>
  rows<{ id: string; confirmed_by: string | null }>(sql`select id, confirmed_by from payroll.pay_run_lines where run_id = ${runId} and employee_id = ${employeeId} order by id`);
const status = async (runId: string) => (await rows<{ status: string }>(sql`select status from payroll.pay_runs where id = ${runId}`))[0].status;
const logActions = async (runId: string) =>
  (await rows<{ action: string }>(sql`select action from payroll.pay_change_log where run_id = ${runId} and action <> 'run_viewed' order by created_at`)).map((r) => r.action);
const as = (who: unknown) => {
  current.user = who;
};
async function hashFor(runId: string, who: unknown) {
  as(who);
  const sheet = (await getWorksheet(runId))!;
  return sheet.expectedHash;
}
/** Everything approving or sending back could write, counted, to show a refused call wrote nothing. */
async function footprint(runId: string) {
  const [r] = await rows<Row>(sql`
    select (select count(*)::int from payroll.pay_approvals where run_id = ${runId}) as approvals,
           (select count(*)::int from payroll.pay_change_log where run_id = ${runId} and action <> 'run_viewed') as changes,
           (select count(*)::int from ops.audit_log where target_id = ${runId} and action like 'payroll.run.%') as audits,
           (select count(*)::int from ops.notifications where link = ${`/payroll/${runId}`}) as notices,
           (select status from payroll.pay_runs where id = ${runId}) as status`);
  return r;
}

let preparer: Awaited<ReturnType<typeof account>>;
let checker: Awaited<ReturnType<typeof account>>;
let approver: Awaited<ReturnType<typeof account>>;
beforeAll(async () => {
  preparer = await account("preparer");
  checker = await account("preparer");
  approver = await account("approver");
  current.user = preparer;
  // Extra-hours rates for 2027, and a December version without them (for the missing-rate check), restored afterwards.
  const rates = { cutoffDivisor: 11, changeWarnPercent: 10, extraRegular: "125", extraHoliday: "200", extraRestDay: "130", extraRestDayOver8: "169", holiday: "100", reason: "Test rates" };
  for (const v of [
    { ...rates, effectiveFrom: "2027-01-01" },
    { ...rates, effectiveFrom: "2027-12-01", extraRegular: "" },
    { ...rates, effectiveFrom: "2027-12-16" },
  ]) {
    expect(await savePaySettings(v)).toMatchObject({ ok: true });
  }
});

describe("submitRun refuses a run that is not ready", () => {
  /** Submits as the Preparer, expects the refusal, and checks (on the page the Preparer sees) that `code` is the only thing blocking. */
  async function refused(runId: string, error: string | RegExp, code?: string) {
    as(preparer);
    const r = await submitRun({ runId });
    expect(r.ok).toBe(false);
    if (typeof error === "string") expect(r).toEqual({ ok: false, error });
    else expect(!r.ok && r.error).toMatch(error);
    expect(await status(runId)).toBe("draft");
    expect(await logActions(runId)).not.toContain("run_submitted");
    if (code) expect([...new Set((await getWorksheet(runId))!.checks.blocking.map((c) => c.code))]).toEqual([code]);
  }
  const blocked = /can't be sent for review/;

  it("a run with no lines", async () => {
    const runId = randomUUID();
    const p = slot(0);
    await db.execute(sql`insert into payroll.pay_runs (id, period_start, period_end, status, settings_snapshot, created_by)
      values (${runId}, ${p.periodStart}, ${p.periodEnd}, 'draft', '{}'::jsonb, ${preparer.id})`);
    await refused(runId, "This run has no lines, so there is nothing to send for review.");
  });

  it("net pay below zero", async () => {
    const p = slot(1);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await newRun(p);
    const [line] = await runLines(runId, emp);
    expect(await savePayItem({ runId, employeeId: emp, runLineId: line.id, type: "loan", value: "20,000", reason: "Large advance" })).toMatchObject({ ok: true });
    await refused(runId, blocked, "negative_net");
  });

  it("a missing dollar rate", async () => {
    const p = slot(2);
    const emp = await person();
    await giveLine(emp, p, { dollarAllowance: "12.50" });
    const runId = await newRun(p, preparer, null);
    await refused(runId, blocked, "missing_usd_rate");
    expect(await setRunUsdRate({ runId, rate: "58.50" })).toMatchObject({ ok: true });
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
  });

  it("a missing dollar rate on a run paid in pesos only (the Remitly list always needs it)", async () => {
    const p = slot(19);
    const emp = await person();
    await giveLine(emp, p); // no dollar allowance
    const runId = await newRun(p, preparer, null);
    await refused(runId, blocked, "missing_usd_rate");
    const shown = (await getWorksheet(runId))!.checks.blocking;
    expect(shown).toEqual([expect.objectContaining({ code: "missing_usd_rate", employeeId: null, runLineId: null })]);
    expect(await setRunUsdRate({ runId, rate: "58.50" })).toMatchObject({ ok: true });
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
  });

  it("a missing extra-hours rate", async () => {
    const p = slot(22); // 1 to 15 December: the settings version without the regular rate
    const emp = await person();
    await giveLine(emp, p);
    const runId = await newRun(p);
    const [line] = await runLines(runId, emp);
    expect(await savePayItem({ runId, employeeId: emp, runLineId: line.id, type: "extra_regular", value: "60" })).toMatchObject({ ok: true });
    await refused(runId, blocked, "missing_multiplier");
  });

  it("an unassigned suggestion", async () => {
    const p = slot(3);
    const emp = await person();
    await giveLine(emp, p);
    await giveLine(emp, p, { alias: "Second role" });
    const runId = await newRun(p);
    const id = randomUUID();
    await db.execute(sql`insert into payroll.pay_run_items (id, run_id, employee_id, run_line_id, type, state, value_enc, entered_by)
      values (${id}, ${runId}, ${emp}, null, 'late_minutes', 'suggested', ${encryptItemValue(id, { value: 30n, reason: null, system: true })}, ${preparer.id})`);
    await refused(runId, blocked, "unassigned_suggestion");
  });

  it("an amount that can't be read", async () => {
    const p = slot(4);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await newRun(p);
    const [line] = await runLines(runId, emp);
    await db.execute(sql`insert into payroll.pay_run_items (id, run_id, employee_id, run_line_id, type, state, value_enc, entered_by)
      values (${randomUUID()}, ${runId}, ${emp}, ${line.id}, 'adjustment', 'confirmed', 'not-a-ciphertext', ${preparer.id})`);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await refused(runId, /can't be read/, "unreadable_line");
    spy.mockRestore();
  });

  it("pay lines that changed after the run was built", async () => {
    const p = slot(5);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await newRun(p);
    await giveLine(await person(), p); // someone added to the period afterwards would go unpaid
    await refused(runId, blocked, "lines_out_of_date");
  });

  it("the submitter's own line until another Preparer confirms it", async () => {
    const p = slot(6);
    const mine = await account("preparer");
    const ownEmp = await person(mine.id);
    await giveLine(ownEmp, p);
    const runId = await newRun(p, mine);
    as(mine);
    const r = await submitRun({ runId });
    expect(!r.ok && r.error).toMatch(blocked);
    expect(await status(runId)).toBe("draft");
    // The submitter sees it as their own line; another Preparer or a Viewer does not get that check about someone else's line.
    as(mine);
    expect((await getWorksheet(runId))!).toMatchObject({ checksAreMine: true, checks: { blocking: [expect.objectContaining({ code: "own_line_unconfirmed" })] } });
    as(checker);
    expect((await getWorksheet(runId))!.checks.blocking).toEqual([]);
    as(await account("viewer"));
    expect((await getWorksheet(runId))!.checks.blocking).toEqual([]);

    // Confirmed by the submitter's colleague: now it goes.
    const [line] = await runLines(runId, ownEmp);
    as(checker);
    expect(await confirmRunLine({ runLineId: line.id })).toMatchObject({ ok: true });
    as(mine);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("in_review");
  });

  it("refuses a run that is not a draft, and a request that is not valid", async () => {
    as(preparer);
    expect(await submitRun({ runId: "nope" })).toEqual({ ok: false, error: BAD });
    expect(await submitRun({ runId: randomUUID() })).toEqual({ ok: false, error: "That pay run was not found." });
  });
});

describe("review, send back and approve", () => {
  it("runs the whole path, notifies with a count and a link only, and needs a fresh hash after a send-back", async () => {
    const p = slot(7);
    const emp = await person();
    await giveLine(emp, p, { monthly: "45,678.90" });
    const runId = await newRun(p);
    const [line] = await runLines(runId, emp);

    // A draft has no hash to approve with, even for an Approver.
    expect(await hashFor(runId, approver)).toBeNull();

    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("in_review");
    expect(await submitRun({ runId })).toEqual({ ok: false, error: "This run is no longer a draft, so it can't be changed." });
    // Frozen while in review.
    expect(await savePayItem({ runId, employeeId: emp, runLineId: line.id, type: "adjustment", value: "100" })).toEqual({
      ok: false,
      error: "This run is no longer a draft, so it can't be changed.",
    });

    const [notice] = await rows<{ title: string; body: string; link: string; kind: string }>(
      sql`select title, body, link, kind from ops.notifications where user_id = ${approver.id} and link = ${`/payroll/${runId}`}`,
    );
    expect(notice).toMatchObject({ kind: "payroll.review", link: `/payroll/${runId}` });
    expect(`${notice.title} ${notice.body}`).toMatch(/\d+ pay runs? (is|are) waiting/);
    expect(`${notice.title} ${notice.body}`).not.toMatch(/45|22,|\d\.\d\d|Liza|Testreyes/);

    const first = await hashFor(runId, approver);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    const preparerView = await hashFor(runId, preparer);
    expect(preparerView).toBeNull();

    // Send back: a note is needed; the run returns to draft and the Preparer can edit again.
    as(approver);
    expect(await sendBackRun({ runId, note: "  " })).toEqual({ ok: false, error: BAD });
    expect(await sendBackRun({ runId, note: "Check the late minutes" })).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("draft");
    const [sent] = await rows<{ id: string; detail_enc: string }>(sql`select id, detail_enc from payroll.pay_change_log where run_id = ${runId} and action = 'run_sent_back'`);
    expect(readChangeDetail(sent)).toMatchObject({ note: "Check the late minutes" });
    const back = await rows<{ title: string; body: string }>(sql`select title, body from ops.notifications where user_id = ${preparer.id} and link = ${`/payroll/${runId}`}`);
    expect(back).toHaveLength(1);
    expect(JSON.stringify(back)).not.toMatch(/late minutes|45|\d\.\d\d/);
    const [audit] = await rows<Row>(sql`select * from ops.audit_log where action = 'payroll.run.send_back' and target_id = ${runId}`);
    expect(JSON.stringify(audit)).not.toContain("late minutes");

    as(preparer);
    expect(await savePayItem({ runId, employeeId: emp, runLineId: line.id, type: "late_minutes", value: "30" })).toMatchObject({ ok: true });
    as(approver);
    expect(await sendBackRun({ runId, note: "again" })).toEqual({ ok: false, error: "This run is not waiting for approval." });
    expect(await approveRun({ runId, expectedHash: first })).toEqual({ ok: false, error: "This run is not waiting for approval." });

    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    // The hash the approver saw before the send-back is stale now.
    const before = await footprint(runId);
    as(approver);
    expect(await approveRun({ runId, expectedHash: first! })).toEqual({ ok: false, error: STALE });
    expect(await footprint(runId)).toEqual(before);

    const fresh = (await hashFor(runId, approver))!;
    expect(fresh).not.toBe(first);
    as(approver);
    expect(await approveRun({ runId, expectedHash: fresh })).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("approved");
    expect(await logActions(runId)).toEqual(["run_created", "usd_rate_changed", "run_submitted", "run_sent_back", "item_saved", "run_submitted", "run_approved"]);

    const approvals = await rows<{ id: string; decision: string; run_hash_enc: string; decided_by: string }>(
      sql`select id, decision, run_hash_enc, decided_by from payroll.pay_approvals where run_id = ${runId} order by created_at`,
    );
    expect(approvals.map((a) => a.decision)).toEqual(["sent_back", "approved"]);
    expect(approvals[1].decided_by).toBe(approver.id);
    expect(approvals[1].run_hash_enc).not.toContain(fresh);
    expect(decryptApprovalHash(approvals[1].id, approvals[1].run_hash_enc)).toBe(fresh);

    const done = await rows<{ title: string; body: string }>(sql`select title, body from ops.notifications where user_id = ${checker.id} and link = ${`/payroll/${runId}`}`);
    expect(done.map((n) => n.title)).toContain("A pay run was approved");
    expect(JSON.stringify(done)).not.toMatch(/45|\d\.\d\d/);
    expect(JSON.stringify(await rows(sql`select * from ops.audit_log where target_id = ${runId}`))).not.toMatch(/45,678|4567890|Check the late/);

    // Approved: nothing about the run's figures changes, even by direct SQL.
    const raises = async (q: ReturnType<typeof sql>) => {
      const err = (await db.execute(q).then(
        () => null,
        (e: unknown) => e,
      )) as { message?: string; cause?: { message?: string } } | null;
      expect(err, "the database refused the change").not.toBeNull();
      expect(`${err!.cause?.message ?? ""}`).toMatch(/frozen|only while the run is a draft|cannot make the transition/);
    };
    await raises(sql`update payroll.pay_run_lines set confirmed_by = null where id = ${line.id}`);
    await raises(sql`delete from payroll.pay_run_lines where id = ${line.id}`);
    await raises(sql`insert into payroll.pay_run_items (id, run_id, employee_id, run_line_id, type, state, value_enc, entered_by)
      values (${randomUUID()}, ${runId}, ${emp}, ${line.id}, 'adjustment', 'confirmed', 'x', ${preparer.id})`);
    await raises(sql`update payroll.pay_runs set usd_rate_e4 = 590000 where id = ${runId}`);
    await raises(sql`update payroll.pay_runs set status = 'draft' where id = ${runId}`);
    expect(await approveRun({ runId, expectedHash: fresh })).toEqual({ ok: false, error: "This run is not waiting for approval." });
  });

  it("refuses an approval by permission, by a removed level, and by anyone who touched the run", async () => {
    const p = slot(8);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await newRun(p);
    const [line] = await runLines(runId, emp);
    as(checker);
    expect(await savePayItem({ runId, employeeId: emp, runLineId: line.id, type: "adjustment", value: "100" })).toMatchObject({ ok: true });
    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    const hash = (await hashFor(runId, approver))!;

    // A Preparer can't approve at all.
    as(preparer);
    expect(await approveRun({ runId, expectedHash: hash })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await sendBackRun({ runId, note: "x" })).toEqual({ ok: false, error: NO_ACCESS });

    // The checker saved an amount, then became an Approver: still refused.
    await db.execute(sql`update core.users set payroll_access = 'approver' where id = ${checker.id}`);
    try {
      const turned = { ...checker, payrollAccess: "approver" };
      as(turned);
      const r = await approveRun({ runId, expectedHash: hash });
      expect(!r.ok && r.error).toMatch(/prepared or changed this run/);
      as(turned);
      expect((await getWorksheet(runId))!.approvalRefusal).toMatch(/prepared or changed this run/);
    } finally {
      await db.execute(sql`update core.users set payroll_access = 'preparer' where id = ${checker.id}`);
    }

    // An Approver whose level is removed is refused on the very next call, even with the old level in hand.
    const leaving = await account("approver");
    await db.execute(sql`update core.users set payroll_access = null where id = ${leaving.id}`);
    as(leaving);
    expect(await approveRun({ runId, expectedHash: hash })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await sendBackRun({ runId, note: "x" })).toEqual({ ok: false, error: NO_ACCESS });
    const archived = await account("approver");
    await db.execute(sql`update core.users set archived_at = now() where id = ${archived.id}`);
    as(archived);
    expect(await approveRun({ runId, expectedHash: hash })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await status(runId)).toBe("in_review");
    expect(await rows(sql`select 1 from payroll.pay_approvals where run_id = ${runId}`)).toHaveLength(0);
  });

  it("an Approver with a line on the run needs another Preparer's confirmation of it", async () => {
    const p = slot(9);
    const self = await account("approver");
    const ownEmp = await person(self.id);
    await giveLine(ownEmp, p);
    const runId = await newRun(p);
    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    const hash = (await hashFor(runId, self))!;
    as(self);
    expect((await getWorksheet(runId))!.approvalRefusal).toMatch(/your own line/i);
    const r = await approveRun({ runId, expectedHash: hash });
    expect(!r.ok && r.error).toMatch(/your own line/i);

    // Sent back, confirmed by a Preparer, sent again: now the Approver may decide.
    expect(await sendBackRun({ runId, note: "Please confirm my line" })).toMatchObject({ ok: true });
    const [line] = await runLines(runId, ownEmp);
    as(checker);
    expect(await confirmRunLine({ runLineId: line.id })).toMatchObject({ ok: true });
    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    const fresh = (await hashFor(runId, self))!;
    as(self);
    expect((await getWorksheet(runId))!.approvalRefusal).toBeNull();
    expect(await approveRun({ runId, expectedHash: fresh })).toMatchObject({ ok: true });
  });

  it("a check that starts blocking after the run was sent stops the approval, and the Approver sees why", async () => {
    const p = slot(15);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await newRun(p);
    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    await giveLine(await person(), p); // a person added to the period after the run was sent
    as(approver);
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.checks.blocking.map((c) => c.code)).toEqual(["lines_out_of_date"]);
    expect(sheet.approvalRefusal).toMatch(/must be fixed/);
    const r = await approveRun({ runId, expectedHash: sheet.expectedHash! });
    expect(!r.ok && r.error).toMatch(/must be fixed/);
    expect(await status(runId)).toBe("in_review");
  });

  it("two approvals at once: exactly one succeeds", async () => {
    const p = slot(10);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await newRun(p);
    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    const second = await account("approver");
    const hash = (await hashFor(runId, approver))!;

    // requireUser is mocked per call, so each call captures its own user before the race.
    const { requireUser } = await import("@/lib/auth");
    vi.mocked(requireUser).mockResolvedValueOnce(approver as never).mockResolvedValueOnce(second as never);
    const results = await Promise.all([approveRun({ runId, expectedHash: hash }), approveRun({ runId, expectedHash: hash })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, error: "This run is not waiting for approval." });
    expect(await rows(sql`select 1 from payroll.pay_approvals where run_id = ${runId} and decision = 'approved'`)).toHaveLength(1);
  });
});

describe("everyone who touched a run", () => {
  it("each source is refused through approveRun after becoming an Approver, and the dashboard count uses the same list", async () => {
    const p = slot(16);
    const [rateAuthor, creator, rateSetter, itemEnterer, confirmer, submitter] = await Promise.all([1, 2, 3, 4, 5, 6].map(() => account("preparer")));
    const fresh = await account("approver");
    const emp = await person();
    await giveLine(emp, p, { dollarAllowance: "10" }, rateAuthor); // wrote the rate the run pays
    const runId = await newRun(p, creator, null);
    as(rateSetter);
    expect(await setRunUsdRate({ runId, rate: "58.50" })).toMatchObject({ ok: true });
    const [line] = await runLines(runId, emp);
    as(itemEnterer);
    expect(await savePayItem({ runId, employeeId: emp, runLineId: line.id, type: "adjustment", value: "100" })).toMatchObject({ ok: true });
    as(confirmer);
    expect(await confirmRunLine({ runLineId: line.id })).toMatchObject({ ok: true });
    as(submitter);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });

    // touchedBy and the dashboard count agree, person by person, on this run.
    const sources = { rateAuthor, creator, rateSetter, itemEnterer, confirmer, submitter };
    const touched = await touchedBy(db, runId);
    for (const [label, who] of Object.entries(sources)) {
      expect(touched, label).toContain(who.id);
      expect(await countAwaiting(db, who.id, [runId]), label).toBe(0);
    }
    expect(touched).not.toContain(fresh.id);
    expect(await countAwaiting(db, fresh.id, [runId])).toBe(1);

    const hash = (await hashFor(runId, fresh))!;
    for (const [label, who] of Object.entries(sources)) {
      await db.execute(sql`update core.users set payroll_access = 'approver' where id = ${who.id}`);
      try {
        as({ ...who, payrollAccess: "approver" });
        const r = await approveRun({ runId, expectedHash: hash });
        expect(!r.ok && r.error, label).toMatch(/prepared or changed this run/);
      } finally {
        await db.execute(sql`update core.users set payroll_access = 'preparer' where id = ${who.id}`);
      }
    }
    expect(await status(runId)).toBe("in_review");
    as(fresh);
    expect(await approveRun({ runId, expectedHash: hash })).toMatchObject({ ok: true });
  });
});

describe("ending a line does not hide who wrote its rate", () => {
  it("someone who wrote the rate, after another Preparer ended the line, is refused once made an Approver", async () => {
    const p = slot(18);
    const [writer, ender] = await Promise.all([account("preparer"), account("preparer")]);
    const fresh = await account("approver");
    const emp = await person();
    // The writer types the rate; the ender ends the line. The end is a new version with the same start, authored by the ender,
    // and it is the version the run pays, with the writer's amounts copied into it.
    const lineKey = await giveLine(emp, p, { endsOn: undefined }, writer);
    as(ender);
    expect(await endPayLine({ lineKey, endsOn: p.periodEnd, reason: "Contract ends" })).toMatchObject({ ok: true });
    const runId = await newRun(p);
    const [paid] = await rows<{ created_by: string }>(sql`select v.created_by from payroll.pay_run_lines l join payroll.pay_lines v on v.id = l.line_id where l.run_id = ${runId}`);
    expect(paid.created_by).toBe(ender.id);
    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });

    const touched = await touchedBy(db, runId);
    for (const [label, who] of Object.entries({ writer, ender })) {
      expect(touched, label).toContain(who.id);
      expect(await countAwaiting(db, who.id, [runId]), label).toBe(0);
    }
    expect(touched).not.toContain(fresh.id);
    expect(await countAwaiting(db, fresh.id, [runId])).toBe(1);

    const hash = (await hashFor(runId, fresh))!;
    await db.execute(sql`update core.users set payroll_access = 'approver' where id = ${writer.id}`);
    try {
      as({ ...writer, payrollAccess: "approver" });
      const r = await approveRun({ runId, expectedHash: hash });
      expect(!r.ok && r.error).toMatch(/prepared or changed this run/);
    } finally {
      await db.execute(sql`update core.users set payroll_access = 'preparer' where id = ${writer.id}`);
    }
    expect(await status(runId)).toBe("in_review");
    as(fresh);
    expect(await approveRun({ runId, expectedHash: hash })).toMatchObject({ ok: true });
  });
});

describe("recovering a run whose pay lines changed while in review", () => {
  it("send back, cancel, create again, send and approve", async () => {
    const p = slot(17);
    const first = await person();
    await giveLine(first, p);
    const runId = await newRun(p);
    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    const late = await person();
    await giveLine(late, p); // added after the run was sent: approving would leave them unpaid

    as(approver);
    const sheet = (await getWorksheet(runId))!;
    expect(sheet.approvalRefusal).toMatch(/must be fixed/);
    expect(await sendBackRun({ runId, note: "Someone was added to this period" })).toMatchObject({ ok: true });
    as(preparer);
    expect(await cancelPayRun({ runId, reason: "Pay lines changed" })).toMatchObject({ ok: true });
    expect(await status(runId)).toBe("cancelled");

    const again = await newRun(p);
    expect(await runLines(again, first)).toHaveLength(1);
    expect(await runLines(again, late)).toHaveLength(1);
    as(preparer);
    expect(await submitRun({ runId: again })).toMatchObject({ ok: true });
    const fresh = (await hashFor(again, approver))!;
    as(approver);
    expect(await approveRun({ runId: again, expectedHash: fresh })).toMatchObject({ ok: true });
    expect(await status(again)).toBe("approved");
  });
});

describe("the approval hash", () => {
  it("changes when a figure, an item, the dollar rate, a confirmation or the settings snapshot changes", async () => {
    const p = slot(11);
    const emp = await person();
    await giveLine(emp, p, { dollarAllowance: "10" });
    const runId = await newRun(p, preparer, null);
    const [line] = await runLines(runId, emp);
    const seen = new Set<string>();
    const take = async () => {
      const h = await computeRunHash(db, runId);
      expect(h).toMatch(/^[0-9a-f]{64}$/);
      expect(seen.has(h!)).toBe(false);
      seen.add(h!);
    };
    await take();
    as(preparer);
    await setRunUsdRate({ runId, rate: "58.50" });
    await take();
    await savePayItem({ runId, employeeId: emp, runLineId: line.id, type: "client_hours", value: "80" }); // no pay change, still a change
    await take();
    as(checker);
    await confirmRunLine({ runLineId: line.id });
    await take();
    await db.execute(sql`update payroll.pay_runs set settings_snapshot = jsonb_set(settings_snapshot, '{changeWarnBp}', '1234') where id = ${runId}`);
    await take();
    // The same data gives the same hash.
    expect(seen.has((await computeRunHash(db, runId))!)).toBe(true);
  });
});

describe("corrections after approval", () => {
  it("an approved run never changes; the fix is an adjustment on the next run that names it", async () => {
    const first = slot(12);
    const next = slot(13);
    const emp = await person();
    await giveLine(emp, { periodStart: first.periodStart, periodEnd: next.periodEnd });
    const newcomer = await person(); // paid only from the next period: had no line on the run being corrected
    await giveLine(newcomer, next);
    const approvedRun = await newRun(first);
    as(preparer);
    expect(await submitRun({ runId: approvedRun })).toMatchObject({ ok: true });
    as(approver);
    expect(await approveRun({ runId: approvedRun, expectedHash: (await hashFor(approvedRun, approver))! })).toMatchObject({ ok: true });

    const nextRun = await newRun(next);
    const [line] = await runLines(nextRun, emp);
    as(preparer);
    const fix = { runId: nextRun, employeeId: emp, runLineId: line.id, type: "adjustment", value: "500", correctsRunId: approvedRun };
    // A correction needs a reason, must be an adjustment, and must name an approved or paid earlier run.
    expect(await savePayItem(fix)).toEqual({ ok: false, error: "Give a reason for this amount." });
    expect(await savePayItem({ ...fix, type: "loan", reason: "x" })).toEqual({ ok: false, error: "Only an adjustment or another deduction can correct an earlier run." });
    expect(await savePayItem({ ...fix, correctsRunId: nextRun, reason: "x" })).toEqual({ ok: false, error: "A correction must name an approved or paid earlier run." });
    expect(await savePayItem({ ...fix, correctsRunId: randomUUID(), reason: "x" })).toEqual({ ok: false, error: "A correction must name an approved or paid earlier run." });
    expect(await savePayItem({ ...fix, correctsRunId: "nope", reason: "x" })).toEqual({ ok: false, error: BAD });
    expect(await savePayItem({ ...fix, reason: "Missed holiday pay last cutoff" })).toMatchObject({ ok: true });

    const [item] = await rows<{ id: string; value_enc: string }>(sql`select id, value_enc from payroll.pay_run_items where run_id = ${nextRun} and type = 'adjustment' and state = 'confirmed'`);
    expect(decryptItemValue(item.id, item.value_enc)).toMatchObject({ value: 50_000n, correctsRunId: approvedRun });
    const [log] = await rows<{ id: string; detail_enc: string }>(sql`select id, detail_enc from payroll.pay_change_log where run_id = ${nextRun} and action = 'item_saved'`);
    expect(readChangeDetail(log)).toMatchObject({ type: "adjustment", correctsRunId: approvedRun, new: { value: "50000", correctsRunId: approvedRun } });
    expect((await getWorksheet(nextRun))!.lines.find((l) => l.employeeId === emp)!.items).toContainEqual(expect.objectContaining({ type: "adjustment", correctsRunId: approvedRun }));
    // An overpayment is corrected with a deduction that names the run; the amount stays positive.
    const over = { runId: nextRun, employeeId: emp, runLineId: line.id, type: "other_deduction", value: "200", reason: "Paid twice for one day", correctsRunId: approvedRun };
    expect(await savePayItem({ ...over, value: "-200" })).toEqual({ ok: false, error: BAD });
    expect(await savePayItem(over)).toMatchObject({ ok: true });
    const [deduction] = await rows<{ id: string; value_enc: string }>(sql`select id, value_enc from payroll.pay_run_items where run_id = ${nextRun} and type = 'other_deduction'`);
    expect(decryptItemValue(deduction.id, deduction.value_enc)).toMatchObject({ value: 20_000n, correctsRunId: approvedRun });

    // Someone who had no line on the corrected run can't be given a correction of it.
    const [theirs] = await runLines(nextRun, newcomer);
    expect(await savePayItem({ runId: nextRun, employeeId: newcomer, runLineId: theirs.id, type: "adjustment", value: "100", reason: "x", correctsRunId: approvedRun })).toEqual({
      ok: false,
      error: "That person had no line on the run being corrected.",
    });

    // The approved run itself is untouched.
    expect(await rows(sql`select 1 from payroll.pay_run_items where run_id = ${approvedRun}`)).toHaveLength(0);
  });
});

describe("the dashboard count", () => {
  it("counts runs waiting for this Approver, leaves out runs they touched, and refuses anyone else", async () => {
    const fresh = await account("approver");
    as(fresh);
    const base = await payrollRunsAwaitingApproval();
    const p = slot(14);
    const emp = await person();
    await giveLine(emp, p);
    const runId = await newRun(p);
    as(preparer);
    expect(await submitRun({ runId })).toMatchObject({ ok: true });
    as(fresh);
    expect(await payrollRunsAwaitingApproval()).toBe(base + 1);
    // An Approver who prepared the run is not counted for it.
    await db.execute(sql`update core.users set payroll_access = 'approver' where id = ${preparer.id}`);
    try {
      as({ ...preparer, payrollAccess: "approver" });
      const forPreparer = await payrollRunsAwaitingApproval();
      as(fresh);
      expect(forPreparer).toBeLessThan(await payrollRunsAwaitingApproval());
    } finally {
      await db.execute(sql`update core.users set payroll_access = 'preparer' where id = ${preparer.id}`);
    }
    as(preparer);
    await expect(payrollRunsAwaitingApproval()).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});
