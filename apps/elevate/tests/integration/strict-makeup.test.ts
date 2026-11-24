import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Strict time, make-up hours (design 2026-11-24): asked for before they are worked, tied to a missed day, decided by someone else.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { formatInZone } = await import("@/lib/time");
const actions = await import("@/modules/attendance/makeup-actions");
const queries = await import("@/modules/attendance/makeup-queries");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
const PHX = "America/Phoenix";
const MIN = 60_000;
const DAY = 86_400_000;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const yesterday = () => formatInZone(Date.now() - DAY, PHX, "yyyy-MM-dd");
const iso = (offsetMin: number) => new Date(Date.now() + offsetMin * MIN).toISOString();
async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
async function person(label: string, o: { managerId?: string; schedule?: boolean; roles?: RoleSlug[] } = {}) {
  const user = await makeUser(label, o.roles ?? ["employee"]);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id) values (${label}, ${uniq(label)}, ${user.email}, 'active', ${user.id}, ${o.managerId ?? null}) returning id`);
  if (o.schedule !== false) {
    await db.execute(sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone) values (${e.id}, current_date - 60, '09:00', '17:00', array[1,2,3,4,5,6,7]::smallint[], 0, ${PHX})`);
  }
  return { user, employeeId: e.id };
}
const request = (o: { absence?: string; from: number; to: number; reason?: string }) =>
  actions.requestMakeup({ absenceDate: o.absence ?? yesterday(), windowStart: iso(o.from), windowEnd: iso(o.to), reason: o.reason ?? "I was unwell" });
const notices = (userId: string, kind: string) => rows(sql`select 1 from ops.notifications where user_id = ${userId} and kind = ${kind}`);
const statusOf = async (id: string) => (await rows<{ status: string }>(sql`select status from time.makeup_requests where id = ${id}`))[0].status;
const lastRequest = async (employeeId: string) => (await rows<{ id: string }>(sql`select id from time.makeup_requests where employee_id = ${employeeId} order by created_at desc limit 1`))[0].id;

let leadUser: TestUser;
let leadEmployeeId: string;

beforeAll(async () => {
  const lead = await person("mkLead", { roles: ["team_lead", "employee"] });
  leadUser = lead.user;
  leadEmployeeId = lead.employeeId;
});

describe("asking to make up hours", () => {
  it("records a request for a missed day and tells the lead", async () => {
    const w = await person("mkAsk", { managerId: leadEmployeeId });
    as(w.user);
    expect((await request({ from: 120, to: 360 })).ok).toBe(true);
    const [r] = await rows<{ status: string; missed_minutes: number; minutes: number; absence_date: string }>(sql`select status, missed_minutes, minutes, absence_date::text from time.makeup_requests where employee_id = ${w.employeeId}`);
    expect(r).toMatchObject({ status: "pending", missed_minutes: 480, minutes: 240, absence_date: yesterday() });
    expect(await notices(leadUser.id, "makeup.requested")).not.toHaveLength(0);
  });

  it("refuses today and the future", async () => {
    const w = await person("mkDays", { managerId: leadEmployeeId });
    as(w.user);
    expect(await request({ absence: formatInZone(Date.now(), PHX, "yyyy-MM-dd"), from: 120, to: 240 })).toEqual({ ok: false, error: "Choose a day that has already passed." });
  });

  it("refuses more than what is left to make up for that day, counting windows already asked for", async () => {
    const w = await person("mkMore", { managerId: leadEmployeeId });
    as(w.user);
    expect((await request({ from: 60, to: 360 })).ok).toBe(true); // 300 of 480
    const r = await request({ from: 600, to: 900 }); // 300 more
    expect(r).toEqual({ ok: false, error: "That is more than the 180 minutes you still have to make up for that day." });
  });

  it("refuses a window that overlaps one already asked for", async () => {
    const w = await person("mkOverlap", { managerId: leadEmployeeId });
    as(w.user);
    expect((await request({ from: 120, to: 240 })).ok).toBe(true);
    expect(await request({ from: 180, to: 300 })).toEqual({ ok: false, error: "Part of that time is already asked for as make-up hours." });
  });

  it("refuses a window that has already started more than a few minutes ago", async () => {
    const w = await person("mkPast", { managerId: leadEmployeeId });
    as(w.user);
    expect((await request({ from: -60, to: 60 })).ok).toBe(false);
  });
});

describe("deciding", () => {
  it("lets the lead approve, tells the person, and never lets a person decide their own", async () => {
    const w = await person("mkDecide", { managerId: leadEmployeeId });
    as(w.user);
    await request({ from: 120, to: 240 });
    const id = await lastRequest(w.employeeId);
    expect(await actions.decideMakeup({ requestId: id, decision: "approve" })).toEqual({ ok: false, error: "Someone else must decide on your own request." });
    const colleague = await person("mkColleague", { managerId: leadEmployeeId });
    as(colleague.user);
    expect(await actions.decideMakeup({ requestId: id, decision: "approve" })).toEqual({ ok: false, error: NO_ACCESS });
    as(leadUser);
    expect((await actions.decideMakeup({ requestId: id, decision: "approve" })).ok).toBe(true);
    expect(await statusOf(id)).toBe("approved");
    expect(await notices(w.user.id, "makeup.approved")).toHaveLength(1);
    expect((await actions.decideMakeup({ requestId: id, decision: "approve" })).ok).toBe(false); // already handled
  });

  it("a lead cannot decide their own request", async () => {
    const own = await person("mkOwn", { roles: ["team_lead", "employee"] });
    as(own.user);
    await request({ from: 120, to: 240 });
    const id = await lastRequest(own.employeeId);
    expect(await actions.decideMakeup({ requestId: id, decision: "approve" })).toEqual({ ok: false, error: "Someone else must decide on your own request." });
  });

  it("declining needs a reason, and frees the time for another request", async () => {
    const w = await person("mkDecline", { managerId: leadEmployeeId });
    as(w.user);
    await request({ from: 120, to: 240 });
    const id = await lastRequest(w.employeeId);
    as(leadUser);
    expect((await actions.decideMakeup({ requestId: id, decision: "decline" })).ok).toBe(false);
    expect((await actions.decideMakeup({ requestId: id, decision: "decline", note: "Not needed" })).ok).toBe(true);
    expect(await notices(w.user.id, "makeup.declined")).toHaveLength(1);
    as(w.user);
    expect((await request({ from: 120, to: 240 })).ok).toBe(true);
  });

  it("a lead cannot decide for someone outside their team", async () => {
    const stranger = await person("mkStranger");
    as(stranger.user);
    await request({ from: 120, to: 240 });
    const id = await lastRequest(stranger.employeeId);
    as(leadUser);
    expect((await actions.decideMakeup({ requestId: id, decision: "approve" })).ok).toBe(false);
  });
});

