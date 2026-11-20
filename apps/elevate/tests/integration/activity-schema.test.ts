import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

// Real-database checks for the ELEVATE Tracker tables: append-only segments, one screenshot per window, RLS on everything.

const { db } = await import("@/lib/db");
/** The database's own message: drizzle wraps it in the error's cause. */
const dbMessage = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (e) {
    const err = e as { message: string; cause?: { message?: string } };
    return err.cause?.message ?? err.message;
  }
  return "";
};
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

let employeeId = "";
let deviceId = "";

beforeAll(async () => {
  const email = `trk${Date.now().toString(36)}@example.com`;
  const [u] = await rows<{ id: string }>(sql`insert into core.users (id, email) values (${randomUUID()}, ${email}) returning id`);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Track', 'Er', ${email}, 'active', ${u.id}) returning id`);
  employeeId = e.id;
  const [d] = await rows<{ id: string }>(sql`insert into time.tracker_devices (employee_id, name, os, token_hash) values (${employeeId}, 'Test PC', 'windows', ${randomUUID()}) returning id`);
  deviceId = d.id;
});

const insertSegment = (start: string, end: string) =>
  db.execute(sql`insert into time.activity_segments (employee_id, device_id, started_at, ended_at, app, state) values (${employeeId}, ${deviceId}, ${start}::timestamptz, ${end}::timestamptz, 'Chrome', 'active')`);

describe("activity segments", () => {
  it("can be inserted", async () => {
    await insertSegment("2026-11-19T10:00:00Z", "2026-11-19T10:05:00Z");
    const [r] = await rows<{ n: number }>(sql`select count(*)::int as n from time.activity_segments where employee_id = ${employeeId}`);
    expect(r.n).toBe(1);
  });

  it("cannot be updated, deleted or truncated", async () => {
    expect(await dbMessage(() => db.execute(sql`update time.activity_segments set app = 'Other' where employee_id = ${employeeId}`))).toMatch(/append-only/);
    expect(await dbMessage(() => db.execute(sql`delete from time.activity_segments where employee_id = ${employeeId}`))).toMatch(/append-only/);
    expect(await dbMessage(() => db.execute(sql`truncate time.activity_segments`))).toMatch(/append-only/);
  });

  it("must end after it starts", async () => {
    await expect(insertSegment("2026-11-19T11:00:00Z", "2026-11-19T11:00:00Z")).rejects.toThrow();
  });
});

describe("activity shots", () => {
  const shot = (window: number, path: string) =>
    db.execute(sql`insert into time.activity_shots (employee_id, device_id, window_index, storage_path, taken_at) values (${employeeId}, ${deviceId}, ${window}, ${path}, now())`);

  it("allows one screenshot per person per 10-minute window", async () => {
    await shot(100, `shots/${employeeId}/a.jpg`);
    await expect(shot(100, `shots/${employeeId}/b.jpg`)).rejects.toThrow();
    await shot(101, `shots/${employeeId}/c.jpg`);
  });
});

describe("tracker devices", () => {
  it("never lets the token hash change", async () => {
    expect(await dbMessage(() => db.execute(sql`update time.tracker_devices set token_hash = 'x' where id = ${deviceId}`))).toMatch(/token hash cannot change/);
  });
});

describe("row level security", () => {
  it("is on for every tracker table", async () => {
    const tables = ["tracker_devices", "tracker_enrollment_codes", "activity_segments", "activity_minutes", "activity_shots", "activity_categories", "activity_settings"];
    const found = await rows<{ relname: string; relrowsecurity: boolean }>(
      sql`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'time' and c.relname = any(${sql.raw(`array['${tables.join("','")}']`)})`,
    );
    expect(found).toHaveLength(tables.length);
    expect(found.every((r) => r.relrowsecurity)).toBe(true);
  });
});
