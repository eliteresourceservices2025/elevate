import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Contractors with no fixed schedule whose hours change from day to day (owner request 2026-11-25): HR sets hours for a specific date on top of
// the usual hours per day. The clock, the stop and make-up hours use that day's number.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { formatInZone } = await import("@/lib/time");
const scheduleActions = await import("@/modules/attendance/schedule-actions");
const { runAutoStop } = await import("@/modules/attendance/auto-stop");
const attendanceQueries = await import("@/modules/attendance/queries");
const makeupQueries = await import("@/modules/attendance/makeup-queries");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const PHX = "America/Phoenix";
const MIN = 60_000;
const DAY = 86_400_000;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const today = () => formatInZone(Date.now(), PHX, "yyyy-MM-dd");
const day = (offset: number) => formatInZone(Date.now() + offset * DAY, PHX, "yyyy-MM-dd");
async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
async function person(label: string, cap: number | null = null) {
  const user = await makeUser(label, ["employee"]);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, daily_cap_minutes) values (${label}, ${uniq("Aac")}, ${user.email}, 'active', ${user.id}, ${cap}) returning id`);
  return { user, employeeId: e.id };
}
const overrideOf = async (id: string, date: string) => (await rows<{ minutes: number }>(sql`select minutes from time.daily_hours where employee_id = ${id} and date = ${date}::date`))[0]?.minutes ?? null;

let hr: TestUser;
beforeAll(async () => {
  hr = await makeUser("dhHr", ["hr_admin"]);
});

describe("setDayHours", () => {
  it("sets the hours of specific days for everyone picked, replaces them, and clears them", async () => {
    const a = await person("dhA");
    const b = await person("dhB");
    current.user = hr;
    const d1 = day(1);
    const d2 = day(2);
    expect(await scheduleActions.setDayHours({ employeeIds: [a.employeeId, b.employeeId], days: [{ date: d1, minutes: 240 }, { date: d2, minutes: 360 }] })).toEqual({ ok: true, data: { changed: 4, replaced: 0, skipped: [] } });
    expect([await overrideOf(a.employeeId, d1), await overrideOf(b.employeeId, d2)]).toEqual([240, 360]);
    expect((await scheduleActions.setDayHours({ employeeIds: [a.employeeId], days: [{ date: d1, minutes: 300 }] })).ok).toBe(true);
    expect(await overrideOf(a.employeeId, d1)).toBe(300);
    expect((await scheduleActions.setDayHours({ employeeIds: [a.employeeId], days: [{ date: d1, minutes: null }] })).ok).toBe(true);
    expect(await overrideOf(a.employeeId, d1)).toBeNull();
    const audit = await rows(sql`select metadata from ops.audit_log where action = 'schedule.day_hours' and target_id = ${a.employeeId}`);
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(audit)).not.toContain("360");
  });

  it("refuses bad hours, bad or faraway dates, nobody picked, repeated dates and anyone who is not HR", async () => {
    const a = await person("dhC");
    current.user = hr;
    const ok = { employeeIds: [a.employeeId] };
    for (const minutes of [-1, 961, 2.5]) expect((await scheduleActions.setDayHours({ ...ok, days: [{ date: day(1), minutes }] })).ok).toBe(false);
    expect((await scheduleActions.setDayHours({ ...ok, days: [{ date: "2026-13-40", minutes: 240 }] })).ok).toBe(false);
    expect((await scheduleActions.setDayHours({ ...ok, days: [{ date: day(-60), minutes: 240 }] })).ok).toBe(false);
    expect((await scheduleActions.setDayHours({ ...ok, days: [{ date: day(400), minutes: 240 }] })).ok).toBe(false);
    expect((await scheduleActions.setDayHours({ employeeIds: [], days: [{ date: day(1), minutes: 240 }] })).ok).toBe(false);
    expect((await scheduleActions.setDayHours({ ...ok, days: [] })).ok).toBe(false);
    expect((await scheduleActions.setDayHours({ ...ok, days: [{ date: day(1), minutes: 240 }, { date: day(1), minutes: 120 }] })).ok).toBe(false);
    expect((await scheduleActions.setDayHours({ employeeIds: [randomUUID()], days: [{ date: day(1), minutes: 240 }] })).ok).toBe(false);
    current.user = a.user;
    expect(await scheduleActions.setDayHours({ ...ok, days: [{ date: day(1), minutes: 240 }] })).toEqual({ ok: false, error: "You do not have access to do that." });
  });
});

describe("the clock follows that day's hours", () => {
  const clockedInFor = async (employeeId: string, minutesAgo: number) => db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${employeeId}, 'clock_in', ${new Date(Date.now() - minutesAgo * MIN).toISOString()})`);

  it("stops a person after the hours set for today, instead of their usual hours", async () => {
    const p = await person("dhStop", 480);
    current.user = hr;
    await scheduleActions.setDayHours({ employeeIds: [p.employeeId], days: [{ date: today(), minutes: 60 }] });
    await clockedInFor(p.employeeId, 90); // 90 minutes worked, 60 allowed today (480 usual)
    expect((await runAutoStop(p.employeeId)).status).toBe("stopped");
  });

  it("leaves them running when today has more hours than they have worked, and uses the usual hours on other days", async () => {
    const p = await person("dhRun", 60);
    current.user = hr;
    await scheduleActions.setDayHours({ employeeIds: [p.employeeId], days: [{ date: today(), minutes: 480 }, { date: day(1), minutes: 30 }] });
    await clockedInFor(p.employeeId, 90); // usual 60 would have stopped them; today's 480 does not; tomorrow's 30 is not today
    expect((await runAutoStop(p.employeeId)).status).toBe("early");
  });

  it("ignores the hours of another day", async () => {
    const p = await person("dhOther", 60);
    current.user = hr;
    await scheduleActions.setDayHours({ employeeIds: [p.employeeId], days: [{ date: day(1), minutes: 600 }] });
    await clockedInFor(p.employeeId, 90);
    expect((await runAutoStop(p.employeeId)).status).toBe("stopped");
  });
});

describe("listings and make-up hours use it too", () => {
  it("shows upcoming days with their own hours in the schedules list", async () => {
    const p = await person("dhList");
    current.user = hr;
    await scheduleActions.setDayHours({ employeeIds: [p.employeeId], days: [{ date: day(2), minutes: 270 }] });
    const row = (await attendanceQueries.listSchedules()).rows.find((r) => r.employeeId === p.employeeId)!;
    expect(row.dayHours).toEqual([{ date: day(2), minutes: 270 }]);
  });

  it("counts a past weekday as owing that day's hours", async () => {
    const p = await person("dhMakeup", 480);
    let date = day(-2);
    while (Number(formatInZone(Date.parse(`${date}T12:00:00Z`), "UTC", "i")) > 5) date = formatInZone(Date.parse(`${date}T12:00:00Z`) - DAY, "UTC", "yyyy-MM-dd");
    current.user = hr;
    await scheduleActions.setDayHours({ employeeIds: [p.employeeId], days: [{ date, minutes: 240 }] });
    current.user = p.user;
    expect((await makeupQueries.getMyMakeup())!.days.find((d) => d.date === date)).toMatchObject({ missedMinutes: 240 });
  });
});
