import { randomUUID } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for hours by client: choosing the client when clocking in, switching client while working, the day split
// by client, how review and approval treat the split, and the export.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { formatInZone } = await import("@/lib/time");
const clockActions = await import("@/modules/attendance/actions");
const hoursActions = await import("@/modules/attendance/hours-actions");
const queries = await import("@/modules/attendance/hours-queries");
const jobs = await import("@/modules/attendance/jobs");
const { buildHoursExport } = await import("@/modules/attendance/hours-export");
const { mondayOf } = await import("@/modules/attendance/pay-periods");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const PHX = "America/Phoenix";
const DAY = 86_400_000;
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
async function person(label: string, opts: { managerId?: string; roles?: RoleSlug[] } = {}) {
  const user = await makeUser(label, opts.roles ?? ["employee"]);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id)
    values (${label}, ${uniq(label)}, ${user.email}, 'active', ${user.id}, ${opts.managerId ?? null}) returning id`);
  return { user, employeeId: e.id };
}
async function client(name = uniq("Client ")) {
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name, time_zone) values (${name}, 'America/New_York') returning id`);
  return { id: c.id, name };
}
const assign = (employeeId: string, clientId: string) => db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${employeeId}, ${clientId}, current_date - 30)`);
const eventTypes = async (employeeId: string) => (await rows<{ type: string; client_id: string | null }>(sql`select type, client_id from time.clock_events where employee_id = ${employeeId} order by occurred_at, created_at`));

/** A day in the last week with two clients: 9:00 to 13:00 for one, 13:00 to 17:00 for the other (Phoenix), written directly with chosen times. */
async function twoClientDay(worker: { employeeId: string }, a: string, b: string) {
  const day = formatInZone(Date.now() - 3 * DAY, PHX, "yyyy-MM-dd");
  const at = (time: string) => fromZonedTime(`${day}T${time}:00`, PHX).toISOString();
  await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, client_id) values (${worker.employeeId}, 'clock_in', ${at("09:00")}, ${a})`);
  await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, client_id) values (${worker.employeeId}, 'switch_client', ${at("13:00")}, ${b})`);
  await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${worker.employeeId}, 'clock_out', ${at("17:00")})`);
  await jobs.rebuildAttendanceDays(new Date(), 10, worker.employeeId);
  return { day, weekStart: mondayOf(day) };
}

describe("clocking in for a client", () => {
  it("fills in the client for a person with one, needs a choice with two, refuses a client they are not assigned to, and allows none for a person with no clients", async () => {
    const c1 = await client();
    const c2 = await client();
    const other = await client();

    const one = await person("OneClient");
    await assign(one.employeeId, c1.id);
    as(one.user);
    expect((await clockActions.clockIn({})).ok).toBe(true);
    expect((await eventTypes(one.employeeId))[0]).toEqual({ type: "clock_in", client_id: c1.id });

    const two = await person("TwoClients");
    await assign(two.employeeId, c1.id);
    await assign(two.employeeId, c2.id);
    as(two.user);
    expect(await clockActions.clockIn({})).toEqual({ ok: false, error: "Choose the client you are working for." });
    expect(await clockActions.clockIn({ clientId: other.id })).toEqual({ ok: false, error: "You are not assigned to that client." });
    expect((await clockActions.clockIn({ clientId: c2.id })).ok).toBe(true);
    expect((await eventTypes(two.employeeId))[0]).toEqual({ type: "clock_in", client_id: c2.id });

    const none = await person("NoClient");
    as(none.user);
    expect((await clockActions.clockIn({})).ok).toBe(true);
    expect((await eventTypes(none.employeeId))[0]).toEqual({ type: "clock_in", client_id: null });
  });
});

describe("switching client while working", () => {
  it("moves the rest of the session to another client without clocking out, and refuses the same client, an unassigned one, a break, or not working", async () => {
    const c1 = await client();
    const c2 = await client();
    const other = await client();
    const p = await person("Switcher");
    await assign(p.employeeId, c1.id);
    await assign(p.employeeId, c2.id);
    as(p.user);

    expect(await clockActions.switchClient({ clientId: c2.id })).toEqual({ ok: false, error: "Clock in before switching client." });
    expect((await clockActions.clockIn({ clientId: c1.id })).ok).toBe(true);
    expect(await clockActions.switchClient({ clientId: c1.id })).toEqual({ ok: false, error: "You are already working for that client." });
    expect(await clockActions.switchClient({ clientId: other.id })).toEqual({ ok: false, error: "You are not assigned to that client." });
    expect(await clockActions.switchClient({})).toEqual({ ok: false, error: "Choose the client you are switching to." });

    expect(await clockActions.switchClient({ clientId: c2.id })).toMatchObject({ ok: true, data: { state: "working" } });
    expect(await clockActions.switchClient({ clientId: c2.id })).toEqual({ ok: false, error: "You are already working for that client." });
    expect((await clockActions.startBreak({})).ok).toBe(true);
    expect(await clockActions.switchClient({ clientId: c1.id })).toEqual({ ok: false, error: "End your break before switching client." });
    expect((await clockActions.endBreak()).ok).toBe(true);
    expect((await clockActions.clockOut()).ok).toBe(true);

    expect((await eventTypes(p.employeeId)).map((e) => e.type)).toEqual(["clock_in", "switch_client", "break_start", "break_end", "clock_out"]);
    // Nothing was queued for Jibble for the switch
    expect(await rows(sql`select 1 from time.jibble_link_log l join time.clock_events e on e.id = l.event_id where e.employee_id = ${p.employeeId} and e.type = 'switch_client'`)).toHaveLength(0);
  });
});