describe("cancelling", () => {
  it("lets the person cancel while it waits, and not after it was declined", async () => {
    const w = await person("mkCancel", { managerId: leadEmployeeId });
    as(w.user);
    await request({ from: 120, to: 240 });
    const id = await lastRequest(w.employeeId);
    expect((await actions.cancelMakeup({ requestId: id })).ok).toBe(true);
    expect(await statusOf(id)).toBe("cancelled");
    expect((await actions.cancelMakeup({ requestId: id })).ok).toBe(false);
  });
});

/** The most recent given weekday (1 = Monday ... 7 = Sunday) at least two days ago. */
function lastWeekday(iso: number): string {
  let d = Date.now() - 2 * DAY;
  while (Number(formatInZone(d, PHX, "i")) !== iso) d -= DAY;
  return formatInZone(d, PHX, "yyyy-MM-dd");
}

describe("people with no schedule use their daily hours (HR, leads, executives, recruiters)", () => {
  it("lists a weekday they were not clocked in, and takes a request for it", async () => {
    const staff = await person("mkStaff", { schedule: false, roles: ["hr_admin", "employee"] });
    const wed = lastWeekday(3);
    as(staff.user);
    const mine = await queries.getMyMakeup();
    expect(mine!.days.find((d) => d.date === wed)).toMatchObject({ missedMinutes: 480, leftMinutes: 480 });
    expect((await request({ absence: wed, from: 120, to: 360 })).ok).toBe(true);
  });

  it("uses the person's own hours per day when HR set them", async () => {
    const staff = await person("mkCap", { schedule: false });
    await db.execute(sql`update core.employees set daily_cap_minutes = 240 where id = ${staff.employeeId}`);
    const wed = lastWeekday(3);
    as(staff.user);
    expect((await queries.getMyMakeup())!.days.find((d) => d.date === wed)).toMatchObject({ missedMinutes: 240 });
    expect((await request({ absence: wed, from: 120, to: 480 })).ok).toBe(false); // 360 minutes is more than the 240 missed
    expect((await request({ absence: wed, from: 120, to: 360 })).ok).toBe(true);
  });

  it("has nothing to make up on a weekend", async () => {
    const staff = await person("mkWeekend", { schedule: false });
    const sat = lastWeekday(6);
    as(staff.user);
    expect((await queries.getMyMakeup())!.days.some((d) => d.date === sat)).toBe(false);
    expect(await request({ absence: sat, from: 120, to: 240 })).toEqual({ ok: false, error: "You had no working hours that day, so there is nothing to make up." });
  });

  it("does not count a day of approved leave as missed", async () => {
    const staff = await person("mkLeave", { schedule: false });
    const thu = lastWeekday(4);
    const [type] = await rows<{ id: string }>(sql`select id from time.leave_types limit 1`);
    await db.execute(sql`insert into time.leave_requests (employee_id, leave_type_id, start_date, end_date, half_day, days, status, filed_by, step_started_on)
      values (${staff.employeeId}, ${type.id}, ${thu}::date, ${thu}::date, false, 1, 'approved', ${staff.user.id}, current_date)`);
    as(staff.user);
    expect((await queries.getMyMakeup())!.days.some((d) => d.date === thu)).toBe(false);
    expect((await request({ absence: thu, from: 120, to: 240 })).ok).toBe(false);
  });

  it("is not listed for a day that was a holiday", async () => {
    const staff = await person("mkHoliday", { schedule: false });
    const tue = lastWeekday(2);
    await db.execute(sql`insert into time.holidays (calendar, date, name, verified) values ('PH', ${tue}::date, ${uniq("Test holiday ")}, true)`);
    as(staff.user);
    expect((await queries.getMyMakeup())!.days.some((d) => d.date === tue)).toBe(false);
  });

  it("goes to HR when the person above them is an executive, who cannot decide", async () => {
    const hrAdmin = await makeUser("mkHrNotify", ["hr_admin"]);
    const exec = await person("mkExec", { schedule: false, roles: ["executive", "employee"] });
    const recruiter = await person("mkRec", { schedule: false, managerId: exec.employeeId, roles: ["recruiter", "employee"] });
    as(recruiter.user);
    expect((await request({ absence: lastWeekday(3), from: 120, to: 240 })).ok).toBe(true);
    expect(await notices(hrAdmin.id, "makeup.requested")).not.toHaveLength(0);
    expect(await notices(exec.user.id, "makeup.requested")).toHaveLength(0);
  });
});
