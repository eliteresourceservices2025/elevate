import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PNG_BYTES } from "./fake-storage";

// Who may see whose tracker data, against a real database: own, a lead's team, HR, and nobody else.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const queries = await import("@/modules/activity/queries");
const shotActions = await import("@/modules/activity/shot-actions");
const { setDocumentStorage } = await import("@/modules/documents/storage");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const NO_ACCESS = "You do not have access to do that.";
const MIN = 60_000;
const fake = new FakeStorage();
let counter = 0;

type Person = { user: { id: string; email: string; roles: RoleSlug[] }; employeeId: string; deviceId: string };

async function person(roles: RoleSlug[], managerId?: string): Promise<Person> {
  const id = randomUUID();
  const email = `acc${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id) values ('Acc', 'Ess', ${email}, 'active', ${id}, ${managerId ?? null}) returning id`);
  const [d] = await rows<{ id: string }>(sql`insert into time.tracker_devices (employee_id, name, os, token_hash) values (${e.id}, 'PC', 'windows', ${randomUUID()}) returning id`);
  return { user: { id, email, roles }, employeeId: e.id, deviceId: d.id };
}
const as = (p: Person) => {
  current.user = p.user;
};

let lead: Person;
let report: Person;
let stranger: Person;
let hr: Person;
let executive: Person;
let shotId: string;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix" }).format(new Date()); // yyyy-mm-dd, the company day

beforeAll(async () => {
  setDocumentStorage(fake);
  lead = await person(["team_lead", "employee"]);
  report = await person(["employee"], lead.employeeId);
  stranger = await person(["team_lead", "employee"]);
  hr = await person(["hr_admin", "employee"]);
  executive = await person(["executive"]);
  const path = `shots/${report.employeeId}/x.jpg`;
  await fake.write("activity-shots", path, PNG_BYTES);
  const now = Date.now();
  await db.execute(sql`insert into time.activity_segments (employee_id, device_id, started_at, ended_at, app, state) values (${report.employeeId}, ${report.deviceId}, ${new Date(now - 20 * MIN).toISOString()}, ${new Date(now - 10 * MIN).toISOString()}, 'ZzApp', 'active')`);
  const [s] = await rows<{ id: string }>(sql`insert into time.activity_shots (employee_id, device_id, window_index, storage_path, taken_at, finalized_at) values (${report.employeeId}, ${report.deviceId}, 7, ${path}, now() - interval '15 minutes', now()) returning id`);
  shotId = s.id;
});

describe("a person's own day", () => {
  it("is open to them, including every role with no other tracker access", async () => {
    as(executive);
    const day = await queries.getMyDay({ date: today });
    expect(day.date).toBe(today);
    as(report);
    const mine = await queries.getMyDay({ date: today });
    expect(mine.topApps[0]?.app).toBe("ZzApp");
    expect(mine.shots).toHaveLength(1);
  });
});