describe("the day split by client", () => {
  it("is rebuilt with the day, adds up to the day's hours, and hours review shows a row for each client", async () => {
    const a = await client("Acme Dental");
    const b = await client("Beta Clinic");
    const lead = await person("SplitLead", { roles: ["team_lead", "employee"] });
    const worker = await person("SplitWorker", { managerId: lead.employeeId });
    const { day, weekStart } = await twoClientDay(worker, a.id, b.id);

    const split = await rows<{ client_id: string; worked_minutes: number }>(sql`select client_id, worked_minutes from time.attendance_day_clients where employee_id = ${worker.employeeId} and date = ${day}::date order by worked_minutes desc, client_id`);
    expect(split).toHaveLength(2);
    expect(split.reduce((n, r) => n + r.worked_minutes, 0)).toBe(480);
    expect(split.map((r) => r.worked_minutes)).toEqual([240, 240]);
    const [total] = await rows<{ worked_minutes: number }>(sql`select worked_minutes from time.attendance_days where employee_id = ${worker.employeeId} and date = ${day}::date`);
    expect(total.worked_minutes).toBe(480);

    as(lead.user);
    const review = await queries.getTeamReview(weekStart);
    const reviewDay = review.rows.find((r) => r.employeeId === worker.employeeId)?.days.find((d) => d.date === day);
    expect(reviewDay?.clients.map((c) => c.name).sort()).toEqual(["Acme Dental", "Beta Clinic"]);
    expect(reviewDay?.clients.reduce((n, c) => n + c.workedMinutes, 0)).toBe(480);

    // Rebuilding again replaces the rows rather than adding to them
    await jobs.rebuildAttendanceDays(new Date(), 10, worker.employeeId);
    expect(await rows(sql`select 1 from time.attendance_day_clients where employee_id = ${worker.employeeId} and date = ${day}::date`)).toHaveLength(2);
  });

  it("keeps the approval's split, shows a day as changed when the split changes, and does not compare approvals from before clients", async () => {
    const a = await client();
    const b = await client();
    const lead = await person("ApprLead", { roles: ["team_lead", "employee"] });
    const worker = await person("ApprWorker", { managerId: lead.employeeId });
    const { day, weekStart } = await twoClientDay(worker, a.id, b.id);
    const stateOf = async (employeeId: string) => (await queries.getTeamReview(weekStart)).rows.find((r) => r.employeeId === employeeId)?.days.find((d) => d.date === day)?.state;

    as(lead.user);
    expect((await hoursActions.approveHoursWeek({ employeeId: worker.employeeId, weekStart })).ok).toBe(true);
    expect(await stateOf(worker.employeeId)).toBe("approved");
    const [saved] = await rows<{ client_split: { clientId: string; workedMinutes: number }[] | null }>(sql`select client_split from time.hours_approvals where employee_id = ${worker.employeeId} and date = ${day}::date`);
    expect(saved.client_split).toHaveLength(2);

    // The same total, but 30 minutes moved from one client to the other: it changed after approval
    await db.execute(sql`update time.attendance_day_clients set worked_minutes = worked_minutes - 30 where employee_id = ${worker.employeeId} and date = ${day}::date and client_id = ${a.id}`);
    await db.execute(sql`update time.attendance_day_clients set worked_minutes = worked_minutes + 30 where employee_id = ${worker.employeeId} and date = ${day}::date and client_id = ${b.id}`);
    expect(await stateOf(worker.employeeId)).toBe("changed");

    // An approval written before hours were split by client has no split: it stays approved while the total is the same
    const old = await person("ApprOld", { managerId: lead.employeeId });
    await twoClientDay(old, a.id, b.id);
    await db.execute(sql`insert into time.hours_approvals (employee_id, date, scheduled_minutes, worked_minutes, break_minutes, extra_minutes, approved_extra_minutes, client_split, approved_by) values (${old.employeeId}, ${day}::date, null, 480, 0, 0, 0, null, ${lead.user.id})`);
    expect(await stateOf(old.employeeId)).toBe("approved");
  });
});

describe("the export", () => {
  it("lists each client's hours on a day worked for more than one, and only the clients assigned in the period", async () => {
    const a = await client("Export Alpha");
    const b = await client("Export Beta");
    const ended = await client("Export Ended");
    const worker = await person("ExportWorker");
    await assign(worker.employeeId, a.id);
    await assign(worker.employeeId, b.id);
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date, end_date) values (${worker.employeeId}, ${ended.id}, '2020-01-01', '2020-06-30')`);
    const { day } = await twoClientDay(worker, a.id, b.id);

    const out = await buildHoursExport({ periodStart: addDaysIso(day, -2), periodEnd: addDaysIso(day, 2), kind: "daily", includeUnapproved: true });
    const lines = out.csv.split(/\r?\n/);
    expect(lines[0]).toContain("Hours by client");
    const mine = lines.find((l) => l.includes(worker.user.email));
    expect(mine).toBeDefined();
    expect(mine).toContain("Export Alpha 4");
    expect(mine).toContain("Export Beta 4");
    expect(mine).not.toContain("Export Ended"); // an assignment that ended years ago is not in this period
  });
});

function addDaysIso(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
