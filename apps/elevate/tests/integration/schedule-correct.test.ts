import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Correcting a recent schedule in place (HR): both of a person's new entries take the corrected shift, neighbours that now read the
// same are joined into one, an old schedule is refused, the reason and before/after are audited, and nothing else is touched.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/attendance/schedule-actions");
const { todayInZone } = await import("@/modules/org/service");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const uniq = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const plus = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const TODAY = todayInZone();

async function user(role: "hr_admin" | "employee") {
  const id = randomUUID();
  const email = `${uniq("c")}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  return { id, email, roles: [role] };
}
async function person() {
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, start_date) values (${uniq("Corra")}, ${uniq("Fixperson")}, ${`${uniq("e")}@example.com`}, 'active', '2025-01-01') returning id`);
  return e.id;
}
const addSchedule = (id: string, from: string, to: string | null, start: string, end: string) =>
  db.execute(sql`insert into time.schedules (employee_id, effective_from, effective_to, start_time, end_time, weekdays, break_minutes, zone) values (${id}, ${from}, ${to}, ${start}, ${end}, '{1,2,3,4,5}', 0, 'America/Phoenix')`);
const input = (employeeId: string, extra: Record<string, unknown> = {}) => ({ employeeId, startTime: "08:00", endTime: "17:00", weekdays: [1, 2, 3, 4, 5], breakMinutes: 60, reason: "Two clients, one shift", ...extra });

describe("correcting a recent schedule", () => {
  it("rewrites both new entries and joins them into one shift, with the reason audited", async () => {
    const hr = await user("hr_admin");
    current.user = hr;
    const id = await person();
    await addSchedule(id, plus(TODAY, 0), plus(TODAY, 0), "08:00", "12:00");
    await addSchedule(id, plus(TODAY, 1), null, "13:00", "17:00");
    const result = await actions.correctSchedule(input(id));
    expect(result).toMatchObject({ ok: true, data: { corrected: 1, joined: 1 } });
    const list = await rows(sql`select effective_from::text, effective_to::text, start_time, end_time, break_minutes from time.schedules where employee_id = ${id}`);
    expect(list).toEqual([{ effective_from: plus(TODAY, 0), effective_to: null, start_time: "08:00", end_time: "17:00", break_minutes: 60 }]);
    const [audit] = await rows<{ metadata: { reason: string } }>(sql`select metadata from ops.audit_log where action = 'schedule.correct' and target_id = ${id}`);
    expect(audit.metadata.reason).toBe("Two clients, one shift");
  });

  it("refuses a schedule older than 7 days, a missing reason, and everyone but HR", async () => {
    const hr = await user("hr_admin");
    current.user = hr;
    const id = await person();
    await addSchedule(id, plus(TODAY, -60), null, "09:00", "17:00");
    const old = await actions.correctSchedule(input(id));
    expect(old.ok).toBe(false);
    const noReason = await actions.correctSchedule(input(id, { reason: "x" }));
    expect(noReason.ok).toBe(false);
    const stillOld = await rows(sql`select start_time from time.schedules where employee_id = ${id}`);
    expect(stillOld).toEqual([{ start_time: "09:00" }]);
    current.user = await user("employee");
    expect((await actions.correctSchedule(input(id))).ok).toBe(false);
  });
});
