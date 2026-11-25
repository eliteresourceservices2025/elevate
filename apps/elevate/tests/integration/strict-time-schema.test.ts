import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

// Schema rules for strict time (design 2026-11-24): several schedules per person (one per client, no overlapping hours),
// the auto-stop clock source, and per-person daily caps.

const { db } = await import("@/lib/db");
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
let employeeId: string;
let clientA: string;
let clientB: string;

const schedule = (o: { client: string | null; start: string; end: string; weekdays?: number[]; from?: string; to?: string | null; allotted?: number | null }) =>
  db.execute(sql`insert into time.schedules (employee_id, client_id, allotted_minutes_per_day, effective_from, effective_to, start_time, end_time, weekdays, break_minutes, zone)
    values (${employeeId}, ${o.client}, ${o.allotted ?? null}, ${o.from ?? "2030-01-01"}::date, ${o.to ?? null}, ${o.start}, ${o.end},
      ${sql.raw(`array[${(o.weekdays ?? [1, 2, 3, 4, 5]).join(",")}]::smallint[]`)}, 0, 'America/Phoenix')`);

beforeAll(async () => {
  const userId = randomUUID();
  const email = `${uniq("st")}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${userId}, ${email})`);
  [{ id: employeeId }] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values ('Strict', ${uniq("Time")}, ${email}, 'active', ${userId}) returning id`);
  [{ id: clientA }] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Client A ")}) returning id`);
  [{ id: clientB }] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Client B ")}) returning id`);
});

describe("schedules for several clients", () => {
  it("accepts two clients on the same dates when their hours do not overlap", async () => {
    await schedule({ client: clientA, start: "09:00", end: "13:00", allotted: 240 });
    await expect(schedule({ client: clientB, start: "14:00", end: "18:00", allotted: 240 })).resolves.toBeDefined();
  });

  it("accepts a second schedule for the same client when the hours do not cross", async () => {
    await expect(schedule({ client: clientA, start: "19:00", end: "20:00" })).resolves.toBeDefined();
  });

  it("refuses overlapping hours on a shared weekday", async () => {
    const [{ id: clientC }] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Client C ")}) returning id`);
    await expect(schedule({ client: clientC, start: "12:00", end: "15:00" })).rejects.toThrow();
  });

  it("accepts overlapping hours when the weekdays do not share a day", async () => {
    const [{ id: clientD }] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Client D ")}) returning id`);
    await expect(schedule({ client: clientD, start: "09:00", end: "13:00", weekdays: [6, 7] })).resolves.toBeDefined();
  });
});

describe("clock event source", () => {
  it("accepts auto_stop as a source without a correction", async () => {
    await expect(db.execute(sql`insert into time.clock_events (employee_id, type, source) values (${employeeId}, 'clock_out', 'auto_stop')`)).resolves.toBeDefined();
  });
});

describe("daily caps and rules", () => {
  it("keeps a per-person cap between 1 and 960 minutes", async () => {
    await expect(db.execute(sql`update core.employees set daily_cap_minutes = 300 where id = ${employeeId}`)).resolves.toBeDefined();
    await expect(db.execute(sql`update core.employees set daily_cap_minutes = 0 where id = ${employeeId}`)).rejects.toThrow();
    await expect(db.execute(sql`update core.employees set daily_cap_minutes = 961 where id = ${employeeId}`)).rejects.toThrow();
  });

  it("starts the company rules at an 8 hour cap, a 60 minute break and a 10 minute warning", async () => {
    const found = await rows<{ column_name: string; column_default: string }>(sql`select column_name, column_default from information_schema.columns
      where table_schema = 'time' and table_name = 'clock_rules' and column_name in ('default_daily_cap_minutes', 'default_break_minutes', 'auto_stop_warn_minutes')`);
    const byName = Object.fromEntries(found.map((c) => [c.column_name, c.column_default]));
    expect(byName).toEqual({ default_daily_cap_minutes: "480", default_break_minutes: "60", auto_stop_warn_minutes: "10" });
  });
});
