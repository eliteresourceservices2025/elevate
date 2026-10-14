import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// The attendance-sheet preview against the real database (invented people): staging encrypts the rows and audits counts only, the
// preview compares with live assignments and schedules and writes NOTHING, and discarding or expiring wipes the encrypted payload.

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const svc = await import("@/modules/schedule-import/service");
const { readDayBlocks } = await import("@/modules/schedule-import/reader");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function makeUser() {
  const id = randomUUID();
  const email = `${uniq("si")}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email };
}

describe("schedule import preview", () => {
  it("stages encrypted, previews against live data, writes nothing, and discards", async () => {
    const actor = await makeUser();
    const first = uniq("Zelda");
    const last = uniq("Testperson");
    const clientName = uniq("Preview Clinic ");
    const [client] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${clientName}) returning id`);
    const [emp] = await rows<{ id: string }>(sql`
      insert into core.employees (legal_first_name, legal_last_name, work_email, status, start_date)
      values (${first}, ${last}, ${`${uniq("e")}@example.com`}, 'active', '2025-01-01') returning id`);

    const sheet = [
      ["10/05/26", "", "", "", ""],
      ["Monday", "Name", "Client", "Schedule", "In"],
      ["", `${first} ${last}`, clientName, "8:00 am - 5:00 pm AZ", "7:55 AM"],
    ];
    const read = readDayBlocks(sheet);
    expect(read.observations).toHaveLength(1);

    const staged = await svc.stageSheet({ id: actor.id, email: actor.email }, { fileName: "invented.csv", layout: "day_blocks", columns: null, observations: read.observations, sha256: "a".repeat(64) });
    const [stored] = await rows<{ payload_enc: string; observation_count: number }>(sql`select payload_enc, observation_count from ops.schedule_import_batches where id = ${staged.batchId}`);
    expect(stored.observation_count).toBe(1);
    expect(stored.payload_enc).not.toContain(first);
    expect(stored.payload_enc).not.toContain(clientName);

    // the audit entry holds counts, never the names
    const audit = await rows<{ after: unknown }>(sql`select after from ops.audit_log where action = 'scheduleimport.stage' and target_id = ${staged.batchId}`);
    expect(JSON.stringify(audit)).not.toContain(first);
    expect(JSON.stringify(audit)).not.toContain(clientName);

    const before = await rows<{ a: number; s: number }>(sql`select (select count(*)::int from core.client_assignments) as a, (select count(*)::int from time.schedules) as s`);
    const preview = await svc.planForBatch(staged.batchId);
    const row = preview!.plan.rows.find((r) => r.personId === emp.id)!;
    expect(row).toMatchObject({ clientId: client.id, assignment: "add", schedule: "add", startTime: "08:00", endTime: "17:00", zone: "America/Phoenix", hoursPerWeek: 40, firstDay: "2026-10-05" });
    const after = await rows<{ a: number; s: number }>(sql`select (select count(*)::int from core.client_assignments) as a, (select count(*)::int from time.schedules) as s`);
    expect(after).toEqual(before);

    // once the person has the client, the same sheet is "keep" and the hours are to be filled
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${emp.id}, ${client.id}, '2026-10-01')`);
    const again = await svc.planForBatch(staged.batchId);
    expect(again!.plan.rows.find((r) => r.personId === emp.id)).toMatchObject({ assignment: "keep", hoursNote: "fill" });

    await svc.discardBatch({ id: actor.id, email: actor.email }, staged.batchId);
    const [gone] = await rows<{ payload_enc: string | null; status: string }>(sql`select payload_enc, status from ops.schedule_import_batches where id = ${staged.batchId}`);
    expect(gone).toEqual({ payload_enc: null, status: "discarded" });
    expect(await svc.planForBatch(staged.batchId)).toBeNull();
  });

  it("refuses a sheet with nothing readable and wipes stale previews", async () => {
    const actor = await makeUser();
    await expect(svc.stageSheet({ id: actor.id, email: actor.email }, { fileName: "empty.csv", layout: "table", columns: null, observations: [], sha256: "b".repeat(64) })).rejects.toThrow(/No days/);
    const staged = await svc.stageSheet(
      { id: actor.id, email: actor.email },
      { fileName: "old.csv", layout: "table", columns: { name: 0, client: 1, schedule: 2, date: null, clockIn: null }, observations: [{ date: null, name: "A B", client: "C", schedule: "8:00 am - 5:00 pm AZ", row: 1 }], sha256: "c".repeat(64) },
    );
    await db.execute(sql`update ops.schedule_import_batches set created_at = now() - interval '15 days' where id = ${staged.batchId}`);
    expect(await svc.purgeStaleScheduleBatches(new Date())).toBeGreaterThanOrEqual(1);
    const [row] = await rows<{ payload_enc: string | null }>(sql`select payload_enc from ops.schedule_import_batches where id = ${staged.batchId}`);
    expect(row.payload_enc).toBeNull();
  });
});
