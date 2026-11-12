import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { endPayrollLinesWhenDone } from "./payroll-test-helpers";

// Real-database test: test runs (practice runs). Invented people only. Every period is in 2036 (no other file uses it) and each test uses
// its own half month; the pay lines are ended afterwards by the shared helper.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
endPayrollLinesWhenDone(db);
const { createPayLine, createPayRun, markRunAsTest, archivePayRun, restorePayRun } = await import("@/modules/payroll/actions");
const { getRuns } = await import("@/modules/payroll/queries");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

async function account(level: string | null) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, payroll_access) values (${id}, ${`${uniq("tr")}@example.com`}, ${level})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  return { id, email: `${id}@example.com`, roles: ["employee"], payrollAccess: level };
}
async function person() {
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status)
    values ('Tess', ${uniq("Testreyes")}, ${`${uniq("emp")}@example.com`}, 'active') returning id`);
  return e.id;
}
/** Half month `n` of 2036: 0 is 1 to 15 January, 1 is 16 to 31 January, 2 is 1 to 15 February... */
function slot(n: number) {
  const month = Math.floor(n / 2) + 1;
  const mm = String(month).padStart(2, "0");
  const last = new Date(Date.UTC(2036, month, 0)).getUTCDate();
  return n % 2 === 0 ? { periodStart: `2036-${mm}-01`, periodEnd: `2036-${mm}-15` } : { periodStart: `2036-${mm}-16`, periodEnd: `2036-${mm}-${last}` };
}
const as = (who: unknown) => {
  current.user = who;
};

let preparer: Awaited<ReturnType<typeof account>>;
let approver: Awaited<ReturnType<typeof account>>;
let viewer: Awaited<ReturnType<typeof account>>;
let emp: string;

async function newRun(p: { periodStart: string; periodEnd: string }, test = false) {
  as(preparer);
  const r = await createPayRun({ ...p, ...(test ? { test: true } : {}) });
  if (!r.ok) throw new Error(`run failed: ${r.error}`);
  return r.data.runId;
}
const runRow = async (id: string) => (await rows<{ status: string; is_test: boolean; archived_at: string | null; archived_by: string | null }>(sql`select status, is_test, archived_at::text, archived_by::text from payroll.pay_runs where id = ${id}`))[0];
/** A run row put straight into a status (the guard allows any insert), for the states that need a whole approval to reach. */
async function insertRun(p: { periodStart: string; periodEnd: string }, status: string, isTest: boolean) {
  const id = randomUUID();
  await db.execute(sql`insert into payroll.pay_runs (id, period_start, period_end, status, settings_snapshot, created_by, is_test)
    values (${id}, ${p.periodStart}, ${p.periodEnd}, ${status}, '{}'::jsonb, ${preparer.id}, ${isTest})`);
  return id;
}
async function dbRefuses(p: Promise<unknown>, message: RegExp) {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    expect(err.cause?.message ?? err.message).toMatch(message);
    return;
  }
  throw new Error("expected the database to refuse the change");
}

beforeAll(async () => {
  preparer = await account("preparer");
  approver = await account("approver");
  viewer = await account("viewer");
  emp = await person();
  as(preparer);
  const r = await createPayLine({ employeeId: emp, hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2036-01-01", monthly: "22,000" });
  if (!r.ok) throw new Error(`line failed: ${r.error}`);
});

describe("repeating a pay cycle", () => {
  it("refuses a second real run for a period, hints at the way out, and frees the period once the first is a test run", async () => {
    const p = slot(0);
    const first = await newRun(p);
    as(preparer);
    const again = await createPayRun(p);
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/already a pay run.*mark that run as a test run/) });

    expect(await markRunAsTest({ runId: first, test: true, reason: "Practice cycle" })).toMatchObject({ ok: true });
    expect(await runRow(first)).toMatchObject({ is_test: true, status: "draft" });
    const second = await createPayRun(p);
    expect(second.ok).toBe(true); // the period is free for a real run again
  });

  it("lets a test run repeat a period that already has a real run, any number of times", async () => {
    const p = slot(2);
    const real = await newRun(p);
    const t1 = await newRun(p, true);
    const t2 = await newRun(p, true);
    expect(new Set([real, t1, t2]).size).toBe(3);
    expect(await runRow(t1)).toMatchObject({ is_test: true });
    expect(await runRow(real)).toMatchObject({ is_test: false });
    // The real run still can't be duplicated by another real run.
    as(preparer);
    expect((await createPayRun(p)).ok).toBe(false);
  });

  it("a real run next to a test run for an overlapping period is fine, and the list marks which is which", async () => {
    const p = slot(4);
    const testId = await newRun(p, true);
    const realId = await newRun(p);
    as(approver);
    const list = await getRuns({ page: 1, pageSize: 200 });
    expect(list.rows.find((r) => r.id === testId)).toMatchObject({ isTest: true });
    expect(list.rows.find((r) => r.id === realId)).toMatchObject({ isTest: false });
  });
});

describe("marking a run as a test run", () => {
  it("works for a Preparer and an Approver, not for a viewer or someone with no level, and needs a reason", async () => {
    const id = await newRun(slot(6));
    for (const who of [viewer, await account(null)]) {
      as(who);
      expect(await markRunAsTest({ runId: id, test: true, reason: "Practice" })).toEqual({ ok: false, error: "You do not have access to do that." });
    }
    as(preparer);
    expect(await markRunAsTest({ runId: id, test: true, reason: "  " })).toEqual({ ok: false, error: "Check the request and try again." });
    as(approver);
    expect(await markRunAsTest({ runId: id, test: true, reason: "Practice cycle" })).toMatchObject({ ok: true });
    expect((await runRow(id)).is_test).toBe(true);
    // Doing it twice says so; nothing changes.
    expect(await markRunAsTest({ runId: id, test: true, reason: "Again" })).toMatchObject({ ok: false, error: "This run is already a test run." });
  });

  it("never marks a paid or cancelled run, so a real payout can't be hidden", async () => {
    const paid = await insertRun(slot(8), "paid", false);
    const cancelled = await insertRun(slot(8), "cancelled", false);
    as(preparer);
    expect(await markRunAsTest({ runId: paid, test: true, reason: "Hide it" })).toMatchObject({ ok: false, error: "A paid run can't be changed." });
    expect(await markRunAsTest({ runId: cancelled, test: true, reason: "Hide it" })).toMatchObject({ ok: false, error: "A cancelled run can't be changed." });
    expect((await runRow(paid)).is_test).toBe(false);
  });

  it("marks an approved run (for the test runs you already have) and then archives it", async () => {
    const approved = await insertRun(slot(10), "approved", false);
    as(preparer);
    expect(await markRunAsTest({ runId: approved, test: true, reason: "This was only a rehearsal" })).toMatchObject({ ok: true });
    expect(await archivePayRun({ runId: approved, reason: "Rehearsal finished" })).toMatchObject({ ok: true });
    expect(await runRow(approved)).toMatchObject({ is_test: true, status: "approved" });
  });

  it("makes a test run real again only while it is a draft and its period is free", async () => {
    const p = slot(12);
    const real = await newRun(p);
    const test = await newRun(p, true);
    as(preparer);
    // Another real run has the period: refused, and nothing changes.
    expect(await markRunAsTest({ runId: test, test: false, reason: "Real after all" })).toMatchObject({ ok: false, error: expect.stringMatching(/already a pay run/) });
    expect((await runRow(test)).is_test).toBe(true);
    // Free the period (the other becomes a test run): now it can.
    expect(await markRunAsTest({ runId: real, test: true, reason: "Practice" })).toMatchObject({ ok: true });
    expect(await markRunAsTest({ runId: test, test: false, reason: "Real after all" })).toMatchObject({ ok: true });
    expect((await runRow(test)).is_test).toBe(false);
    // An approved test run can never go back to being a real run.
    const approvedTest = await insertRun(slot(14), "approved", true);
    expect(await markRunAsTest({ runId: approvedTest, test: false, reason: "Real after all" })).toMatchObject({ ok: false, error: expect.stringMatching(/only while it is a draft/) });
  });
});

describe("archiving and restoring", () => {
  it("archives a test run out of the list, keeps it on record, and restores it", async () => {
    const id = await newRun(slot(16), true);
    as(preparer);
    expect(await archivePayRun({ runId: id, reason: "Practice cycle done" })).toMatchObject({ ok: true });
    const row = await runRow(id);
    expect(row.archived_at).not.toBeNull();
    expect(row.archived_by).toBe(preparer.id);

    const live = await getRuns({ page: 1, pageSize: 500 });
    expect(live.rows.some((r) => r.id === id)).toBe(false);
    const archived = await getRuns({ page: 1, pageSize: 500 }, { archived: true });
    expect(archived.rows.some((r) => r.id === id)).toBe(true);
    expect(archived.showingArchived).toBe(true);
    expect(live.archivedCount).toBeGreaterThan(0);

    expect(await archivePayRun({ runId: id, reason: "Again" })).toMatchObject({ ok: false, error: "This run is already archived." });
    // An archived draft can't be made real while hidden.
    expect(await markRunAsTest({ runId: id, test: false, reason: "Real" })).toMatchObject({ ok: false, error: "Restore this run first." });
    expect(await restorePayRun({ runId: id })).toMatchObject({ ok: true });
    expect((await runRow(id)).archived_at).toBeNull();
    expect((await getRuns({ page: 1, pageSize: 500 })).rows.some((r) => r.id === id)).toBe(true);
    expect(await restorePayRun({ runId: id })).toMatchObject({ ok: false, error: "This run is not archived." });
  });

  it("never archives a real run, through the action or straight in the database", async () => {
    const id = await newRun(slot(18));
    as(preparer);
    expect(await archivePayRun({ runId: id, reason: "Clean up" })).toMatchObject({ ok: false, error: expect.stringMatching(/Only a test run can be archived/) });
    await dbRefuses(db.execute(sql`update payroll.pay_runs set archived_at = now(), archived_by = ${preparer.id} where id = ${id}`), /Only a test run can be archived/);
    expect((await runRow(id)).archived_at).toBeNull();
  });

  it("archives a paid test run too, and archiving changes nothing else about the run", async () => {
    const paidTest = await insertRun(slot(20), "paid", true);
    as(approver);
    expect(await archivePayRun({ runId: paidTest, reason: "Payment practice done" })).toMatchObject({ ok: true });
    expect(await runRow(paidTest)).toMatchObject({ status: "paid", is_test: true });
    expect(await restorePayRun({ runId: paidTest })).toMatchObject({ ok: true });
    // The same update that archives may not also touch anything else.
    await dbRefuses(db.execute(sql`update payroll.pay_runs set archived_at = now(), archived_by = ${preparer.id}, submitted_by = ${approver.id} where id = ${paidTest}`), /changes nothing else/);
    // A paid run can still not change in any other way.
    await dbRefuses(db.execute(sql`update payroll.pay_runs set is_test = false where id = ${paidTest}`), /paid run cannot change/);
  });

  it("is for Preparers and Approvers only", async () => {
    const id = await newRun(slot(22), true);
    as(viewer);
    expect(await archivePayRun({ runId: id, reason: "Clean up" })).toEqual({ ok: false, error: "You do not have access to do that." });
    expect(await restorePayRun({ runId: id })).toEqual({ ok: false, error: "You do not have access to do that." });
    as(approver);
    expect(await archivePayRun({ runId: id, reason: "Clean up" })).toMatchObject({ ok: true });
  });
});

describe("the trail", () => {
  it("writes the change history and an audit row for each step, with ids and reasons only where allowed", async () => {
    const id = await newRun(slot(23), true);
    as(preparer);
    await archivePayRun({ runId: id, reason: "Zqreason cleanup" });
    await restorePayRun({ runId: id });
    const log = await rows<{ action: string }>(sql`select action from payroll.pay_change_log where run_id = ${id} order by created_at, id`);
    expect(log.map((l) => l.action)).toEqual(["run_created", "run_archived", "run_restored"]);
    const audits = await rows<{ action: string; metadata: unknown }>(sql`select action, metadata from ops.audit_log where target_id = ${id} order by id`);
    expect(audits.map((a) => a.action)).toEqual(["payroll.run.create", "payroll.run.archive", "payroll.run.restore"]);
    // The reason lives only in the encrypted change history, never in the audit entry.
    expect(JSON.stringify(audits)).not.toContain("Zqreason");
  });
});
