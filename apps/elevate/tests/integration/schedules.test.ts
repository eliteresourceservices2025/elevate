import { randomUUID } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for schedules (Phase 2.5, part A): assigning them, the nightly flags against a shift (late, left early,
// extra hours, rest-day and holiday work, absent), the missed clock-out at shift end, and leave days that follow the schedule.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { formatInZone } = await import("@/lib/time");
const scheduleActions = await import("@/modules/attendance/schedule-actions");
const { workingWeekdaysFor } = await import("@/modules/attendance/schedule-service");
const { isoWeekday } = await import("@/modules/attendance/schedule");
const attendanceActions = await import("@/modules/attendance/actions");
const queries = await import("@/modules/attendance/queries");
const jobs = await import("@/modules/attendance/jobs");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
const PHX = "America/Phoenix";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const day = (offset: number) => formatInZone(Date.now() + offset * DAY, PHX, "yyyy-MM-dd");
const at = (date: string, time: string) => fromZonedTime(`${date}T${time}:00`, PHX).toISOString();

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
async function person(label: string, opts: { managerId?: string; teamId?: string } = {}) {
  const user = await makeUser(label, ["employee"]);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, team_id)
    values (${label}, ${uniq(label)}, ${user.email}, 'active', ${user.id}, ${opts.managerId ?? null}, ${opts.teamId ?? null}) returning id`);
  return { user, employeeId: e.id };
}
/** A schedule written directly (the action refuses start dates far in the past). */
const schedule = (employeeId: string, o: { start?: string; end?: string; weekdays?: number[]; breakMinutes?: number; zone?: string; from?: string } = {}) =>
  db.execute(sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone)
    values (${employeeId}, ${o.from ?? day(-10)}::date, ${o.start ?? "09:00"}, ${o.end ?? "17:00"}, ${sql.raw(`array[${(o.weekdays ?? [1, 2, 3, 4, 5, 6, 7]).join(",")}]::smallint[]`)}, ${o.breakMinutes ?? 60}, ${o.zone ?? PHX})`);
