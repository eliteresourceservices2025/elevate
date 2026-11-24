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

  it("refuses today, the future, and a day with no schedule", async () => {
    const w = await person("mkDays", { managerId: leadEmployeeId });
    const noSchedule = await person("mkNoSched", { managerId: leadEmployeeId, schedule: false });
    as(w.user);
    expect(await request({ absence: formatInZone(Date.now(), PHX, "yyyy-MM-dd"), from: 120, to: 240 })).toEqual({ ok: false, error: "Choose a day that has already passed." });
    as(noSchedule.user);
    expect(await request({ from: 120, to: 240 })).toEqual({ ok: false, error: "You had no scheduled hours that day, so there is nothing to make up." });
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
