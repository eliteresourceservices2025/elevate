import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Applying an attendance-sheet import (phase 2) against the real database with invented people: adds, a client change that closes the
// old assignment the day before, a schedule replaced, hours filled, a row skipped because of a later-dated schedule while the rest go
// ahead, a stale preview refused, backdating needing acknowledgment, ticked people ended, and nothing personal in the audit.

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const svc = await import("@/modules/schedule-import/service");
const apply = await import("@/modules/schedule-import/apply");
const { todayInZone } = await import("@/modules/org/service");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const plus = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const TODAY = todayInZone();

async function actor() {
  const id = randomUUID();
  const email = `${uniq("ap")}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email };
}
async function person() {
  const first = uniq("Qora");
  const last = uniq("Applyperson");
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, start_date) values (${first}, ${last}, ${`${uniq("e")}@example.com`}, 'active', '2025-01-01') returning id`);
  return { id: e.id, first, last, sheet: `${first} ${last}` };
}
async function client() {
  const name = uniq("Apply Clinic ");
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${name}) returning id`);
  return { id: c.id, name };
}
const obs = (name: string, clientName: string, schedule: string, date: string) => ({ date, name, client: clientName, schedule, row: 1 });
const stage = (a: { id: string; email: string }, observations: ReturnType<typeof obs>[]) =>
  svc.stageSheet(a, { fileName: "invented.csv", layout: "day_blocks", columns: null, observations, sha256: "d".repeat(64) });

describe("applying a schedule import", () => {
  it("adds a client and a schedule with estimated hours, records history and audits counts only", async () => {
    const a = await actor();
    const p = await person();
    const c = await client();
    const day = plus(TODAY, -2);
    const { batchId } = await stage(a, [obs(p.sheet, c.name, "8:00 am - 5:00 pm AZ", day)]);
    const preview = (await apply.previewForBatch(batchId))!;
    const row = preview.plan.rows.find((r) => r.personId === p.id)!;
    expect(row).toMatchObject({ assignment: "add", schedule: "add", hoursPerWeek: 40, backdated: false });

    const result = await apply.applyBatch(a, { batchId, digest: preview.digest, accepted: [{ key: row.key }], endAssignmentIds: [], endDate: null, acknowledgeBackdated: false });
    expect(result).toMatchObject({ assignmentsAdded: 1, schedulesAdded: 1, rowsSkipped: [] });

    const [asg] = await rows<{ start_date: string; hours_per_week: string; end_date: string | null }>(sql`select start_date::text, hours_per_week::text, end_date::text from core.client_assignments where employee_id = ${p.id} and client_id = ${c.id}`);
    expect(asg).toMatchObject({ start_date: day, hours_per_week: "40.0", end_date: null });
    const [sch] = await rows<{ effective_from: string; start_time: string; zone: string; weekdays: number[]; break_minutes: number }>(sql`select effective_from::text, start_time, zone, weekdays, break_minutes from time.schedules where employee_id = ${p.id}`);
    expect(sch).toMatchObject({ effective_from: day, start_time: "08:00", zone: "America/Phoenix", weekdays: [1, 2, 3, 4, 5], break_minutes: 60 });
    expect((await rows(sql`select 1 from core.employment_history where employee_id = ${p.id} and event_type = 'client_assigned'`)).length).toBe(1);

    const audit = await rows(sql`select action, after, metadata from ops.audit_log where target_id = ${p.id} or target_id = ${batchId}`);
    const text = JSON.stringify(audit);
    expect(text).not.toContain(p.first);
    expect(text).not.toContain(c.name);
    expect(text).toContain("scheduleimport.apply");

    // an applied upload cannot be applied again
    await expect(apply.applyBatch(a, { batchId, digest: preview.digest, accepted: [{ key: row.key }], endAssignmentIds: [], endDate: null, acknowledgeBackdated: false })).rejects.toThrow(/no longer available/);
  });

  it("changes the client and the shift: the old records end the day before and the new ones start", async () => {
    const a = await actor();
    const p = await person();
    const oldClient = await client();
    const newClient = await client();
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date, hours_per_week) values (${p.id}, ${oldClient.id}, '2026-01-05', 20)`);
    await db.execute(sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone) values (${p.id}, '2026-01-05', '10:00', '14:00', '{1,2,3,4,5}', 0, 'America/Phoenix')`);
    const day = plus(TODAY, -3);
    const { batchId } = await stage(a, [obs(p.sheet, newClient.name, "9:00 am - 6:00 pm ET", day)]);
    const preview = (await apply.previewForBatch(batchId))!;
    const row = preview.plan.rows.find((r) => r.personId === p.id)!;
    expect(row).toMatchObject({ assignment: "change_client", schedule: "change" });

    const result = await apply.applyBatch(a, { batchId, digest: preview.digest, accepted: [{ key: row.key, breakMinutes: 45, hoursPerWeek: 38.5 }], endAssignmentIds: [], endDate: null, acknowledgeBackdated: false });
    expect(result).toMatchObject({ assignmentsAdded: 1, assignmentsEnded: 1, schedulesAdded: 1 });
    const old = await rows<{ end_date: string }>(sql`select end_date::text from core.client_assignments where employee_id = ${p.id} and client_id = ${oldClient.id}`);
    expect(old[0].end_date).toBe(plus(day, -1));
    const fresh = await rows<{ hours_per_week: string }>(sql`select hours_per_week::text from core.client_assignments where employee_id = ${p.id} and client_id = ${newClient.id} and end_date is null`);
    expect(fresh[0].hours_per_week).toBe("38.5");
    const sch = await rows<{ effective_from: string; effective_to: string | null; start_time: string; break_minutes: number }>(sql`select effective_from::text, effective_to::text, start_time, break_minutes from time.schedules where employee_id = ${p.id} order by effective_from`);
    expect(sch).toEqual([
      { effective_from: "2026-01-05", effective_to: plus(day, -1), start_time: "10:00", break_minutes: 0 },
      { effective_from: day, effective_to: null, start_time: "09:00", break_minutes: 45 },
    ]);
  });

  it("fills hours on an existing assignment, and skips only the row that does not fit", async () => {
    const a = await actor();
    const fills = await person();
    const clash = await person();
    const c = await client();
    const day = plus(TODAY, -2);
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${fills.id}, ${c.id}, ${plus(day, -10)})`);
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${clash.id}, ${c.id}, ${plus(day, -10)})`);
    // a schedule that begins AFTER the sheet's first day: the importer must not rewrite it
    await db.execute(sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone) values (${clash.id}, ${plus(day, 1)}, '07:00', '15:00', '{1,2,3,4,5}', 30, 'America/Phoenix')`);

    const { batchId } = await stage(a, [obs(fills.sheet, c.name, "8:00 am - 5:00 pm AZ", day), obs(clash.sheet, c.name, "8:00 am - 5:00 pm AZ", day)]);
    const preview = (await apply.previewForBatch(batchId))!;
    const keys = [fills, clash].map((x) => preview.plan.rows.find((r) => r.personId === x.id)!.key);
    const result = await apply.applyBatch(a, { batchId, digest: preview.digest, accepted: keys.map((key) => ({ key })), endAssignmentIds: [], endDate: null, acknowledgeBackdated: false });

    expect(result.rowsSkipped).toHaveLength(1);
    expect(result.rowsSkipped[0].reason).toMatch(/schedule starting on or after/);
    const [filled] = await rows<{ hours_per_week: string }>(sql`select hours_per_week::text from core.client_assignments where employee_id = ${fills.id}`);
    expect(filled.hours_per_week).toBe("40.0");
    // the skipped person was rolled back whole: nothing of theirs changed
    const [c2] = await rows<{ hours_per_week: string | null }>(sql`select hours_per_week::text from core.client_assignments where employee_id = ${clash.id}`);
    expect(c2.hours_per_week).toBeNull();
    expect((await rows(sql`select 1 from time.schedules where employee_id = ${clash.id}`)).length).toBe(1);
  });

  it("refuses a stale preview and a backdated change that was not acknowledged", async () => {
    const a = await actor();
    const p = await person();
    const c = await client();
    const old = plus(TODAY, -20);
    const { batchId } = await stage(a, [obs(p.sheet, c.name, "8:00 am - 5:00 pm AZ", old)]);
    const preview = (await apply.previewForBatch(batchId))!;
    const row = preview.plan.rows.find((r) => r.personId === p.id)!;
    expect(row.backdated).toBe(true);
    expect(row.impact).toMatchObject({ attendanceDays: 0 });

    await expect(apply.applyBatch(a, { batchId, digest: preview.digest, accepted: [{ key: row.key }], endAssignmentIds: [], endDate: null, acknowledgeBackdated: false })).rejects.toThrow(/7 days back/);
    await expect(apply.applyBatch(a, { batchId, digest: "0".repeat(64), accepted: [{ key: row.key }], endAssignmentIds: [], endDate: null, acknowledgeBackdated: true })).rejects.toThrow(/changed since/);

    // ELEVATE changes after the preview was opened: the digest no longer matches
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${p.id}, ${c.id}, ${old})`);
    await expect(apply.applyBatch(a, { batchId, digest: preview.digest, accepted: [{ key: row.key }], endAssignmentIds: [], endDate: null, acknowledgeBackdated: true })).rejects.toThrow(/changed since/);
  });

  it("ends only the assignments that were ticked, on the chosen last day", async () => {
    const a = await actor();
    const staying = await person();
    const leaving = await person();
    const untouched = await person();
    const c = await client();
    for (const x of [staying, leaving, untouched]) await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${x.id}, ${c.id}, '2026-03-02')`);
    const day = plus(TODAY, -2);
    const { batchId } = await stage(a, [obs(staying.sheet, c.name, "8:00 am - 5:00 pm AZ", day)]);
    const preview = (await apply.previewForBatch(batchId))!;
    const goneLeaving = preview.plan.notOnSheet.find((n) => n.employeeId === leaving.id)!;
    expect(preview.plan.notOnSheet.map((n) => n.employeeId)).toEqual(expect.arrayContaining([leaving.id, untouched.id]));

    const lastDay = plus(TODAY, -1);
    const result = await apply.applyBatch(a, { batchId, digest: preview.digest, accepted: [], endAssignmentIds: [goneLeaving.assignmentId], endDate: lastDay, acknowledgeBackdated: false });
    expect(result.endedByTick).toBe(1);
    const ended = await rows<{ employee_id: string; end_date: string | null }>(sql`select employee_id, end_date::text from core.client_assignments where client_id = ${c.id}`);
    expect(ended.find((r) => r.employee_id === leaving.id)?.end_date).toBe(lastDay);
    expect(ended.find((r) => r.employee_id === untouched.id)?.end_date).toBeNull();

    // a last day in the future is refused
    const b2 = await stage(a, [obs(staying.sheet, c.name, "8:00 am - 5:00 pm AZ", day)]);
    const p2 = (await apply.previewForBatch(b2.batchId))!;
    const left = p2.plan.notOnSheet[0];
    await expect(apply.applyBatch(a, { batchId: b2.batchId, digest: p2.digest, accepted: [], endAssignmentIds: [left.assignmentId], endDate: plus(TODAY, 3), acknowledgeBackdated: false })).rejects.toThrow(/future/);
  });

  it("rebuilds attendance for the people changed and reports the bound", async () => {
    const out = await apply.rebuildAfterApply([], null);
    expect(out).toEqual({ rebuilt: 0, failed: 0, limitedFrom: null });
    const p = await person();
    const far = await apply.rebuildAfterApply([p.id], plus(TODAY, -60));
    expect(far.limitedFrom).toBe(plus(TODAY, -35));
    expect(far.rebuilt + far.failed).toBe(1);
  });
});
