import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeStorage } from "./fake-storage";

// Real-database tests for the people records retention job (docs/modules/people-retention-design.md).

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const retention = await import("@/modules/people/retention");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const fake = new FakeStorage();
const NOW = new Date("2026-10-14T12:00:00Z");
const yearsAgo = (years: number) => new Date(Date.UTC(NOW.getUTCFullYear() - Math.floor(years), NOW.getUTCMonth() - Math.round((years % 1) * 12), 1)).toISOString().slice(0, 10);

async function person(opts: { status: string; endDate: string | null; hold?: boolean }) {
  const id = randomUUID();
  await db.execute(sql`
    insert into core.employees (id, legal_first_name, legal_last_name, work_email, personal_email, mobile, status, end_date, legal_hold_at, legal_hold_reason)
    values (${id}, 'Maria', 'Santos', ${`ret-${id}@example.com`}, 'maria.private@example.com', '+639170000000', ${opts.status}, ${opts.endDate},
            ${opts.hold ? sql`now()` : sql`null`}, ${opts.hold ? "Open dispute" : null})`);
  await db.execute(sql`insert into core.employee_sensitive (employee_id) values (${id})`);
  await db.execute(sql`insert into core.emergency_contacts (employee_id, name, relationship, phone) values (${id}, 'Ana Santos', 'Sister', '+639180000000')`);
  return id;
}

const get = async (id: string) =>
  (await rows<{ legal_first_name: string; personal_email: string | null; retention_archived_at: Date | null; anonymized_at: Date | null }>(
    sql`select legal_first_name, personal_email, retention_archived_at, anonymized_at from core.employees where id = ${id}`,
  ))[0];

beforeAll(() => setDocumentStorage(fake));
afterAll(async () => {
  await db.execute(sql`delete from core.people_retention_settings`);
});

describe("people retention job", () => {
  it("does nothing until HR switches it on", async () => {
    const id = await person({ status: "separated", endDate: yearsAgo(7) });
    await db.execute(sql`delete from core.people_retention_settings`);
    expect(await retention.runPeopleRetention(NOW)).toEqual({ enabled: false, archived: 0, anonymized: 0 });
    expect((await get(id)).anonymized_at).toBeNull();
  });

  it("archives after five years, anonymizes after six, and skips held, active and undated records", async () => {
    await db.execute(sql`insert into core.people_retention_settings (id, enabled) values (1, true) on conflict (id) do update set enabled = true, archive_after_months = 60, anonymize_after_months = 72`);
    const recent = await person({ status: "separated", endDate: yearsAgo(4) });
    const toArchive = await person({ status: "separated", endDate: yearsAgo(5.5) });
    const toAnonymize = await person({ status: "separated", endDate: yearsAgo(7) });
    const held = await person({ status: "separated", endDate: yearsAgo(7), hold: true });
    const active = await person({ status: "active", endDate: null });
    const undated = await person({ status: "separated", endDate: null });

    const result = await retention.runPeopleRetention(NOW);
    expect(result.enabled).toBe(true);
    expect(result.archived).toBeGreaterThanOrEqual(1);
    expect(result.anonymized).toBeGreaterThanOrEqual(1);

    expect(await get(recent)).toMatchObject({ retention_archived_at: null, anonymized_at: null, legal_first_name: "Maria" });
    const archived = await get(toArchive);
    expect(archived.retention_archived_at).not.toBeNull();
    expect(archived.anonymized_at).toBeNull();
    expect(archived.legal_first_name).toBe("Maria");

    const gone = await get(toAnonymize);
    expect(gone).toMatchObject({ legal_first_name: "Removed", personal_email: null });
    expect(gone.anonymized_at).not.toBeNull();
    const [leftover] = await rows<{ s: number; c: number }>(sql`select (select count(*)::int from core.employee_sensitive where employee_id = ${toAnonymize}) as s, (select count(*)::int from core.emergency_contacts where employee_id = ${toAnonymize}) as c`);
    expect(leftover).toEqual({ s: 0, c: 0 });

    for (const id of [held, active, undated]) expect(await get(id)).toMatchObject({ retention_archived_at: null, anonymized_at: null, legal_first_name: "Maria" });

    // Audit entries carry counts and ids, never values.
    const [audit] = await rows<{ metadata: Record<string, number> }>(sql`select metadata from ops.audit_log where action = 'retention.anonymize' and target_id = ${toAnonymize}`);
    expect(audit.metadata).toMatchObject({ sensitive: 1, contacts: 1 });
    expect(JSON.stringify(audit)).not.toContain("Santos");

    // A second run finds nothing more for these people.
    const again = await retention.runPeopleRetention(NOW);
    expect(await get(toAnonymize)).toMatchObject({ legal_first_name: "Removed" });
    expect(again.anonymized).toBe(0);
  });

  it("refuses an ordinary update to an anonymized record", async () => {
    const id = await person({ status: "separated", endDate: yearsAgo(7) });
    await retention.runPeopleRetention(NOW);
    await expect(db.execute(sql`update core.employees set legal_first_name = 'Maria' where id = ${id}`)).rejects.toThrow();
  });
});
