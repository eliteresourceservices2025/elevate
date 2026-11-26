import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// HR says which client recorded time belongs to (the old event is removed and the same one added with the other client), and clocking in
// early no longer uses up the client's hours.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const edit = await import("@/modules/attendance/edit-actions");
const actions = await import("@/modules/attendance/actions");
const queries = await import("@/modules/attendance/queries");
const { computeStopLimit } = await import("@/modules/attendance/auto-stop-limit");
const { replayClock } = await import("@/modules/attendance/clock");
const { loadRecentEvents } = await import("@/modules/attendance/service");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const HOUR = 3_600_000;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const iso = (agoMs: number) => new Date(Math.floor((Date.now() - agoMs) / 1000) * 1000).toISOString();

async function person(label: string, roles: RoleSlug[] = ["employee"], opts: { managerId?: string } = {}) {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id)
    values (${label}, ${uniq(label)}, ${email}, 'active', ${id}, ${opts.managerId ?? null}) returning id`);
  return { user: { id, email, roles } as TestUser, employeeId: e.id };
}
const newClient = async (name: string) => (await rows<{ id: string }>(sql`insert into core.clients (name, time_zone) values (${uniq(name)}, 'America/Phoenix') returning id`))[0].id;
const assign = (employeeId: string, clientId: string) => db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${employeeId}, ${clientId}, current_date - 30)`);
const event = async (employeeId: string, type: string, at: string, clientId: string | null = null, source = "web") =>
  (await rows<{ id: string }>(sql`insert into time.clock_events (employee_id, type, occurred_at, client_id, source, jibble_entry_id) values (${employeeId}, ${type}, ${at}, ${clientId}, ${source}, ${source === "jibble" ? randomUUID() : null}) returning id`))[0].id;
const live = (employeeId: string) => rows<{ type: string; client_id: string | null }>(sql`select type, client_id from time.v_clock_events where employee_id = ${employeeId} order by occurred_at, created_at`);

let hr: TestUser;
let lead: { user: TestUser; employeeId: string };
let clientA: string;
let clientB: string;
let other: string;
beforeAll(async () => {
  hr = (await person("ccHr", ["hr_admin", "employee"])).user;
  lead = await person("ccLead", ["team_lead", "employee"]);
  clientA = await newClient("Change A ");
  clientB = await newClient("Change B ");
  other = await newClient("Change C ");
});

/** Two sessions: the second recorded under client B although client A asked for the time. */
async function worked(label: string, source = "web") {
  const p = await person(label, ["employee"], { managerId: lead.employeeId });
  await assign(p.employeeId, clientA);
  await assign(p.employeeId, clientB);
  const times = [iso(9 * HOUR), iso(5 * HOUR), iso(4.9 * HOUR), iso(HOUR)];
  await event(p.employeeId, "clock_in", times[0], clientA);
  await event(p.employeeId, "clock_out", times[1]);
  const second = await event(p.employeeId, "clock_in", times[2], clientB, source);
  await event(p.employeeId, "clock_out", times[3]);
  return { ...p, second, secondAt: times[2] };
}
const phoenixDay = (at: string) => new Date(at).toLocaleDateString("sv-SE", { timeZone: "America/Phoenix" });

