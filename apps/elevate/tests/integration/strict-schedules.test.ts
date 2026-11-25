import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Strict time, schedules (design 2026-11-24): a person can have one schedule per client at the same time, with the client's allotted
// hours, as long as the hours do not overlap. Assigning, ending and reading them.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { todayInZone } = await import("@/modules/org/service");
const scheduleActions = await import("@/modules/attendance/schedule-actions");
const queries = await import("@/modules/attendance/queries");
const { runAutoStop } = await import("@/modules/attendance/auto-stop");
const { loadSchedules, workingWeekdaysFor } = await import("@/modules/attendance/schedule-service");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
async function person(label: string, clients: string[] = []) {
  const user = await makeUser(label, ["employee"]);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${label}, ${uniq(label)}, ${user.email}, 'active', ${user.id}) returning id`);
  for (const c of clients) await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${e.id}, ${c}, current_date - 30)`);
  return { user, employeeId: e.id };
}
const newClient = async (name: string) => (await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq(name)}) returning id`))[0].id;

let hr: TestUser;
let clientA: string;
let clientB: string;
type Shift = { client?: string; start: string; end: string; weekdays?: number[]; allotted?: number };
const shiftOf = (o: Shift) => ({ startTime: o.start, endTime: o.end, weekdays: o.weekdays ?? [1, 2, 3, 4, 5, 6, 7], breakMinutes: 0, clientId: o.client, allottedMinutesPerDay: o.allotted });
const assign = (employeeId: string, o: Shift & { from?: string; mode?: "add" | "replace_all" }) => scheduleActions.assignSchedule({ employeeIds: [employeeId], effectiveFrom: o.from ?? todayInZone(), zone: "America/Phoenix", mode: o.mode, shifts: [shiftOf(o)] });
const plus = (d: number) => new Date(Date.parse(`${todayInZone()}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const idOf = async (employeeId: string, start: string) => (await loadSchedules(db, employeeId)).find((s) => s.startTime === start)!.id;

beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin"]);
  clientA = await newClient("Client A ");
  clientB = await newClient("Client B ");
});

