import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Real-database tests for the payroll schema: append-only tables, the freeze triggers on runs, and the encrypted change log.
// Invented names and figures only.

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");
const { fieldCrypto } = await import("@/lib/crypto");
const { ActionFailure } = await import("@/lib/run-action");
const { logChange, readChangeDetail } = await import("@/modules/payroll/changes");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
/** The driver wraps the database message as the cause of "Failed query", so look at both. */
async function raises(p: PromiseLike<unknown>, pattern: RegExp) {
  try {
    await p;
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    expect(`${err.message} ${err.cause?.message ?? ""}`).toMatch(pattern);
    return;
  }
  throw new Error(`Expected a database error matching ${pattern}`);
}
const enc = (plain: string, context: string) => fieldCrypto().encrypt(plain, context);

let actorId: string;
let employeeId: string;
let counter = 0;

beforeAll(async () => {
  actorId = randomUUID();
  await db.execute(sql`insert into core.users (id, email) values (${actorId}, ${`payroll-actor-${Date.now()}@example.com`})`);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status)
    values ('Maria', 'Testcruz', ${`maria-${Date.now()}@example.com`}, 'active') returning id`);
  employeeId = e.id;
});

async function advance(runId: string, to: string) {
  const order = ["in_review", "approved", "paid"];
  for (const s of order.slice(0, order.indexOf(to) + 1)) await db.execute(sql`update payroll.pay_runs set status = ${s} where id = ${runId}`);
}
async function newRun(status = "draft") {
  const start = `2030-${String(1 + (counter % 12)).padStart(2, "0")}-${String(1 + Math.floor(counter / 12)).padStart(2, "0")}`;
  counter++;
  const [r] = await rows<{ id: string }>(sql`
    insert into payroll.pay_runs (period_start, period_end, status, settings_snapshot, created_by)
    values (${start}::date, ${start}::date + 14, 'draft', '{}'::jsonb, ${actorId}) returning id`);
  if (status !== "draft") await advance(r.id, status);
  return r.id;
}
async function addRunLine(runId: string) {
  const lineId = randomUUID();
  const id = randomUUID();
  await db.execute(sql`
    insert into payroll.pay_lines (id, line_key, employee_id, hours_per_day, fte, effective_from, amounts_enc, created_by)
    values (${lineId}, ${randomUUID()}, ${employeeId}, 8, 1.00, '2030-01-01', ${enc("{}", `pay_line:${lineId}`)}, ${actorId})`);
  await db.execute(sql`
    insert into payroll.pay_run_lines (id, run_id, line_id, employee_id, flags, payload_enc)
    values (${id}, ${runId}, ${lineId}, ${employeeId}, '{}', ${enc("{}", `pay_run_line:${id}`)})`);
  return { id, lineId };
}
const itemInsert = (runId: string) => {
  const id = randomUUID();
  return db.execute(sql`
    insert into payroll.pay_run_items (id, run_id, employee_id, type, state, value_enc, entered_by)
    values (${id}, ${runId}, ${employeeId}, 'loan', 'confirmed', ${enc("{}", `pay_run_item:${id}`)}, ${actorId})`);
};

describe("append-only tables", () => {
  it("pay_settings, pay_lines, pay_run_items, pay_approvals, pay_payments and pay_change_log reject update and delete", async () => {
    const runId = await newRun();
    await addRunLine(runId);
    await itemInsert(runId);
    const approvalId = randomUUID();
    await db.execute(sql`insert into payroll.pay_approvals (id, run_id, decision, run_hash_enc, decided_by)
      values (${approvalId}, ${runId}, 'sent_back', ${enc("h", `pay_approval:${approvalId}`)}, ${actorId})`);
    const paymentId = randomUUID();
    await db.execute(sql`insert into payroll.pay_payments (id, run_id, employee_id, reference_enc, paid_on, marked_by)
      values (${paymentId}, ${runId}, ${employeeId}, ${enc("ref", `pay_payment:${paymentId}`)}, '2030-02-01', ${actorId})`);
    await logChange(db as never, { id: actorId }, { action: "run_created", runId });

    const checks: [string, string][] = [
      ["pay_settings", "cutoff_divisor = 12"],
      ["pay_lines", "alias = 'x'"],
      ["pay_run_items", "state = 'dismissed'"],
      ["pay_approvals", "decision = 'approved'"],
      ["pay_payments", "paid_on = '2030-03-01'"],
      ["pay_change_log", "action = 'run_paid'"],
    ];
    for (const [table, setClause] of checks) {
      await raises(db.execute(sql.raw(`update payroll.${table} set ${setClause} where true`)), /append-only/);
      await raises(db.execute(sql.raw(`delete from payroll.${table} where true`)), /append-only/);
    }
  });

  it("seeds the settings row with divisor 11, warn 1000 and no multipliers", async () => {
    const [s] = await rows<Record<string, unknown>>(sql`select * from payroll.pay_settings order by effective_from limit 1`);
    expect(s.cutoff_divisor).toBe(11);
    expect(s.change_warn_bp).toBe(1000);
    expect(s.extra_regular_bp).toBeNull();
    expect(s.holiday_bp).toBeNull();
  });
});

describe("run freeze", () => {
  it.each(["in_review", "approved", "paid"])("a run in %s refuses line changes, line removal and new items", async (status) => {
    const runId = await newRun();
    const { id } = await addRunLine(runId);
    await advance(runId, status);
    await raises(db.execute(sql`update payroll.pay_run_lines set alias = 'x' where id = ${id}`), /frozen/);
    await raises(db.execute(sql`delete from payroll.pay_run_lines where id = ${id}`), /frozen/);
    await raises(itemInsert(runId), /frozen/);
  });

  it("a draft run accepts line changes, line removal and items", async () => {
    const runId = await newRun();
    const { id } = await addRunLine(runId);
    await db.execute(sql`update payroll.pay_run_lines set alias = 'x' where id = ${id}`);
    await itemInsert(runId);
    await db.execute(sql`delete from payroll.pay_run_lines where id = ${id}`);
  });
});

describe("run status transitions", () => {
  const to = (runId: string, s: string) => db.execute(sql`update payroll.pay_runs set status = ${s} where id = ${runId}`);

  it("allows draft to in_review, in_review to draft, in_review to approved, approved to paid", async () => {
    const runId = await newRun();
    await to(runId, "in_review");
    await to(runId, "draft");
    await to(runId, "in_review");
    await to(runId, "approved");
    await to(runId, "paid");
  });

  it.each([
    ["draft", "approved"],
    ["draft", "paid"],
    ["in_review", "paid"],
    ["approved", "draft"],
    ["approved", "in_review"],
  ])("refuses %s to %s", async (from, target) => {
    const runId = await newRun(from);
    await raises(to(runId, target), /transition/);
  });

  it("a paid run cannot change", async () => {
    const runId = await newRun("paid");
    await expect(to(runId, "draft")).rejects.toThrow();
    await raises(db.execute(sql`update payroll.pay_runs set submitted_by = ${actorId} where id = ${runId}`), /paid/);
  });

  it("usd_rate_e4 and settings_snapshot change only in draft", async () => {
    const runId = await newRun();
    await db.execute(sql`update payroll.pay_runs set usd_rate_e4 = 585000, settings_snapshot = '{"a":1}'::jsonb where id = ${runId}`);
    await to(runId, "in_review");
    await raises(db.execute(sql`update payroll.pay_runs set usd_rate_e4 = 590000 where id = ${runId}`), /draft/);
    await raises(db.execute(sql`update payroll.pay_runs set settings_snapshot = '{}'::jsonb where id = ${runId}`), /draft/);
    await to(runId, "approved");
    await raises(db.execute(sql`update payroll.pay_runs set usd_rate_e4 = 590000 where id = ${runId}`), /draft/);
  });

  it("refuses two runs for the same period", async () => {
    const runId = await newRun();
    const [r] = await rows<{ period_start: string; period_end: string }>(
      sql`select period_start::text, period_end::text from payroll.pay_runs where id = ${runId}`,
    );
    await expect(
      db.execute(
        sql`insert into payroll.pay_runs (period_start, period_end, settings_snapshot, created_by) values (${r.period_start}::date, ${r.period_end}::date, '{}'::jsonb, ${actorId})`,
      ),
    ).rejects.toThrow();
  });
});

describe("change log", () => {
  it("stores the detail encrypted and readChangeDetail returns it", async () => {
    const marker = `marker-${randomUUID()}`;
    const runId = await newRun();
    await logChange(db as never, { id: actorId }, { action: "item_saved", runId, employeeId, detail: { note: marker, n: 3 } });
    const [row] = await rows<{ id: string; detail_enc: string; action: string; actor_id: string }>(
      sql`select id, detail_enc, action, actor_id from payroll.pay_change_log where run_id = ${runId} and action = 'item_saved'`,
    );
    expect(row.actor_id).toBe(actorId);
    expect(JSON.stringify(row)).not.toContain(marker);
    expect(readChangeDetail(row)).toEqual({ note: marker, n: 3 });
  });

  it("a detail copied to another row does not decrypt", async () => {
    const runId = await newRun();
    await logChange(db as never, { id: actorId }, { action: "item_saved", runId, detail: { secret: "x" } });
    await logChange(db as never, { id: actorId }, { action: "item_saved", runId, detail: { other: "y" } });
    const both = await rows<{ id: string; detail_enc: string }>(
      sql`select id, detail_enc from payroll.pay_change_log where run_id = ${runId} order by created_at, id`,
    );
    expect(both).toHaveLength(2);
    expect(() => readChangeDetail({ id: both[1].id, detail_enc: both[0].detail_enc })).toThrow();
  });

  it("run_viewed logs once per person, run and day", async () => {
    const runId = await newRun();
    for (let i = 0; i < 3; i++) await logChange(db as never, { id: actorId }, { action: "run_viewed", runId });
    const found = await rows(sql`select 1 from payroll.pay_change_log where run_id = ${runId} and action = 'run_viewed'`);
    expect(found).toHaveLength(1);
  });

  it("leaves no row when the transaction throws ActionFailure", async () => {
    const runId = await newRun();
    await expect(
      db.transaction(async (tx) => {
        await logChange(tx, { id: actorId }, { action: "run_created", runId });
        throw new ActionFailure("stop");
      }),
    ).rejects.toThrow("stop");
    expect(await rows(sql`select 1 from payroll.pay_change_log where run_id = ${runId}`)).toHaveLength(0);
  });
});

describe("row level security", () => {
  it("every payroll table has RLS on and no policies", async () => {
    const tables = await rows<{ relname: string; relrowsecurity: boolean }>(sql`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'payroll' and c.relkind = 'r'`);
    expect(tables.map((t) => t.relname).sort()).toEqual([
      "pay_approvals",
      "pay_change_log",
      "pay_lines",
      "pay_payments",
      "pay_run_items",
      "pay_run_lines",
      "pay_runs",
      "pay_settings",
    ]);
    for (const t of tables) expect(t.relrowsecurity, t.relname).toBe(true);
    expect(await rows(sql`select 1 from pg_policies where schemaname = 'payroll'`)).toHaveLength(0);
  });
});
