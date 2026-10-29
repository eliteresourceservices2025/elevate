import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "@/lib/db";
import type { JibbleClient } from "@/modules/jibble/http-client";
import { runJibbleRepair } from "@/modules/jibble/jobs";

it("rotates mismatch checks across more people than fit in one run", async () => {
  const label = `Fair${randomUUID()}`;
  const [department] = (await db.execute(sql`insert into core.departments (name) values (${label}) returning id`)) as unknown as { id: string }[];
  const [team] = (await db.execute(sql`insert into core.teams (name, department_id) values (${label}, ${department.id}) returning id`)) as unknown as { id: string }[];
  await db.execute(sql`insert into time.clock_rules (team_id, jibble_mirror) values (${team.id}, true)`);
  await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, team_id)
    select ${label}, n::text, ${label} || n::text || '@example.com', 'active', ${team.id}::uuid from generate_series(1, 151) n`);
  await db.execute(sql`insert into time.jibble_people (employee_id, jibble_person_id, matched_by)
    select id, gen_random_uuid()::text, 'manual' from core.employees where team_id = ${team.id}::uuid`);
  await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at)
    select id, 'clock_in', now() - interval '30 minutes' from core.employees where team_id = ${team.id}::uuid`);
  const fake: JibbleClient = { listPeople: async () => [], listBreaks: async () => [], dailyTracked: async () => [], latestState: async () => null, clock: async () => { throw new Error("unexpected send"); } };
  process.env.JIBBLE_COORDINATION_ENABLED = "true";
  process.env.ELEVATE_ENV = "production"; // Fake client only; no network calls.
  try {
    for (let i = 0; i < 4; i++) await runJibbleRepair(new Date(Date.now() + i * 60_000), fake);
    const [checked] = (await db.execute(sql`select count(*)::int as n from time.jibble_check_cursor c join core.employees e on e.id = c.employee_id where e.team_id = ${team.id}::uuid`)) as unknown as { n: number }[];
    expect(checked.n).toBe(151);
  } finally {
    await db.execute(sql`update core.employees set status = 'separated' where team_id = ${team.id}::uuid`);
    await db.execute(sql`update time.clock_rules set jibble_mirror = false where team_id = ${team.id}::uuid`);
    delete process.env.JIBBLE_COORDINATION_ENABLED;
    delete process.env.ELEVATE_ENV;
  }
}, 120_000);
