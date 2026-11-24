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
const assign = (employeeId: string, o: { client?: string; start: string; end: string; weekdays?: number[]; allotted?: number; from?: string }) =>
  scheduleActions.assignSchedule({
    employeeIds: [employeeId],
    effectiveFrom: o.from ?? todayInZone(),
    startTime: o.start,
    endTime: o.end,
    weekdays: o.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
    breakMinutes: 0,
    zone: "America/Phoenix",
    clientId: o.client,
    allottedMinutesPerDay: o.allotted,
  });

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

  it("closes only the earlier schedule of the same client when that client's schedule is set again", async () => {
    const p = await person("again", [clientA, clientB]);
    as(hr);
    await assign(p.employeeId, { client: clientA, start: "09:00", end: "13:00", from: todayInZone() });
    await assign(p.employeeId, { client: clientB, start: "14:00", end: "18:00", from: todayInZone() });
    const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    expect((await assign(p.employeeId, { client: clientA, start: "08:00", end: "12:00", from: nextWeek })).ok).toBe(true);
    const all = await loadSchedules(db, p.employeeId);
    const openFor = (c: string) => all.filter((s) => s.clientId === c && s.effectiveTo === null);
    expect(openFor(clientA)).toHaveLength(1);
    expect(openFor(clientA)[0].startTime).toBe("08:00");
    expect(openFor(clientB)).toHaveLength(1);
    expect(all.filter((s) => s.clientId === clientA && s.effectiveTo !== null)).toHaveLength(1);
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
    const all = [mine!.current, ...mine!.others].filter((s) => s !== null);
    expect(all).toHaveLength(2);
    expect(all.map((s) => s!.allottedMinutes).sort()).toEqual([200, 240]);
    expect(all.every((s) => typeof s!.clientName === "string")).toBe(true);
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