describe("assigning schedules for several clients", () => {
  it("lets a person hold a schedule for each client at the same time", async () => {
    const p = await person("both", [clientA, clientB]);
    as(hr);
    expect((await assign(p.employeeId, { client: clientA, start: "09:00", end: "13:00", allotted: 240 })).ok).toBe(true);
    expect((await assign(p.employeeId, { client: clientB, start: "14:00", end: "18:00", allotted: 200 })).ok).toBe(true);
    const open = (await loadSchedules(db, p.employeeId)).filter((s) => s.effectiveTo === null);
    expect(open.map((s) => [s.clientId, s.allottedMinutesPerDay]).sort()).toEqual([[clientA, 240], [clientB, 200]].sort());
  });

  it("keeps several patterns for the SAME client: different times on different days", async () => {
    const p = await person("patterns", [clientA]);
    as(hr);
    const r = await scheduleActions.assignSchedule({
      employeeIds: [p.employeeId],
      effectiveFrom: todayInZone(),
      zone: "America/New_York",
      shifts: [
        shiftOf({ client: clientA, start: "08:00", end: "16:30", weekdays: [2, 4], allotted: 480 }),
        shiftOf({ client: clientA, start: "08:30", end: "17:00", weekdays: [1, 3], allotted: 480 }),
        shiftOf({ client: clientA, start: "13:30", end: "22:00", weekdays: [5], allotted: 480 }),
      ],
    });
    expect(r).toEqual({ ok: true, data: { assigned: 1 } });
    const all = await loadSchedules(db, p.employeeId);
    expect(all).toHaveLength(3);
    expect(all.every((s) => s.effectiveTo === null)).toBe(true);
    const view = await queries.getPersonSchedule(p.employeeId);
    expect(view.week.map((d) => d.shifts.length)).toEqual(view.week.map((d) => (d.date >= todayInZone() && d.weekday <= 5 ? 1 : 0)));
  });

  it("adding a later pattern keeps the earlier ones open", async () => {
    const p = await person("later", [clientA]);
    as(hr);
    await assign(p.employeeId, { client: clientA, start: "13:30", end: "22:00", weekdays: [1, 3] });
    expect((await assign(p.employeeId, { client: clientA, start: "08:30", end: "17:00", weekdays: [2, 4, 5], from: plus(1) })).ok).toBe(true);
    expect((await loadSchedules(db, p.employeeId)).map((s) => s.effectiveTo)).toEqual([null, null]);
  });

  it("saves nothing when one shift of the batch overlaps another", async () => {
    const p = await person("batch", [clientA]);
    as(hr);
    const r = await scheduleActions.assignSchedule({ employeeIds: [p.employeeId], effectiveFrom: todayInZone(), zone: "America/Phoenix", shifts: [shiftOf({ start: "09:00", end: "13:00" }), shiftOf({ start: "12:00", end: "16:00" })] });
    expect(r.ok === false && r.error).toMatch(/overlap/i);
    expect(await loadSchedules(db, p.employeeId)).toHaveLength(0);
  });

  it("refuses crossing hours written in different zones", async () => {
    const p = await person("zones", [clientA]);
    as(hr);
    await assign(p.employeeId, { start: "09:00", end: "13:00" });
    // 12:00 to 15:00 New York is 10:00 to 13:00 in Phoenix (standard time) or 09:00 to 12:00 (summer): it crosses either way.
    const r = await scheduleActions.assignSchedule({ employeeIds: [p.employeeId], effectiveFrom: todayInZone(), zone: "America/New_York", shifts: [shiftOf({ start: "12:00", end: "15:00" })] });
    expect(r.ok === false && r.error).toMatch(/overlap/i);
  });

  it("replaces everything when asked, dropping one that had not started", async () => {
    const p = await person("replaceall", [clientA]);
    as(hr);
    await assign(p.employeeId, { client: clientA, start: "09:00", end: "13:00", from: plus(-3) });
    await assign(p.employeeId, { start: "14:00", end: "18:00", from: plus(5) });
    expect((await assign(p.employeeId, { start: "10:00", end: "18:00", mode: "replace_all" })).ok).toBe(true);
    const all = await loadSchedules(db, p.employeeId);
    expect(all.map((s) => [s.startTime, s.effectiveFrom, s.effectiveTo])).toEqual([
      ["09:00", plus(-3), plus(-1)],
      ["10:00", todayInZone(), null],
    ]);
    expect(await rows(sql`select 1 from time.schedules where employee_id = ${p.employeeId} and removed_at is not null`)).toHaveLength(1);
  });

  it("refuses hours that overlap another schedule of the same person, naming the problem", async () => {
    const p = await person("overlap", [clientA, clientB]);
    as(hr);
    await assign(p.employeeId, { client: clientA, start: "09:00", end: "13:00" });
    const r = await assign(p.employeeId, { client: clientB, start: "12:00", end: "16:00" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/overlap/i);
  });

  it("refuses a client the person is not assigned to", async () => {
    const p = await person("unassigned", [clientA]);
    as(hr);
    const r = await assign(p.employeeId, { client: clientB, start: "09:00", end: "13:00" });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toMatch(/not assigned/i);
  });

  it("refuses allotted hours longer than a day", async () => {
    const p = await person("toomuch", [clientA]);
    as(hr);
    expect((await assign(p.employeeId, { client: clientA, start: "09:00", end: "13:00", allotted: 1000 })).ok).toBe(false);
  });

  it("is for HR only: an Employee is refused", async () => {
    const p = await person("denied", [clientA]);
    as(p.user);
    expect(await assign(p.employeeId, { client: clientA, start: "09:00", end: "13:00" })).toEqual({ ok: false, error: NO_ACCESS });
  });
});

describe("reading several schedules", () => {
  it("shows every current schedule with its client and allotted hours to the person", async () => {
    const p = await person("reads", [clientA, clientB]);
    as(hr);
    await assign(p.employeeId, { client: clientA, start: "09:00", end: "13:00", allotted: 240 });
    await assign(p.employeeId, { client: clientB, start: "14:00", end: "18:00", allotted: 200 });
    as(p.user);
    const mine = await queries.getMySchedule();
    const all = mine!.entries;
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.allottedMinutes).sort()).toEqual([200, 240]);
    expect(all.every((s) => typeof s.clientName === "string")).toBe(true);
  });

  it("counts the weekdays of every schedule when leave days are counted", async () => {
    const p = await person("weekdays", [clientA, clientB]);
    as(hr);
    await assign(p.employeeId, { client: clientA, start: "09:00", end: "13:00", weekdays: [1, 2] });
    await assign(p.employeeId, { client: clientB, start: "09:00", end: "13:00", weekdays: [6, 7] });
    const set = await workingWeekdaysFor(db, p.employeeId, todayInZone());
    expect(set).toBeDefined();
    expect(set!.size).toBe(4);
  });

  it("ends only one client's schedule when asked", async () => {
    const p = await person("ends", [clientA, clientB]);
    as(hr);
    await assign(p.employeeId, { client: clientA, start: "09:00", end: "13:00" });
    await assign(p.employeeId, { client: clientB, start: "14:00", end: "18:00" });
    expect((await scheduleActions.endSchedules({ employeeIds: [p.employeeId], endDate: todayInZone(), clientId: clientA })).ok).toBe(true);
    const all = await loadSchedules(db, p.employeeId);
    expect(all.find((s) => s.clientId === clientA)!.effectiveTo).toBe(todayInZone());
    expect(all.find((s) => s.clientId === clientB)!.effectiveTo).toBeNull();
  });
});