const event = (employeeId: string, type: string, when: string) => db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${employeeId}, ${type}, ${when})`);
const dayRow = async (employeeId: string, date: string) => (await rows<{ flags: string[]; scheduled_minutes: number | null; late_minutes: number; early_leave_minutes: number; extra_minutes: number; sessions: number; worked_minutes: number }>(sql`select flags, scheduled_minutes, late_minutes, early_leave_minutes, extra_minutes, sessions, worked_minutes from time.attendance_days where employee_id = ${employeeId} and date = ${date}::date`))[0];
const notes = (userId: string, kind: string) => rows(sql`select 1 from ops.notifications where user_id = ${userId} and kind = ${kind}`);

let hr: TestUser;
beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin", "employee"]);
});

describe("assigning schedules", () => {
  const base = { effectiveFrom: day(0), startTime: "09:00", endTime: "17:00", weekdays: [1, 2, 3, 4, 5], breakMinutes: 60 };

  it("gives several people the same shift in each person's client zone, tells them, and audits it", async () => {
    const [client] = await rows<{ id: string }>(sql`insert into core.clients (name, time_zone) values (${uniq("Client ")}, 'America/New_York') returning id`);
    const ana = await person("SchAna");
    const ben = await person("SchBen");
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${ana.employeeId}, ${client.id}, current_date - 30)`);
    as(hr);
    expect(await scheduleActions.assignSchedule({ ...base, employeeIds: [ana.employeeId, ben.employeeId] })).toEqual({ ok: true, data: { assigned: 2 } });
    const zoneOf = async (id: string) => (await rows<{ zone: string; weekdays: number[]; break_minutes: number }>(sql`select zone, weekdays, break_minutes from time.schedules where employee_id = ${id}`))[0];
    expect(await zoneOf(ana.employeeId)).toMatchObject({ zone: "America/New_York", weekdays: [1, 2, 3, 4, 5], break_minutes: 60 });
    expect((await zoneOf(ben.employeeId)).zone).toBe("America/Phoenix"); // no client: the company zone
    expect(await notes(ana.user.id, "schedule.assigned")).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'schedule.assign' and target_id = ${ana.employeeId}`)).toHaveLength(1);
    const body = (await rows<{ body: string }>(sql`select body from ops.notifications where user_id = ${ana.user.id} and kind = 'schedule.assigned'`))[0].body;
    expect(body).toContain("Mon to Fri");
    expect(body).toContain("9:00 PM - 5:00 AM"); // Manila
  });

  it("closes the person's old schedule the day before a new one starts, and refuses a start that overlaps one", async () => {
    const p = await person("SchChange");
    as(hr);
    expect((await scheduleActions.assignSchedule({ ...base, effectiveFrom: day(-3), employeeIds: [p.employeeId], zone: PHX })).ok).toBe(true);
    expect((await scheduleActions.assignSchedule({ ...base, effectiveFrom: day(2), startTime: "10:00", endTime: "18:00", employeeIds: [p.employeeId], zone: PHX })).ok).toBe(true);
    const list = await rows<{ effective_from: string; effective_to: string | null; start_time: string }>(sql`select effective_from::text, effective_to::text, start_time from time.schedules where employee_id = ${p.employeeId} order by effective_from`);
    expect(list).toEqual([
      { effective_from: day(-3), effective_to: day(1), start_time: "09:00" },
      { effective_from: day(2), effective_to: null, start_time: "10:00" },
    ]);
    // A start on or before the latest one would rewrite history
    const clash = await scheduleActions.assignSchedule({ ...base, effectiveFrom: day(2), employeeIds: [p.employeeId] });
    expect(clash.ok).toBe(false);
    expect(!clash.ok && clash.error).toContain("already has a schedule starting");
    // The database itself refuses two schedules that cover the same day
    await expect(schedule(p.employeeId, { from: day(5) })).rejects.toThrow();
  });

  it("is all or nothing, and checks dates, times and days", async () => {
    const a = await person("SchAllA");
    as(hr);
    expect((await scheduleActions.assignSchedule({ ...base, employeeIds: [a.employeeId, randomUUID()] })).ok).toBe(false);
    expect(await rows(sql`select 1 from time.schedules where employee_id = ${a.employeeId}`)).toHaveLength(0);
    expect(await scheduleActions.assignSchedule({ ...base, effectiveFrom: day(-8), employeeIds: [a.employeeId] })).toEqual({ ok: false, error: "A schedule cannot start more than 7 days ago." });
    for (const bad of [{ startTime: "9am" }, { endTime: "25:00" }, { weekdays: [] }, { weekdays: [8] }, { breakMinutes: 500 }, { zone: "Mars/Base" }, { employeeIds: [] }, { effectiveFrom: "tomorrow" }]) {
      expect((await scheduleActions.assignSchedule({ ...base, employeeIds: [a.employeeId], ...bad })).ok).toBe(false);
    }
  });

  it("ends a schedule, and only HR and Super Admin can do either", async () => {
    const p = await person("SchEnd");
    as(hr);
    await scheduleActions.assignSchedule({ ...base, effectiveFrom: day(-2), employeeIds: [p.employeeId], zone: PHX });
    expect(await scheduleActions.endSchedule({ employeeId: p.employeeId, endDate: day(0) })).toEqual({ ok: true, data: undefined });
    expect((await rows<{ effective_to: string }>(sql`select effective_to::text from time.schedules where employee_id = ${p.employeeId}`))[0].effective_to).toBe(day(0));
    expect(await scheduleActions.endSchedule({ employeeId: p.employeeId, endDate: day(0) })).toEqual({ ok: true, data: undefined }); // still open? no: ended today, ending again today is allowed
    expect((await scheduleActions.endSchedule({ employeeId: randomUUID(), endDate: day(0) })).ok).toBe(false);

    for (const role of ["team_lead", "recruiter", "executive", "employee"] as RoleSlug[]) {
      as(await makeUser("nosch", [role]));
      expect(await scheduleActions.assignSchedule({ ...base, employeeIds: [p.employeeId] })).toEqual({ ok: false, error: NO_ACCESS });
      expect(await scheduleActions.endSchedule({ employeeId: p.employeeId, endDate: day(0) })).toEqual({ ok: false, error: NO_ACCESS });
      await expect(queries.listSchedules()).rejects.toThrow();
    }
  });

  it("lists everyone with their schedule or none, and shows a person their own", async () => {
    const has = await person("SchHas");
    const none = await person("SchNone");
    await schedule(has.employeeId, { zone: "America/New_York" });
    as(hr);
    const list = await queries.listSchedules();
    const mine = list.rows.find((r) => r.employeeId === has.employeeId)!;
    expect(mine.current).toMatchObject({ days: "Every day", manila: expect.stringContaining("PM") });
    expect(list.rows.find((r) => r.employeeId === none.employeeId)!.current).toBeNull();
    expect(list.withoutSchedule).toBeGreaterThanOrEqual(1);

    as(has.user);
    const week = await queries.getMyTime();
    expect(week?.schedule).toMatchObject({ days: "Every day", zone: "America/New_York" });
    expect(week?.days.every((d) => d.shift !== null && d.scheduledMinutes === 420)).toBe(true);
    as(none.user);
    expect((await queries.getMyTime())?.schedule).toBeNull();
  });
});

describe("nightly flags against a schedule", () => {
  const Y = day(-1);

  it("flags a late arrival past the grace, and not one inside it", async () => {
    const late = await person("FlagLate");
    const fine = await person("FlagFine");
    for (const p of [late, fine]) await schedule(p.employeeId);
    await event(late.employeeId, "clock_in", at(Y, "09:20"));
    await event(late.employeeId, "clock_out", at(Y, "17:20"));
    await event(fine.employeeId, "clock_in", at(Y, "09:08"));
    await event(fine.employeeId, "clock_out", at(Y, "17:00"));
    await jobs.rebuildAttendanceDays();
    expect(await dayRow(late.employeeId, Y)).toMatchObject({ scheduled_minutes: 420, late_minutes: 20 });
    expect((await dayRow(late.employeeId, Y)).flags).toContain("late");
    expect((await dayRow(fine.employeeId, Y)).flags).not.toContain("late");
    expect((await dayRow(fine.employeeId, Y)).late_minutes).toBe(0);
  });

  it("flags leaving early, and counts hours beyond the schedule as extra (a shifted day is not)", async () => {
    const early = await person("FlagEarly");
    const extra = await person("FlagExtra");
    const shifted = await person("FlagShifted");
    for (const p of [early, extra, shifted]) await schedule(p.employeeId);
    await event(early.employeeId, "clock_in", at(Y, "09:00"));
    await event(early.employeeId, "clock_out", at(Y, "15:00"));
    await event(extra.employeeId, "clock_in", at(Y, "09:00"));
    await event(extra.employeeId, "clock_out", at(Y, "19:00")); // 10 hours worked against 7 scheduled
    await event(shifted.employeeId, "clock_in", at(Y, "10:00")); // an hour late and an hour past: 8 hours, 1 hour over the 7
    await event(shifted.employeeId, "clock_out", at(Y, "18:00"));
    await jobs.rebuildAttendanceDays();
    const e = await dayRow(early.employeeId, Y);
    expect(e).toMatchObject({ early_leave_minutes: 120, extra_minutes: 0 });
    expect(e.flags).toContain("left_early");
    const x = await dayRow(extra.employeeId, Y);
    expect(x).toMatchObject({ extra_minutes: 180, worked_minutes: 600 });
    expect(x.flags).toContain("extra_hours");
    const s = await dayRow(shifted.employeeId, Y);
    expect(s.late_minutes).toBe(60);
    expect(s.extra_minutes).toBe(60); // worked 8h, scheduled 7h
  });

  it("counts work on a rest day or a holiday in full", async () => {
    const rest = await person("FlagRest");
    const hol = await person("FlagHol");
    const wd = isoWeekday(Y);
    await schedule(rest.employeeId, { weekdays: [1, 2, 3, 4, 5, 6, 7].filter((n) => n !== wd) });
    await schedule(hol.employeeId);
    await event(rest.employeeId, "clock_in", at(Y, "10:00"));
    await event(rest.employeeId, "clock_out", at(Y, "14:00"));
    await event(hol.employeeId, "clock_in", at(Y, "09:00"));
    await event(hol.employeeId, "clock_out", at(Y, "13:00"));
    // First with no holiday: the rest day person worked on a day off
    await jobs.rebuildAttendanceDays();
    const r = await dayRow(rest.employeeId, Y);
    expect(r).toMatchObject({ extra_minutes: 240, scheduled_minutes: null });
    expect(r.flags).toEqual(expect.arrayContaining(["rest_day_work", "extra_hours"]));
    expect((await dayRow(hol.employeeId, Y)).flags).not.toContain("holiday_work");

    // Then the same day becomes a public holiday: working it counts in full, and being late no longer applies
    const name = uniq("Test holiday ");
    await db.execute(sql`insert into time.holidays (calendar, date, name, kind) values ('PH', ${Y}::date, ${name}, 'other')`);
    try {
      await jobs.rebuildAttendanceDays();
    } finally {
      await db.execute(sql`delete from time.holidays where name = ${name}`);
    }
    const h = await dayRow(hol.employeeId, Y);
    expect(h.extra_minutes).toBe(240);
    expect(h.flags).toEqual(expect.arrayContaining(["holiday_work", "extra_hours"]));
    expect(h.flags).not.toContain("late");
  });

  it("flags nothing against a schedule for people who have none", async () => {
    const p = await person("FlagNoSched");
    await event(p.employeeId, "clock_in", at(Y, "02:00"));
    await event(p.employeeId, "clock_out", at(Y, "14:00"));
    await jobs.rebuildAttendanceDays();
    const r = await dayRow(p.employeeId, Y);
    expect(r).toMatchObject({ scheduled_minutes: null, late_minutes: 0, extra_minutes: 0 });
    expect(r.flags.filter((f) => ["late", "left_early", "extra_hours", "rest_day_work", "absent"].includes(f))).toEqual([]);
  });

  it("flags a scheduled day with no clocking as absent, but not on leave, a holiday, a rest day or today, and takes it off when things change", async () => {
    const gone = await person("AbsentGone");
    const onLeave = await person("AbsentLeave");
    const restDay = await person("AbsentRest");
    const wd = isoWeekday(Y);
    await schedule(gone.employeeId);
    await schedule(onLeave.employeeId);
    await schedule(restDay.employeeId, { weekdays: [1, 2, 3, 4, 5, 6, 7].filter((n) => n !== wd) });
    const [type] = await rows<{ id: string }>(sql`select id from time.leave_types where slug = 'unpaid_day'`);
    await db.execute(sql`insert into time.leave_requests (employee_id, leave_type_id, start_date, end_date, half_day, days, status, filed_by, step_started_on)
      values (${onLeave.employeeId}, ${type.id}, ${Y}::date, ${Y}::date, false, 1, 'approved', ${onLeave.user.id}, current_date)`);

    await jobs.rebuildAttendanceDays();
    expect(await dayRow(gone.employeeId, Y)).toMatchObject({ flags: ["absent"], sessions: 0, scheduled_minutes: 420 });
    expect(await dayRow(gone.employeeId, day(0))).toBeUndefined(); // today is not over
    expect(await dayRow(onLeave.employeeId, Y)).toBeUndefined();
    expect(await dayRow(restDay.employeeId, Y)).toBeUndefined();

    // A correction later shows they did work: the next rebuild takes the flag off
    await event(gone.employeeId, "clock_in", at(Y, "09:00"));
    await event(gone.employeeId, "clock_out", at(Y, "17:00"));
    await jobs.rebuildAttendanceDays();
    expect((await dayRow(gone.employeeId, Y)).flags).not.toContain("absent");
    expect((await dayRow(gone.employeeId, Y)).sessions).toBe(1);

    // The lead sees it in the flags list
    const lead = await person("AbsentLead");
    await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${lead.user.id}, 'team_lead')`);
    const boss = await person("AbsentBoss");
    await schedule(boss.employeeId);
    await db.execute(sql`update core.employees set manager_id = ${lead.employeeId} where id = ${boss.employeeId}`);
    await jobs.rebuildAttendanceDays();
    as({ ...lead.user, roles: ["team_lead", "employee"] });
    const flagged = (await queries.listFlags()).rows.find((r) => r.employeeId === boss.employeeId && r.flags.includes("absent"));
    expect(flagged).toBeDefined();
  });
});