describe("changing the client of recorded time", () => {
  it("moves it to the other client at once for HR, keeping the old event as removed", async () => {
    const p = await worked("ccMove");
    as(hr);
    const day = await edit.loadEditableDay({ employeeId: p.employeeId, date: phoenixDay(p.secondAt) });
    expect(day.ok && day.data.clients.map((c) => c.id).sort()).toEqual([clientA, clientB].sort());
    expect(day.ok && day.data.events.find((e) => e.id === p.second)).toMatchObject({ clientId: clientB });

    expect(await edit.editAttendance({ employeeId: p.employeeId, voidEventIds: [p.second], events: [{ type: "clock_in", at: p.secondAt, clientId: clientA }], reason: "Client A asked for this time" })).toEqual({ ok: true, data: { applied: true } });
    expect((await live(p.employeeId)).filter((e) => e.type === "clock_in").map((e) => e.client_id)).toEqual([clientA, clientA]);
    expect(await rows(sql`select 1 from time.clock_events where employee_id = ${p.employeeId}`)).toHaveLength(5); // nothing edited or deleted
    const [stillB] = await rows<{ n: number }>(sql`select count(*)::int as n from time.attendance_day_clients where employee_id = ${p.employeeId} and client_id = ${clientB}`);
    expect(stillB.n).toBe(0);
  });

  it("keeps the client when a lead's change is approved by HR, also with adjusted times", async () => {
    const p = await worked("ccLeadFlow");
    as(lead.user);
    expect(await edit.editAttendance({ employeeId: p.employeeId, voidEventIds: [p.second], events: [{ type: "clock_in", at: p.secondAt, clientId: clientA }], reason: "Client A asked for this time" })).toEqual({ ok: true, data: { applied: false } });
    expect((await live(p.employeeId))[2].client_id).toBe(clientB);

    as(hr);
    const waiting = (await queries.listCorrectionQueue()).items.find((c) => c.employeeId === p.employeeId)!;
    expect(waiting.proposed[0]).toMatchObject({ clientId: clientA, clientName: expect.stringContaining("Change A") });
    const later = new Date(Date.parse(p.secondAt) + 60_000).toISOString();
    expect(await actions.decideCorrection({ correctionId: waiting.id, decision: "approve", events: [{ type: "clock_in", at: later }] })).toEqual({ ok: true, data: undefined });
    expect((await live(p.employeeId))[2].client_id).toBe(clientA);
  });

  it("refuses a client they do not work for, a switch with no client, and Jibble's own entries", async () => {
    const p = await worked("ccRefuse");
    as(hr);
    const base = { employeeId: p.employeeId, voidEventIds: [p.second], reason: "Client A asked for this time" };
    expect(await edit.editAttendance({ ...base, events: [{ type: "clock_in", at: p.secondAt, clientId: other }] })).toEqual({ ok: false, error: "They are not assigned to that client on that day." });
    expect((await edit.editAttendance({ ...base, events: [{ type: "switch_client", at: p.secondAt }] })).ok).toBe(false);
    expect((await edit.editAttendance({ ...base, events: [{ type: "clock_out", at: p.secondAt, clientId: clientA }] })).ok).toBe(false);

    const j = await worked("ccJibble", "jibble");
    const r = await edit.editAttendance({ employeeId: j.employeeId, voidEventIds: [j.second], events: [{ type: "clock_in", at: j.secondAt, clientId: clientA }], reason: "Client A asked for this time" });
    expect(r.ok === false && r.error).toMatch(/Jibble/);
  });
});

describe("a switch of client", () => {
  it("is added by HR with its client, and cannot be asked for in a correction without one", async () => {
    const p = await worked("ccSwitch");
    const at = new Date(Date.parse(p.secondAt) + HOUR).toISOString();
    as(hr);
    expect(await edit.editAttendance({ employeeId: p.employeeId, voidEventIds: [], events: [{ type: "switch_client", at, clientId: clientA }], reason: "Moved to client A after an hour" })).toEqual({ ok: true, data: { applied: true } });
    expect((await live(p.employeeId)).filter((e) => e.type === "switch_client")).toEqual([{ type: "switch_client", client_id: clientA }]);

    expect((await actions.fileCorrectionForOthers({ employeeId: p.employeeId, events: [{ type: "switch_client", at }], reason: "Moved to client A" })).ok).toBe(false);
  });
});

describe("clocking in early", () => {
  it("does not use up the client's hours before the shift starts", async () => {
    const p = await person("ccEarly");
    await assign(p.employeeId, clientA);
    // A shift that started 6 hours ago and lasts 9, 8 of them for the client; they clocked in 30 minutes before it.
    const start = new Date(Date.now() - 6 * HOUR);
    start.setSeconds(0, 0);
    const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "America/Phoenix", hour: "2-digit", minute: "2-digit" });
    const end = new Date(start.getTime() + 9 * HOUR);
    const date = phoenixDay(start.toISOString());
    await db.execute(sql`insert into time.schedules (employee_id, client_id, allotted_minutes_per_day, effective_from, start_time, end_time, weekdays, break_minutes, zone)
      values (${p.employeeId}, ${clientA}, 480, ${date}::date - 1, ${hhmm(start)}, ${hhmm(end)}, array[1,2,3,4,5,6,7]::smallint[], 60, 'America/Phoenix')`);
    await event(p.employeeId, "clock_in", new Date(start.getTime() - 30 * 60_000).toISOString(), clientA);
    await event(p.employeeId, "break_start", new Date(start.getTime() + 3 * HOUR).toISOString());
    await event(p.employeeId, "break_end", new Date(start.getTime() + 4 * HOUR).toISOString());
    const limit = await computeStopLimit(db, p.employeeId, Date.now(), { replay: replayClock(await loadRecentEvents(db, p.employeeId)) });
    expect(limit!.limitMs).toBe(end.getTime());
  });
});
