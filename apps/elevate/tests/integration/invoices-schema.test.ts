import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Real-database test: the invoice tables are protected in the database itself (RLS on, no policies, append-only by trigger).
// Invented data only.

vi.mock("server-only", () => ({}));

const { db } = await import("@/lib/db");

type Row = Record<string, unknown>;
const rows = async <T = Row>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}`;

/** The database error is the `cause` of the driver's "Failed query" error. */
async function refused(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    expect(err.cause?.message ?? err.message).toMatch(/append-only/);
    return;
  }
  throw new Error("expected the database to refuse the change");
}

let userId: string;
let clientId: string;
let rateId: string;

beforeAll(async () => {
  userId = randomUUID();
  await db.execute(sql`insert into core.users (id, email) values (${userId}, ${`${uniq("inv")}@example.com`})`);
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Testclinic ")}) returning id`);
  clientId = c.id;
  rateId = randomUUID();
  await db.execute(sql`insert into ops.client_bill_rates (id, client_id, effective_from, rate_enc, created_by) values (${rateId}, ${clientId}, '2031-01-01', 'v1:not-a-real-value', ${userId})`);
});

describe("row level security", () => {
  it("both invoice tables have RLS on and no policies", async () => {
    const tables = await rows<{ relname: string; relrowsecurity: boolean }>(sql`
      select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'ops' and c.relname in ('client_bill_rates', 'invoices') and c.relkind = 'r'`);
    expect(tables.map((t) => t.relname).sort()).toEqual(["client_bill_rates", "invoices"]);
    for (const t of tables) expect(t.relrowsecurity, t.relname).toBe(true);
    expect(await rows(sql`select 1 from pg_policies where schemaname = 'ops' and tablename in ('client_bill_rates', 'invoices')`)).toHaveLength(0);
  });
});

describe("billing rates are append-only", () => {
  it("refuses update, delete and truncate", async () => {
    await refused(db.execute(sql`update ops.client_bill_rates set effective_from = '2032-01-01' where id = ${rateId}`));
    await refused(db.execute(sql`delete from ops.client_bill_rates where id = ${rateId}`));
    await refused(db.execute(sql`truncate ops.client_bill_rates`));
    const [still] = await rows<{ effective_from: string }>(sql`select effective_from::text from ops.client_bill_rates where id = ${rateId}`);
    expect(still.effective_from).toBe("2031-01-01");
  });
});

describe("invoices are append-only", () => {
  it("refuses update, delete and truncate on an invoice", async () => {
    const [run] = await rows<{ id: string }>(sql`select id from payroll.pay_runs limit 1`);
    // A run is needed for the foreign key; make a bare one when the throwaway database has none yet.
    const runId = run?.id ?? (await rows<{ id: string }>(sql`
      insert into payroll.pay_runs (id, period_start, period_end, status, settings_snapshot, created_by)
      values (gen_random_uuid(), '2031-12-01', '2031-12-15', 'draft', '{}'::jsonb, ${userId}) returning id`))[0].id;
    const id = randomUUID();
    await db.execute(sql`
      insert into ops.invoices (id, number, year, seq, revision, run_id, client_id, run_status, issued_on, payload_enc, created_by)
      values (${id}, ${uniq("INV-TEST-")}, 2031, 1, 1, ${runId}, ${clientId}, 'draft', '2031-12-16', 'v1:x', ${userId})`);
    await refused(db.execute(sql`update ops.invoices set run_status = 'paid' where id = ${id}`));
    await refused(db.execute(sql`delete from ops.invoices where id = ${id}`));
    await refused(db.execute(sql`truncate ops.invoices`));
    expect(await rows(sql`select 1 from ops.invoices where id = ${id}`)).toHaveLength(1);
  });
});
