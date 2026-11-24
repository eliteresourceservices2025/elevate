import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Strict time, auto-stop (design 2026-11-24): when a person's hours are used up the clock stops by itself at that moment. Only a
// person's own cap is used here (no schedule); shifts and client allotments are covered by the pure rules in day-limits.test.ts.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { runAutoStop, runAutoStopSweep } = await import("@/modules/attendance/auto-stop");
const actions = await import("@/modules/attendance/actions");
const queries = await import("@/modules/attendance/queries");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const MIN = 60_000;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const at = (offsetMin: number) => new Date(Date.now() + offsetMin * MIN).toISOString();
async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
/** A person with a daily cap (and no schedule), reporting to a lead. */
async function worker(label: string, capMinutes: number | null = 240) {
  const lead = await makeUser(`${label}lead`, ["team_lead"]);
  const [le] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${label + "L"}, ${uniq("Lead")}, ${lead.email}, 'active', ${lead.id}) returning id`);
  const user = await makeUser(label, ["employee"]);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, daily_cap_minutes) values (${label}, ${uniq("Worker")}, ${user.email}, 'active', ${user.id}, ${le.id}, ${capMinutes}) returning id`);
  return { user, lead, employeeId: e.id };
}
const event = (employeeId: string, type: string, when: string, planned: number | null = null) =>
  db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, planned_break_minutes) values (${employeeId}, ${type}, ${when}, ${planned})`);
const eventsOf = (employeeId: string) => rows<{ type: string; source: string; at: number }>(sql`select type, source, (extract(epoch from occurred_at) * 1000)::float8 as at from time.clock_events where employee_id = ${employeeId} order by occurred_at, created_at`);
const noticesFor = (userId: string) => rows(sql`select 1 from ops.notifications where user_id = ${userId} and kind = 'attendance.auto_stopped'`);

beforeAll(() => {
  current.user = null;
});

describe("runAutoStop", () => {
  it("stops a person past their daily cap, stamping the moment the cap was reached", async () => {
    const w = await worker("past");
    await event(w.employeeId, "clock_in", at(-300)); // 5 hours ago, cap 4 hours
    expect(await runAutoStop(w.employeeId)).toMatchObject({ status: "stopped" });
    const ev = await eventsOf(w.employeeId);
    expect(ev.map((e) => [e.type, e.source])).toEqual([["clock_in", "web"], ["clock_out", "auto_stop"]]);
    const stoppedAt = (ev[1].at - ev[0].at) / MIN;
    expect(stoppedAt).toBeGreaterThan(239);
    expect(stoppedAt).toBeLessThan(241);
  });

  it("tells the person and their lead once", async () => {
    const w = await worker("notices");
    await event(w.employeeId, "clock_in", at(-300));
    await runAutoStop(w.employeeId);
    expect(await noticesFor(w.user.id)).toHaveLength(1);
    expect(await noticesFor(w.lead.id)).toHaveLength(1);
    expect(await runAutoStop(w.employeeId)).toEqual({ status: "stale" });
    expect(await noticesFor(w.user.id)).toHaveLength(1);
  });

  it("leaves a person with hours left running and says when they run out", async () => {
    const w = await worker("early");
    await event(w.employeeId, "clock_in", at(-60));
    const r = await runAutoStop(w.employeeId);
    expect(r.status).toBe("early");
    expect(Math.abs((r.status === "early" ? r.limitMs : 0) - (Date.now() + 180 * MIN))).toBeLessThan(2 * MIN);
    expect(await eventsOf(w.employeeId)).toHaveLength(1);
  });

  it("is stale for someone who is not clocked in", async () => {
    const w = await worker("out");
    expect(await runAutoStop(w.employeeId)).toEqual({ status: "stale" });
  });

  it("never stops a person on the Jibble clock", async () => {
    const w = await worker("jibbler");
    await db.execute(sql`insert into time.clock_source (employee_id, source, set_by) values (${w.employeeId}, 'jibble', ${w.lead.id})`);
    await event(w.employeeId, "clock_in", at(-300));
    expect(await runAutoStop(w.employeeId)).toEqual({ status: "excluded" });
    expect(await eventsOf(w.employeeId)).toHaveLength(1);
  });

  it("ends a break and the shift together when the cap was reached before the break began", async () => {
    const w = await worker("onbreak");
    await event(w.employeeId, "clock_in", at(-300));
    await event(w.employeeId, "break_start", at(-20), 30); // 4h40 worked by then: the cap was reached 40 minutes before the break
    expect(await runAutoStop(w.employeeId)).toMatchObject({ status: "stopped" });
    const ev = await eventsOf(w.employeeId);
    expect(ev.map((e) => e.type)).toEqual(["clock_in", "break_start", "break_end", "clock_out"]);
    expect(ev.slice(2).every((e) => e.source === "auto_stop")).toBe(true);
    expect(ev[2].at).toBeGreaterThanOrEqual(ev[1].at); // never before the break began
  });

  it("does not stop a person who is on a break with hours still to work after it", async () => {
    const w = await worker("breakleft");
    await event(w.employeeId, "clock_in", at(-100));
    await event(w.employeeId, "break_start", at(-10), 30);
    expect((await runAutoStop(w.employeeId)).status).toBe("early");
  });

  it("the sweep stops everyone past their limit and leaves the rest", async () => {
    const over = await worker("sweepover");
    const fine = await worker("sweepfine");
    await event(over.employeeId, "clock_in", at(-300));
    await event(fine.employeeId, "clock_in", at(-30));
    const r = await runAutoStopSweep();
    expect(r.stopped).toBeGreaterThanOrEqual(1);
    expect((await eventsOf(over.employeeId)).at(-1)!.type).toBe("clock_out");
    expect((await eventsOf(fine.employeeId)).at(-1)!.type).toBe("clock_in");
  });
});

describe("clocking in with no hours left", () => {
  it("is refused with the reason, when the day's hours are already used", async () => {
    // A cap of one minute, and two minutes worked since midnight (company time zone): the day's hours are used up whatever the time of day.
    const w = await worker("nohours", 1);
    const midnight = fromZonedTime(`${formatInTimeZone(Date.now(), "America/Phoenix", "yyyy-MM-dd")}T00:00:00`, "America/Phoenix").getTime();
    await event(w.employeeId, "clock_in", new Date(midnight).toISOString());
    await event(w.employeeId, "clock_out", new Date(midnight + 2 * MIN).toISOString());
    current.user = w.user;
    const r = await actions.clockIn({});
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.error).toMatch(/no hours left/i);
  });

  it("is allowed when there are hours left", async () => {
    const w = await worker("hoursleft");
    current.user = w.user;
    expect((await actions.clockIn({})).ok).toBe(true);
  });
});

describe("the clock status", () => {
  it("tells the clock when it will warn and stop", async () => {
    const w = await worker("status");
    await event(w.employeeId, "clock_in", at(-60));
    current.user = w.user;
    const s = await queries.getClockStatus();
    expect(s?.stopAtMs).not.toBeNull();
    expect(Math.abs((s!.stopAtMs ?? 0) - (Date.now() + 180 * MIN))).toBeLessThan(2 * MIN);
    expect(s!.warnAtMs).toBe(s!.stopAtMs! - 10 * MIN);
  });

  it("has no stop time when not clocked in", async () => {
    const w = await worker("statusout");
    current.user = w.user;
    expect((await queries.getClockStatus())?.stopAtMs).toBeNull();
  });
});
