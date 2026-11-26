import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Hours review stays current: a clock event rebuilds the day at once, a day being worked reads as "working" (not something to fix), the
// refresh button catches up days that fell behind, and a removed automatic clock-out no longer leaves its flag.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { performClock } = await import("@/modules/attendance/service");
const actions = await import("@/modules/attendance/hours-actions");
const queries = await import("@/modules/attendance/hours-queries");
const jobs = await import("@/modules/attendance/jobs");
const { todayInZone } = await import("@/modules/org/service");
const { mondayOf } = await import("@/modules/attendance/pay-periods");
const { stalePeople } = await import("@/modules/attendance/hours-refresh");

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
async function person(label: string) {
  const user = await makeUser(label, ["employee"]);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${label}, ${uniq("Live")}, ${user.email}, 'active', ${user.id}) returning id`);
  return { user, employeeId: e.id };
}
const dayOf = async (employeeId: string) => (await rows<{ date: string; flags: string[]; last_out: string | null; worked_minutes: number }>(sql`select date::text as date, flags, last_out, worked_minutes from time.attendance_days where employee_id = ${employeeId} and sessions > 0 order by date desc limit 1`))[0];
/** An event written straight to the table, as if no rebuild followed it. */
const rawEvent = async (employeeId: string, type: string, minutesAgo: number, source = "web") =>
  (await rows<{ id: string }>(sql`insert into time.clock_events (employee_id, type, occurred_at, source) values (${employeeId}, ${type}, ${new Date(Date.now() - minutesAgo * 60_000).toISOString()}, ${source}) returning id`))[0].id;

let hr: TestUser;
const week = () => mondayOf(todayInZone());
const reviewDay = async (employeeId: string) => (await queries.getTeamReview(week())).rows.find((r) => r.employeeId === employeeId)?.days.at(-1);

beforeAll(async () => {
  hr = await makeUser("liveHr", ["hr_admin"]);
});

describe("hours review follows the clock", () => {
  it("rebuilds the day on clock-in and clock-out, without waiting for the nightly run", async () => {
    const p = await person("clocks");
    await performClock(p.user, "clock_in", {});
    expect((await dayOf(p.employeeId)).flags).toContain("open_session");

    as(hr);
    const open = await reviewDay(p.employeeId);
    expect(open).toMatchObject({ working: true, lastOut: null });
    expect(open!.flags).not.toContain("open_session");

    await performClock(p.user, "clock_out", {});
    const done = await dayOf(p.employeeId);
    expect(done.flags).not.toContain("open_session");
    expect(done.last_out).not.toBeNull();
    as(hr);
    expect((await reviewDay(p.employeeId))!.working).toBeUndefined();
  });

  it("shows the time so far for someone still working", async () => {
    const p = await person("sofar");
    await rawEvent(p.employeeId, "clock_in", 120);
    await jobs.rebuildAttendanceDays(new Date(), 2, p.employeeId);
    as(hr);
    const d = await reviewDay(p.employeeId);
    // The clock-in may fall on yesterday just after midnight; either way the open day counts up to now.
    expect(d!.working).toBe(true);
    expect(d!.workedMinutes).toBeGreaterThanOrEqual(119);
  });

  it("never overwrites a day built from newer events", async () => {
    const p = await person("newer");
    await rawEvent(p.employeeId, "clock_in", 60);
    await jobs.rebuildAttendanceDays(new Date(), 2, p.employeeId);
    await db.execute(sql`update time.attendance_days set built_at = now() + interval '1 hour', worked_minutes = 999 where employee_id = ${p.employeeId}`);
    await jobs.rebuildAttendanceDays(new Date(), 2, p.employeeId);
    expect((await dayOf(p.employeeId)).worked_minutes).toBe(999);
  });
});

describe("refresh this week", () => {
  it("catches up only the people whose events are newer than their days, and audits a count", async () => {
    const p = await person("stale");
    await rawEvent(p.employeeId, "clock_in", 60);
    await jobs.rebuildAttendanceDays(new Date(), 2, p.employeeId);
    await rawEvent(p.employeeId, "clock_out", 1);
    expect((await dayOf(p.employeeId)).flags).toContain("open_session"); // behind

    as(hr);
    const first = await actions.refreshHoursWeek({ weekStart: week() });
    expect(first.ok && first.data.refreshed).toBeGreaterThanOrEqual(1);
    expect((await dayOf(p.employeeId)).flags).not.toContain("open_session");
    // Once up to date they are not picked again, and neither is someone whose only events are from the day before the week.
    const before = await person("sunday");
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values
      (${before.employeeId}, 'clock_in', ${`${week()}T00:00:00Z`}::timestamptz - interval '5 hours'),
      (${before.employeeId}, 'clock_out', ${`${week()}T00:00:00Z`}::timestamptz - interval '2 hours')`);
    await jobs.rebuildAttendanceDays(new Date(), 14, before.employeeId);
    const stale = await stalePeople(week(), [p.employeeId, before.employeeId]);
    expect(stale).toEqual([]);
    expect((await queries.getTeamReview(week())).refreshedAt).toBeGreaterThan(Date.now() - 60_000);
    const [audit] = await rows<{ metadata: { people: number } }>(sql`select metadata from ops.audit_log where action = 'hours.refresh' order by occurred_at desc limit 1`);
    expect(audit.metadata.people).toBeGreaterThanOrEqual(1);
  });

  it("refuses an old week and anyone without hours approval", async () => {
    as(hr);
    expect((await actions.refreshHoursWeek({ weekStart: "2026-01-05" })).ok).toBe(false);
    for (const role of ["recruiter", "executive", "employee"] as RoleSlug[]) {
      as(await makeUser("liveNo", [role]));
      expect(await actions.refreshHoursWeek({ weekStart: week() })).toEqual({ ok: false, error: NO_ACCESS });
    }
  });
});

describe("a removed automatic clock-out", () => {
  it("no longer leaves the auto-stopped flag", async () => {
    const p = await person("autostop");
    await rawEvent(p.employeeId, "clock_in", 90);
    const stop = await rawEvent(p.employeeId, "clock_out", 30, "auto_stop");
    await jobs.rebuildAttendanceDays(new Date(), 2, p.employeeId);
    expect((await dayOf(p.employeeId)).flags).toContain("auto_stopped");
    await db.execute(sql`insert into time.clock_event_voids (event_id, reason, voided_by) values (${stop}, 'Removed by HR', ${hr.id})`);
    await jobs.rebuildAttendanceDays(new Date(), 2, p.employeeId);
    expect((await dayOf(p.employeeId)).flags).not.toContain("auto_stopped");
  });
});
