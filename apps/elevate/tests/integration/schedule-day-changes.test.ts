import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { fromZonedTime } from "date-fns-tz";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// One-day changes ("client A wants the full day, client B says do not work") and hours per day including a day off.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { todayInZone } = await import("@/modules/org/service");
const actions = await import("@/modules/attendance/schedule-actions");
const queries = await import("@/modules/attendance/queries");
const jobs = await import("@/modules/attendance/jobs");
const { computeStopLimit } = await import("@/modules/attendance/auto-stop-limit");
const { replayClock } = await import("@/modules/attendance/clock");
const { loadEffectiveSchedules, loadSchedules } = await import("@/modules/attendance/schedule-service");
const { shiftOn } = await import("@/modules/attendance/schedule");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
const PHX = "America/Phoenix";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const plus = (d: number) => new Date(Date.parse(`${todayInZone()}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const at = (date: string, time: string) => fromZonedTime(`${date}T${time}:00`, PHX).getTime();
const limitFor = (employeeId: string, nowMs: number, clientId: string | null) => computeStopLimit(db, employeeId, nowMs, { replay: replayClock([]), clientId });

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
async function person(label: string, clients: string[] = []) {
  const user = await makeUser(label, ["employee"]);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${label}, ${uniq("Aad")}, ${user.email}, 'active', ${user.id}) returning id`);
  for (const c of clients) await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${e.id}, ${c}, current_date - 30)`);
  return { user, employeeId: e.id };
}

let hr: TestUser;
let clientA: string;
let clientB: string;
const newClient = async (name: string) => (await rows<{ id: string }>(sql`insert into core.clients (name, time_zone) values (${uniq(name)}, ${PHX}) returning id`))[0].id;

beforeAll(async () => {
  hr = await makeUser("dcHr", ["hr_admin"]);
  clientA = await newClient("Day A ");
  clientB = await newClient("Day B ");
});

/** Two clients at 4 hours each, every day, from three days ago. */
async function dual(label: string) {
  const p = await person(label, [clientA, clientB]);
  as(hr);
  const every = [1, 2, 3, 4, 5, 6, 7];
  const r = await actions.assignSchedule({
    employeeIds: [p.employeeId],
    effectiveFrom: plus(-3),
    zone: PHX,
    shifts: [
      { startTime: "09:00", endTime: "13:00", weekdays: every, breakMinutes: 0, clientId: clientA, allottedMinutesPerDay: 240 },
      { startTime: "13:00", endTime: "17:00", weekdays: every, breakMinutes: 0, clientId: clientB, allottedMinutesPerDay: 240 },
    ],
  });
  expect(r.ok).toBe(true);
  return p;
}
const fullA = (employeeId: string, date: string) => ({
  employeeId,
  date,
  reason: "Client A asked for the full day",
  clients: [
    { clientId: clientA, shifts: [{ startTime: "09:00", endTime: "17:00", breakMinutes: 0, allottedMinutesPerDay: 480 }] },
    { clientId: clientB, shifts: [] },
  ],
});

describe("changing one day", () => {
  it("gives one client the whole day and turns the other off, for that day only", async () => {
    const p = await dual("full");
    as(hr);
    expect(await actions.setDayChange(fullA(p.employeeId, plus(1)))).toEqual({ ok: true, data: undefined });

    const effective = await loadEffectiveSchedules(db, p.employeeId);
    expect(shiftOn(effective, PHX, plus(1))!.scheduledMinutes).toBe(480);
    expect(shiftOn(effective, PHX, plus(2))!.scheduledMinutes).toBe(480);
    expect(shiftOn(effective, PHX, plus(2))!.endMs).toBe(at(plus(2), "17:00"));
    expect(await loadSchedules(db, p.employeeId)).toHaveLength(2); // the usual schedules are untouched

    // The clock: A may work to 17:00; B is refused all day; the next day B works again.
    expect((await limitFor(p.employeeId, at(plus(1), "10:00"), clientA))!.limitMs).toBe(at(plus(1), "17:00"));
    expect((await limitFor(p.employeeId, at(plus(1), "14:00"), clientB))!.overrunMs).toBe(Infinity);
    expect((await limitFor(p.employeeId, at(plus(2), "14:00"), clientB))!.limitMs).toBe(at(plus(2), "17:00"));

    const view = await queries.getPersonSchedule(p.employeeId, plus(1));
    expect(view.changedDays).toEqual([expect.objectContaining({ date: plus(1), canUndo: true })]);
    const day = view.week.find((d) => d.date === plus(1))!;
    expect(day.shifts).toEqual([expect.objectContaining({ changed: true, clientRange: "9:00 AM - 5:00 PM" })]);
    expect(day.off).toHaveLength(1);

    const [audit] = await rows<{ metadata: { reason: string } }>(sql`select metadata from ops.audit_log where action = 'schedule.day_change' and target_id = ${p.employeeId}`);
    expect(audit.metadata.reason).toBe("Client A asked for the full day");
    const notes = await rows<{ body: string }>(sql`select body from ops.notifications where user_id = ${p.user.id} and title = 'Your schedule changed for one day'`);
    expect(notes).toHaveLength(1);
    expect(notes[0].body).not.toContain("Client A asked");
  });

  it("replaces an earlier change of the day, and can be undone", async () => {
    const p = await dual("undo");
    as(hr);
    await actions.setDayChange(fullA(p.employeeId, plus(1)));
    expect((await actions.setDayChange({ ...fullA(p.employeeId, plus(1)), clients: [{ clientId: clientB, shifts: [] }] })).ok).toBe(true);
    expect(shiftOn(await loadEffectiveSchedules(db, p.employeeId), PHX, plus(1))!.scheduledMinutes).toBe(240); // only A's usual four hours
    expect(await actions.removeDayChange({ employeeId: p.employeeId, date: plus(1) })).toEqual({ ok: true, data: undefined });
    expect(shiftOn(await loadEffectiveSchedules(db, p.employeeId), PHX, plus(1))!.scheduledMinutes).toBe(480);
    expect((await actions.removeDayChange({ employeeId: p.employeeId, date: plus(1) })).ok).toBe(false);
    expect(await rows(sql`select 1 from time.schedule_day_changes where employee_id = ${p.employeeId}`)).toHaveLength(3); // kept, marked removed
  });

  it("flags no absence on a past day that was turned off", async () => {
    const p = await dual("absent");
    as(hr);
    await jobs.rebuildAttendanceDays(new Date(), 3, p.employeeId);
    const flags = async () => (await rows<{ flags: string[] }>(sql`select flags from time.attendance_days where employee_id = ${p.employeeId} and date = ${plus(-2)}::date`))[0]?.flags ?? [];
    expect(await flags()).toContain("absent");
    expect((await actions.setDayChange({ employeeId: p.employeeId, date: plus(-2), reason: "Both clients closed", clients: [{ clientId: clientA, shifts: [] }, { clientId: clientB, shifts: [] }] })).ok).toBe(true);
    expect(await flags()).not.toContain("absent");
  });

  it("refuses crossing hours, a person with no schedule, a client with nothing to turn off, faraway days and anyone but HR", async () => {
    const p = await dual("refuse");
    as(hr);
    const crossing = await actions.setDayChange({ ...fullA(p.employeeId, plus(1)), clients: [{ clientId: clientA, shifts: [{ startTime: "09:00", endTime: "17:00", breakMinutes: 0 }] }] });
    expect(crossing.ok === false && crossing.error).toMatch(/overlap/i);
    expect(await rows(sql`select 1 from time.schedule_day_changes where employee_id = ${p.employeeId}`)).toHaveLength(0);

    const none = await person("noschedule");
    as(hr);
    const refused = await actions.setDayChange({ employeeId: none.employeeId, date: plus(1), reason: "Client asked", clients: [{ shifts: [] }] });
    expect(refused.ok === false && refused.error).toMatch(/no fixed schedule/);
    expect((await actions.setDayChange({ employeeId: p.employeeId, date: plus(1), reason: "Client asked", clients: [{ shifts: [] }] })).ok).toBe(false);
    expect((await actions.setDayChange(fullA(p.employeeId, plus(-8)))).ok).toBe(false);
    expect((await actions.setDayChange(fullA(p.employeeId, plus(121)))).ok).toBe(false);
    for (const role of ["team_lead", "recruiter", "executive", "employee"] as RoleSlug[]) {
      as(await makeUser("dcNo", [role]));
      expect(await actions.setDayChange(fullA(p.employeeId, plus(1)))).toEqual({ ok: false, error: NO_ACCESS });
      expect(await actions.removeDayChange({ employeeId: p.employeeId, date: plus(1) })).toEqual({ ok: false, error: NO_ACCESS });
    }
  });
});

describe("hours per day", () => {
  it("blocks the clock on a day off and shows it, with the usual hours saved in the same step", async () => {
    const p = await person("off");
    as(hr);
    expect(await actions.setDayHours({ employeeIds: [p.employeeId], days: [{ date: todayInZone(), minutes: 0 }], usualMinutes: 360 })).toEqual({ ok: true, data: { changed: 1, replaced: 0, skipped: [] } });
    expect((await limitFor(p.employeeId, Date.now(), null))!.overrunMs).toBe(Infinity);
    const view = await queries.getPersonSchedule(p.employeeId);
    expect(view.hours!.usualMinutes).toBe(360);
    expect(view.hours!.days.find((d) => d.date === todayInZone())!.minutes).toBe(0);
  });

  it("previews without writing, and skips people who have a fixed schedule by name", async () => {
    const fixed = await dual("fixed");
    const free = await person("free");
    as(hr);
    const input = { employeeIds: [fixed.employeeId, free.employeeId], days: [{ date: plus(1), minutes: 120 }] };
    const preview = await actions.setDayHours({ ...input, preview: true });
    expect(preview).toMatchObject({ ok: true, data: { changed: 1, replaced: 0, skipped: [expect.stringContaining("fixed")] } });
    expect(await rows(sql`select 1 from time.daily_hours where employee_id in (${fixed.employeeId}, ${free.employeeId})`)).toHaveLength(0);
    expect(await actions.setDayHours(input)).toMatchObject({ ok: true, data: { changed: 1 } });
    expect(await rows(sql`select 1 from time.daily_hours where employee_id = ${fixed.employeeId}`)).toHaveLength(0);
    expect(await actions.setDayHours({ ...input, days: [{ date: plus(1), minutes: 240 }] })).toMatchObject({ ok: true, data: { changed: 1, replaced: 1 } });
  });
});