describe("a session left open past the shift", () => {
  const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

  it("tells the person and their lead once the shift is over by more than the grace, and not before", async () => {
    const lead = await person("OpenLead");
    await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${lead.user.id}, 'team_lead')`);
    const late = await person("OpenLate", { managerId: lead.employeeId });
    const inside = await person("OpenInside", { managerId: lead.employeeId });
    const grace = await person("OpenGrace", { managerId: lead.employeeId });
    const free = await person("OpenNoSchedule", { managerId: lead.employeeId });
    const now = Date.now();
    // Everyone works in UTC here so the shift times can be written from the clock directly
    for (const p of [late, inside, grace, free]) await db.execute(sql`insert into time.clock_prefs (employee_id, time_zone) values (${p.employeeId}, 'UTC')`);
    await schedule(late.employeeId, { start: hhmm(now - 5 * HOUR), end: hhmm(now - 3 * HOUR), zone: "UTC", breakMinutes: 0 }); // ended 3 hours ago
    await schedule(inside.employeeId, { start: hhmm(now - 3 * HOUR), end: hhmm(now + 2 * HOUR), zone: "UTC", breakMinutes: 0 }); // still on shift
    await schedule(grace.employeeId, { start: hhmm(now - 4 * HOUR), end: hhmm(now - 30 * MIN), zone: "UTC", breakMinutes: 0 }); // ended 30 minutes ago: inside the 60 minute grace
    await event(late.employeeId, "clock_in", new Date(now - 5 * HOUR).toISOString());
    await event(inside.employeeId, "clock_in", new Date(now - 3 * HOUR).toISOString());
    await event(grace.employeeId, "clock_in", new Date(now - 4 * HOUR).toISOString());
    await event(free.employeeId, "clock_in", new Date(now - 5 * HOUR).toISOString()); // no schedule and under 12 hours: nothing

    const run = await jobs.runMissedClockouts(new Date(now));
    expect(run.noticed).toBeGreaterThanOrEqual(1);
    expect(await notes(late.user.id, "attendance.missed_clockout")).toHaveLength(1);
    expect((await rows<{ body: string }>(sql`select body from ops.notifications where user_id = ${late.user.id} and kind = 'attendance.missed_clockout'`))[0].body).toContain("Your shift ended at");
    expect(await notes(lead.user.id, "attendance.missed_clockout_lead")).toHaveLength(1);
    for (const p of [inside, grace, free]) expect(await notes(p.user.id, "attendance.missed_clockout")).toHaveLength(0);

    // Once per session, and later the 12 hour backstop does not tell them again
    expect((await jobs.runMissedClockouts(new Date(now + 20 * HOUR))).noticed).toBeGreaterThanOrEqual(0);
    expect(await notes(late.user.id, "attendance.missed_clockout")).toHaveLength(1);
    expect(await notes(free.user.id, "attendance.missed_clockout")).toHaveLength(1); // the backstop still catches people with no schedule
  });
});

describe("leave days follow the schedule", () => {
  it("gives the weekdays a person works in their own zone, or nothing when they have no schedule", async () => {
    const p = await person("LeaveDays");
    const none = await person("LeaveNone");
    await schedule(p.employeeId, { weekdays: [2, 3, 4, 5, 6], zone: PHX }); // Tuesday to Saturday
    expect(await workingWeekdaysFor(db, none.employeeId, day(0))).toBeUndefined();
    const set = await workingWeekdaysFor(db, p.employeeId, day(0));
    expect([...set!].sort()).toEqual([2, 3, 4, 5, 6]); // JavaScript days: Tue..Sat
    expect(await workingWeekdaysFor(db, p.employeeId, day(-30))).toBeUndefined(); // before the schedule started
  });

  it("counts a request's days from the person's working days", async () => {
    const { requestDays } = await import("@/modules/timeoff/workdays");
    const sunToThu = new Set([0, 1, 2, 3, 4]);
    // 2026-10-09 is a Friday and 2026-10-10 a Saturday: both are rest days for a Sun-Thu person, but Friday counts by default
    expect(requestDays("2026-10-09", "2026-10-10", false, new Set(), sunToThu)).toBe(0);
    expect(requestDays("2026-10-09", "2026-10-10", false, new Set())).toBe(1);
    expect(requestDays("2026-10-09", "2026-10-12", false, new Set(), sunToThu)).toBe(2); // Sunday and Monday
    expect(requestDays("2026-10-11", "2026-10-11", true, new Set(), sunToThu)).toBe(0.5); // a half day on a working Sunday
  });
});

describe("the team rule for late grace", () => {
  it("saves and reads the late and early-leave grace for a team", async () => {
    const [d] = await rows<{ id: string }>(sql`insert into core.departments (name) values (${uniq("Dept ")}) returning id`);
    const [t] = await rows<{ id: string }>(sql`insert into core.teams (department_id, name) values (${d.id}, ${uniq("Team ")}) returning id`);
    as(hr);
    expect((await attendanceActions.saveClockRules({ teamId: t.id, allowedCidrs: [], selfieRequired: false, idleMinutes: 30, graceMinutes: 60, lateGraceMinutes: 20 })).ok).toBe(true);
    expect((await attendanceActions.saveClockRules({ teamId: t.id, allowedCidrs: [], selfieRequired: false, idleMinutes: 30, graceMinutes: 60, lateGraceMinutes: 500 })).ok).toBe(false);
    const rules = (await queries.listClockRules()).rows.find((r) => r.teamId === t.id);
    expect(rules?.lateGraceMinutes).toBe(20);

    // A team with a 20 minute grace does not flag someone 15 minutes late
    const p = await person("GraceTeam", { teamId: t.id });
    await schedule(p.employeeId);
    const Y = day(-1);
    await event(p.employeeId, "clock_in", at(Y, "09:15"));
    await event(p.employeeId, "clock_out", at(Y, "17:15"));
    await jobs.rebuildAttendanceDays();
    expect((await dayRow(p.employeeId, Y)).flags).not.toContain("late");
  });
});