describe("the day's extras", () => {
  it("carries the clocked-in time and the zone the day is in", async () => {
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${report.employeeId}, 'clock_in', now() - interval '40 minutes')`);
    as(report);
    const day = await queries.getMyDay({ date: today });
    expect(day.zone).toBe('America/Phoenix');
    expect(day.working.length).toBeGreaterThan(0);
    expect(Date.parse(day.working[0].end)).toBeGreaterThan(Date.parse(day.working[0].start));
  });
});

describe("who looked at my activity", () => {
  it("lists the lead's and HR's views with their names, reasons and counts, but not my own", async () => {
    as(lead);
    await shotActions.viewShot({ shotId, reason: 'coaching' });
    as(hr);
    await shotActions.viewShot({ shotId, reason: 'dispute' });
    as(report);
    await shotActions.viewShot({ shotId, reason: 'coaching' });
    const views = await queries.listMyShotViews();
    expect(views.length).toBeGreaterThanOrEqual(2);
    expect(views.every((v) => v.viewer.length > 0 && v.count >= 1)).toBe(true);
    expect(views.map((v) => v.reason)).toEqual(expect.arrayContaining(['coaching', 'dispute']));
    expect(views.some((v) => v.reason === "own")).toBe(false); // the person's own views are not "someone looked"
  });
  it("shows a person nothing about someone else's screenshots", async () => {
    as(stranger);
    expect(await queries.listMyShotViews()).toEqual([]);
  });
});

describe("someone else's day", () => {
  it("is open to their lead, to HR, and to nobody unrelated", async () => {
    as(lead);
    expect((await queries.getPersonDay({ employeeId: report.employeeId, date: today })).shots).toHaveLength(1);
    as(hr);
    expect((await queries.getPersonDay({ employeeId: report.employeeId, date: today })).minutes.active).toBeGreaterThan(0);
    as(stranger);
    await expect(queries.getPersonDay({ employeeId: report.employeeId, date: today })).rejects.toThrow();
    as(executive);
    await expect(queries.getPersonDay({ employeeId: report.employeeId, date: today })).rejects.toThrow();
  });
});

describe("the floor", () => {
  it("shows a lead only their team, and HR everyone", async () => {
    as(lead);
    const team = await queries.listFloor({});
    expect(team.map((r) => r.employeeId)).toEqual([report.employeeId]);
    expect(team[0].teamName).toBeNull(); // no team assigned in this test
    expect(team[0].lastSeenMinutes).toBeGreaterThanOrEqual(9); // the last segment ended 10 minutes ago
    expect(team[0].lastSeenMinutes).toBeLessThanOrEqual(12);
    as(hr);
    const all = await queries.listFloor({});
    expect(all.map((r) => r.employeeId)).toEqual(expect.arrayContaining([report.employeeId, lead.employeeId, stranger.employeeId]));
  });

  it("is not open to a plain employee or an executive", async () => {
    as(report);
    await expect(queries.listFloor({})).rejects.toThrow();
    as(executive);
    await expect(queries.listFloor({})).rejects.toThrow();
  });
});

describe("screenshots", () => {
  it("open for the person, their lead and HR, with every view audited by id and reason", async () => {
    for (const [who, reason] of [[report, "own"], [lead, "coaching"], [hr, "dispute"]] as const) {
      as(who);
      const r = await shotActions.viewShot({ shotId, reason: reason === "own" ? "coaching" : reason });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.url).toContain("activity-shots");
      const [a] = await rows<{ metadata: { reason: string; employeeId: string }; target_id: string }>(
        sql`select metadata, target_id from ops.audit_log where action = 'activity.shot_view' and actor_email = ${who.user.email} order by id desc limit 1`,
      );
      expect(a.target_id).toBe(shotId);
      expect(a.metadata.reason).toBe(reason);
      expect(JSON.stringify(a.metadata)).not.toMatch(/ZzApp|http/);
    }
  });

  it("are refused to an unrelated lead and to the executive", async () => {
    as(stranger);
    expect(await shotActions.viewShot({ shotId, reason: "coaching" })).toEqual({ ok: false, error: NO_ACCESS });
    as(executive);
    expect(await shotActions.viewShot({ shotId, reason: "coaching" })).toEqual({ ok: false, error: NO_ACCESS });
  });

  it("need a reason from the list", async () => {
    as(lead);
    expect((await shotActions.viewShot({ shotId, reason: "curiosity" })).ok).toBe(false);
  });

  it("are gone once purged", async () => {
    const [p] = await rows<{ id: string }>(sql`insert into time.activity_shots (employee_id, device_id, window_index, storage_path, taken_at, finalized_at, purged_at) values (${report.employeeId}, ${report.deviceId}, 8, ${`shots/${report.employeeId}/gone.jpg`}, now() - interval '40 days', now(), now()) returning id`);
    as(hr);
    expect(await shotActions.viewShot({ shotId: p.id, reason: "coaching" })).toEqual({ ok: false, error: "That screenshot is no longer available." });
  });
});

describe("devices", () => {
  it("lists one's own computers, and everyone's only for HR", async () => {
    as(report);
    expect((await queries.listDevices({})).map((d) => d.employeeId)).toEqual([report.employeeId]);
    await expect(queries.listDevices({ employeeId: lead.employeeId })).rejects.toThrow();
    as(hr);
    expect((await queries.listDevices({ employeeId: report.employeeId })).length).toBe(1);
  });
});