describe("who may open a person's schedules", () => {
  it("lets HR and Super Admin change them, the person read their own, and refuses everyone else", async () => {
    const p = await person("access", [clientA]);
    for (const role of ["super_admin", "hr_admin"] as const) {
      as(await makeUser(`see${role}`, [role]));
      expect((await queries.getPersonSchedule(p.employeeId)).canManage).toBe(true);
    }
    as(p.user);
    expect((await queries.getPersonSchedule(p.employeeId)).canManage).toBe(false);
    // A lead who is not above them, and roles with no schedule access.
    for (const role of ["team_lead", "recruiter", "executive", "employee"] as const) {
      as(await makeUser(`nosee${role}`, [role]));
      await expect(queries.getPersonSchedule(p.employeeId)).rejects.toThrow();
    }
  });
});

describe("changing one schedule", () => {
  const two = async (label: string) => {
    const p = await person(label, [clientA, clientB]);
    as(hr);
    await assign(p.employeeId, { client: clientA, start: "09:00", end: "13:00" });
    await assign(p.employeeId, { client: clientB, start: "14:00", end: "18:00" });
    return p;
  };
  const times = async (employeeId: string) => (await loadSchedules(db, employeeId)).map((s) => `${s.startTime}-${s.endTime} ${s.effectiveFrom} ${s.effectiveTo ?? "open"}`);

  it("replaces just that one from a date", async () => {
    const p = await two("replaceone");
    const scheduleId = await idOf(p.employeeId, "09:00");
    expect((await scheduleActions.replaceSchedule({ scheduleId, effectiveFrom: plus(2), ...shiftOf({ client: clientA, start: "08:00", end: "12:00" }) })).ok).toBe(true);
    expect(await times(p.employeeId)).toEqual([`09:00-13:00 ${todayInZone()} ${plus(1)}`, `14:00-18:00 ${todayInZone()} open`, `08:00-12:00 ${plus(2)} open`]);
  });

  it("corrects just that one in place, with the reason audited, and refuses crossing hours", async () => {
    const p = await two("correctone");
    const scheduleId = await idOf(p.employeeId, "09:00");
    const crossing = await scheduleActions.updateSchedule({ scheduleId, reason: "Wrong end time", ...shiftOf({ client: clientA, start: "09:00", end: "15:00" }) });
    expect(crossing.ok === false && crossing.error).toMatch(/overlap/i);
    expect((await scheduleActions.updateSchedule({ scheduleId, reason: "Wrong end time", ...shiftOf({ client: clientA, start: "09:00", end: "13:30" }) })).ok).toBe(true);
    expect(await times(p.employeeId)).toEqual([`09:00-13:30 ${todayInZone()} open`, `14:00-18:00 ${todayInZone()} open`]);
    const [audit] = await rows<{ metadata: { reason: string } }>(sql`select metadata from ops.audit_log where action = 'schedule.correct' and target_id = ${p.employeeId}`);
    expect(audit.metadata.reason).toBe("Wrong end time");
  });

  it("removes one that has not started without touching the others, and it can be added again", async () => {
    const p = await two("removeone");
    await assign(p.employeeId, { start: "19:00", end: "21:00", from: plus(3) });
    const scheduleId = await idOf(p.employeeId, "19:00");
    expect(await scheduleActions.removeSchedule({ scheduleId, lastDay: todayInZone() })).toEqual({ ok: true, data: { outcome: "removed" } });
    expect(await times(p.employeeId)).toHaveLength(2);
    expect((await assign(p.employeeId, { start: "19:00", end: "21:00", from: plus(3) })).ok).toBe(true);
    expect((await scheduleActions.updateSchedule({ scheduleId, reason: "Too late now", ...shiftOf({ start: "19:00", end: "20:00" }) })).ok).toBe(false);
  });

  it("ends everything, and upcoming ones only when asked", async () => {
    const p = await two("endall");
    await assign(p.employeeId, { start: "19:00", end: "21:00", from: plus(3) });
    const refused = await scheduleActions.endSchedules({ employeeIds: [p.employeeId], endDate: todayInZone() });
    expect(refused.ok === false && refused.error).toMatch(/upcoming/);
    expect(await scheduleActions.endSchedules({ employeeIds: [p.employeeId], endDate: todayInZone(), includeUpcoming: true })).toEqual({ ok: true, data: { ended: 1, skipped: 0 } });
    expect(await times(p.employeeId)).toEqual([`09:00-13:00 ${todayInZone()} ${todayInZone()}`, `14:00-18:00 ${todayInZone()} ${todayInZone()}`]);
  });

  it("is for HR only", async () => {
    const p = await two("onlyhr");
    const scheduleId = await idOf(p.employeeId, "09:00");
    as(p.user);
    expect(await scheduleActions.removeSchedule({ scheduleId, lastDay: todayInZone() })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await scheduleActions.replaceSchedule({ scheduleId, effectiveFrom: plus(1), ...shiftOf({ start: "08:00", end: "12:00" }) })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await scheduleActions.updateSchedule({ scheduleId, reason: "Wrong end time", ...shiftOf({ start: "08:00", end: "12:00" }) })).toEqual({ ok: false, error: NO_ACCESS });
  });
});

describe("changing the schedule of someone who is working", () => {
  it("stops their clock no earlier than the change, never back at the clock-in", async () => {
    const p = await person("working", []);
    as(hr);
    await assign(p.employeeId, { start: "00:00", end: "23:59", from: plus(-3) });
    const clockedIn = Date.now() - 2 * 3_600_000;
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_in', ${new Date(clockedIn).toISOString()})`);
    const scheduleId = await idOf(p.employeeId, "00:00");
    const before = Date.now();
    expect((await scheduleActions.removeSchedule({ scheduleId, lastDay: plus(-1) })).ok).toBe(true);
    expect(await runAutoStop(p.employeeId)).toEqual({ status: "stopped" });
    const [out] = await rows<{ ms: string }>(sql`select extract(epoch from occurred_at) * 1000 as ms from time.clock_events where employee_id = ${p.employeeId} and type = 'clock_out'`);
    expect(Number(out.ms)).toBeGreaterThanOrEqual(before - 1000);
  });
});
