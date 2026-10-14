import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Remembered matches and layouts (phase 3) against the real database with invented people: a confirmed spelling is used by the next
// sheet, an invalid target is refused, the key is the normalized spelling, a match can be forgotten, and a header row finds the column
// choices made the last time.

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const svc = await import("@/modules/schedule-import/service");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function actor() {
  const id = randomUUID();
  const email = `${uniq("al")}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email };
}

describe("remembered matches", () => {
  it("matches a nickname spelling after it was confirmed once, and forgets it on request", async () => {
    const a = await actor();
    const first = uniq("Maribel");
    const last = uniq("Alias");
    const [emp] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status) values (${first}, ${last}, ${`${uniq("e")}@example.com`}, 'active') returning id`);
    const clientName = uniq("Alias Clinic ");
    const [client] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${clientName}) returning id`);

    const sheetName = `Mari ${last}`; // not the legal first name: no match by name
    const sheetClient = `${clientName.toUpperCase()} (north)`; // not the same client name either
    const batch = await svc.stageSheet(a, { fileName: "x.csv", layout: "table", columns: null, observations: [{ date: "2026-10-05", name: sheetName, client: sheetClient, schedule: "8:00 am - 5:00 pm AZ", row: 1 }], sha256: "e".repeat(64) });

    const before = await svc.planForBatch(batch.batchId);
    expect(before!.plan.decisions).toHaveLength(1);
    expect(before!.plan.decisions[0].kind).toBe("person");

    await svc.saveAlias(a, { kind: "person", sheetValue: sheetName, targetId: emp.id });
    await svc.saveAlias(a, { kind: "client", sheetValue: sheetClient, targetId: client.id });

    const after = await svc.planForBatch(batch.batchId);
    expect(after!.plan.decisions).toHaveLength(0);
    expect(after!.plan.rows[0]).toMatchObject({ personId: emp.id, clientId: client.id });

    // choosing again for the same spelling replaces the earlier choice (one row per spelling)
    await svc.saveAlias(a, { kind: "person", sheetValue: `${last}, Mari`, targetId: emp.id });
    const stored = await rows<{ n: number }>(sql`select count(*)::int as n from ops.schedule_import_aliases where employee_id = ${emp.id}`);
    expect(stored[0].n).toBe(1);

    // the audit says what kind, never the spelling
    const audit = JSON.stringify(await rows(sql`select action, after from ops.audit_log where action like 'scheduleimport.alias%' and target_id = ${emp.id}`));
    expect(audit).toContain("alias_save");
    expect(audit).not.toContain(last);

    const [alias] = await rows<{ id: string }>(sql`select id from ops.schedule_import_aliases where employee_id = ${emp.id}`);
    await svc.removeAlias(a, alias.id);
    const gone = await svc.planForBatch(batch.batchId);
    expect(gone!.plan.decisions.length).toBeGreaterThan(0);
  });

  it("refuses a target that is not an active person or client", async () => {
    const a = await actor();
    await expect(svc.saveAlias(a, { kind: "person", sheetValue: "Nobody Here", targetId: randomUUID() })).rejects.toThrow(/not found/);
    await expect(svc.saveAlias(a, { kind: "client", sheetValue: "Nowhere", targetId: randomUUID() })).rejects.toThrow(/not found/);
    const name = uniq("Inactive Clinic ");
    const [c] = await rows<{ id: string }>(sql`insert into core.clients (name, is_active) values (${name}, false) returning id`);
    await expect(svc.saveAlias(a, { kind: "client", sheetValue: "Inactive", targetId: c.id })).rejects.toThrow(/inactive/);
    await expect(svc.removeAlias(a, randomUUID())).rejects.toThrow(/not found/);
  });

  it("the database keeps an alias pointing at exactly one kind of record", async () => {
    await expect(db.execute(sql`insert into ops.schedule_import_aliases (kind, sheet_key) values ('person', ${uniq("k")})`)).rejects.toThrow();
  });
});

describe("remembered layouts", () => {
  it("finds the column choices again from the header row, ignoring case and punctuation", async () => {
    const a = await actor();
    const headers = [uniq("Staff"), "Account", "Shift Text", "Day"];
    expect(await svc.findLayout(headers)).toBeNull();
    await svc.saveLayout(a, headers, { name: 0, client: 1, schedule: 2, date: 3, clockIn: null });
    expect(await svc.findLayout(headers.map((h) => h.toUpperCase()))).toEqual({ name: 0, client: 1, schedule: 2, date: 3, clockIn: null });
    // a repeat save updates the same layout
    await svc.saveLayout(a, headers, { name: 0, client: 1, schedule: 2, date: null, clockIn: null });
    expect((await svc.findLayout(headers))!.date).toBeNull();
  });
});
