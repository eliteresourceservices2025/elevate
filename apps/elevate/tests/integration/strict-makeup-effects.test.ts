import { randomUUID } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Strict time, make-up hours worked (design 2026-11-24): time inside an approved window is straight time, never extra hours; it is
// credited to the missed day; and the clock lets the person work it.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { formatInZone } = await import("@/lib/time");
const jobs = await import("@/modules/attendance/jobs");
const { runAutoStop } = await import("@/modules/attendance/auto-stop");
const actions = await import("@/modules/attendance/actions");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const PHX = "America/Phoenix";
const MIN = 60_000;
const DAY = 86_400_000;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const day = (offset: number) => formatInZone(Date.now() + offset * DAY, PHX, "yyyy-MM-dd");
const at = (date: string, time: string) => fromZonedTime(`${date}T${time}:00`, PHX).toISOString();
const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * MIN).toISOString();
async function person(label: string, o: { schedule?: boolean; cap?: number } = {}) {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee')`);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, daily_cap_minutes) values (${label}, ${uniq(label)}, ${email}, 'active', ${id}, ${o.cap ?? null}) returning id`);
  if (o.schedule) {
    await db.execute(sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone) values (${e.id}, current_date - 60, '09:00', '17:00', array[1,2,3,4,5,6,7]::smallint[], 0, ${PHX})`);
  }
  return { user: { id, email, roles: ["employee"] as RoleSlug[] } satisfies TestUser, employeeId: e.id };
}
const event = (employeeId: string, type: string, when: string) => db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${employeeId}, ${type}, ${when})`);
const makeup = (employeeId: string, o: { absence: string; start: string; end: string; status?: string; missed?: number }) =>
  db.execute(sql`insert into time.makeup_requests (employee_id, absence_date, missed_minutes, window_start, window_end, minutes, reason, status, decided_by, decided_at)
    values (${employeeId}, ${o.absence}::date, ${o.missed ?? 480}, ${o.start}, ${o.end}, ${Math.round((Date.parse(o.end) - Date.parse(o.start)) / MIN)}, 'Was unwell', ${o.status ?? "approved"}, ${randomUUID()}, now())`);
const dayRow = async (employeeId: string, date: string) => (await rows<{ worked_minutes: number; extra_minutes: number; makeup_minutes: number; flags: string[] }>(sql`select worked_minutes, extra_minutes, makeup_minutes, flags from time.attendance_days where employee_id = ${employeeId} and date = ${date}::date`))[0];

let worked: string;
let missed: string;

beforeAll(() => {
  worked = day(-3);
  missed = day(-4);
});

/** A full scheduled shift 9 to 5 and then two more hours from 6 to 8 in the evening. */
async function shiftPlusEvening(employeeId: string) {
  await event(employeeId, "clock_in", at(worked, "09:00"));
  await event(employeeId, "clock_out", at(worked, "17:00"));
  await event(employeeId, "clock_in", at(worked, "18:00"));
  await event(employeeId, "clock_out", at(worked, "20:00"));
}

describe("worked inside an approved make-up window", () => {
  it("is straight time: not extra hours, not flagged as unapproved, and counted as make-up", async () => {
    const p = await person("fx1", { schedule: true });
    await shiftPlusEvening(p.employeeId);
    await makeup(p.employeeId, { absence: missed, start: at(worked, "18:00"), end: at(worked, "20:00") });
    await jobs.rebuildAttendanceDays(new Date(), 5, p.employeeId);
    const d = await dayRow(p.employeeId, worked);
    expect(d.worked_minutes).toBe(600);
    expect(d.extra_minutes).toBe(0);
    expect(d.makeup_minutes).toBe(120);
    expect(d.flags).toContain("makeup_hours");
    expect(d.flags).not.toContain("extra_hours");
    expect(d.flags).not.toContain("unapproved_extra");
  });

  it("is extra hours without a make-up request (the control)", async () => {
    const p = await person("fx2", { schedule: true });
    await shiftPlusEvening(p.employeeId);
    await jobs.rebuildAttendanceDays(new Date(), 5, p.employeeId);
    const d = await dayRow(p.employeeId, worked);
    expect(d.extra_minutes).toBe(120);
    expect(d.makeup_minutes).toBe(0);
    expect(d.flags).toContain("unapproved_extra");
  });

  it("counts only the part inside the window; the rest stays extra", async () => {
    const p = await person("fx3", { schedule: true });
    await shiftPlusEvening(p.employeeId);
    await makeup(p.employeeId, { absence: missed, start: at(worked, "18:00"), end: at(worked, "19:00") });
    await jobs.rebuildAttendanceDays(new Date(), 5, p.employeeId);
    const d = await dayRow(p.employeeId, worked);
    expect(d.makeup_minutes).toBe(60);
    expect(d.extra_minutes).toBe(60);
  });

  it("ignores a window that was only asked for or declined", async () => {
    const p = await person("fx4", { schedule: true });
    await shiftPlusEvening(p.employeeId);
    await makeup(p.employeeId, { absence: missed, start: at(worked, "18:00"), end: at(worked, "19:00"), status: "pending" });
    await makeup(p.employeeId, { absence: missed, start: at(worked, "19:00"), end: at(worked, "20:00"), status: "declined" });
    await jobs.rebuildAttendanceDays(new Date(), 5, p.employeeId);
    expect((await dayRow(p.employeeId, worked)).makeup_minutes).toBe(0);
  });

  it("is not rest-day work when the day is a make-up day", async () => {
    const p = await person("fx5", { schedule: false });
    // A person with no schedule has no extra hours either way; the credit still shows.
    await event(p.employeeId, "clock_in", at(worked, "18:00"));
    await event(p.employeeId, "clock_out", at(worked, "20:00"));
    await makeup(p.employeeId, { absence: missed, start: at(worked, "18:00"), end: at(worked, "20:00") });
    await jobs.rebuildAttendanceDays(new Date(), 5, p.employeeId);
    expect((await dayRow(p.employeeId, worked)).makeup_minutes).toBe(120);
  });

  it("is credited to the request, kept to the minutes that were missed", async () => {
    const p = await person("fx6", { schedule: true });
    await shiftPlusEvening(p.employeeId);
    await makeup(p.employeeId, { absence: missed, start: at(worked, "18:00"), end: at(worked, "20:00"), missed: 90 });
    await jobs.rebuildAttendanceDays(new Date(), 5, p.employeeId);
    const [r] = await rows<{ made_up_minutes: number }>(sql`select made_up_minutes from time.makeup_requests where employee_id = ${p.employeeId}`);
    expect(r.made_up_minutes).toBe(90);
  });
});

describe("the clock and an approved make-up window", () => {
  it("does not stop a person whose own hours are used up while the window is open", async () => {
    const p = await person("fx7", { cap: 240 });
    await event(p.employeeId, "clock_in", iso(-300));
    await makeup(p.employeeId, { absence: missed, start: iso(-30), end: iso(60) });
    const r = await runAutoStop(p.employeeId);
    expect(r.status).toBe("early");
    expect(Math.abs((r.status === "early" ? r.limitMs : 0) - (Date.now() + 60 * MIN))).toBeLessThan(2 * MIN);
  });

  it("lets a person with no hours left clock in inside the window", async () => {
    const p = await person("fx8", { cap: 1 });
    const midnight = fromZonedTime(`${day(0)}T00:00:00`, PHX).getTime();
    await event(p.employeeId, "clock_in", new Date(midnight).toISOString());
    await event(p.employeeId, "clock_out", new Date(midnight + 2 * MIN).toISOString());
    current.user = p.user;
    expect((await actions.clockIn({})).ok).toBe(false);
    await makeup(p.employeeId, { absence: missed, start: iso(-5), end: iso(120) });
    expect((await actions.clockIn({})).ok).toBe(true);
  });
});
