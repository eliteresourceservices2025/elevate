import { randomUUID } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for hours from Jibble: setting someone's clock source, importing their Jibble time entries as clock events
// (against a fake Jibble client), following edits and deletions, project and activity mapping, and the guards.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { formatInZone } = await import("@/lib/time");
const clockActions = await import("@/modules/attendance/actions");
const queries = await import("@/modules/attendance/queries");
const hoursQueries = await import("@/modules/attendance/hours-queries");
const { mondayOf } = await import("@/modules/attendance/pay-periods");
const sourceActions = await import("@/modules/jibble/clock-source-actions");
const { runJibbleImport } = await import("@/modules/jibble/import");
const jobs = await import("@/modules/jibble/jobs");
const { setJibbleClient } = await import("@/modules/jibble/client");
type JibbleClient = import("@/modules/jibble/http-client").JibbleClient;
type JibbleTimeEntryRow = import("@/modules/jibble/http-client").JibbleTimeEntryRow;

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const PHX = "America/Phoenix";
const NO_ACCESS = "You do not have access to do that.";
const DAY = 86_400_000;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};

class FakeJibble implements JibbleClient {
  entries = new Map<string, JibbleTimeEntryRow[]>();
  calls = 0;
  async listPeople() {
    return [];
  }
  async latestState() {
    return null;
  }
  async listBreaks() {
    return [];
  }
  async clock() {
    this.calls += 1;
    return { entryId: null };
  }
  async dailyTracked() {
    return [];
  }
  async listTimeEntries(personId: string) {
    return [...(this.entries.get(personId) ?? [])];
  }
}
const fake = new FakeJibble();

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
async function client(name = uniq("Client ")) {
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name, time_zone) values (${name}, 'America/New_York') returning id`);
  return { id: c.id, name };
}
/** A person matched to a Jibble account, with the clients they are assigned to. */
async function person(label: string, clientIds: string[], opts: { matched?: boolean } = {}) {
  const user = await makeUser(label, ["employee"]);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${label}, ${uniq(label)}, ${user.email}, 'active', ${user.id}) returning id`);
  const jibbleId = randomUUID();
  if (opts.matched !== false) await db.execute(sql`insert into time.jibble_people (employee_id, jibble_person_id, matched_by) values (${e.id}, ${jibbleId}, 'manual')`);
  for (const c of clientIds) await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${e.id}, ${c}, current_date - 30)`);
  return { user, employeeId: e.id, jibbleId };
}

const day = formatInZone(Date.now() - 2 * DAY, PHX, "yyyy-MM-dd");
const at = (time: string) => fromZonedTime(`${day}T${time}:00`, PHX).toISOString();
/** Jibble entry ids are globally unique, so the test ids carry the person. */
const entry = (personId: string, id: string, type: JibbleTimeEntryRow["type"], time: string, over: Partial<JibbleTimeEntryRow> = {}): JibbleTimeEntryRow => ({ id: `${personId}:${id}`, personId, type, time: at(time), projectId: null, activityId: null, ...over });
const events = (employeeId: string) => rows<{ type: string; client_id: string | null; source: string; jibble_entry_id: string | null }>(sql`select type, client_id, source, jibble_entry_id from time.v_clock_events where employee_id = ${employeeId} order by occurred_at, created_at`);
const dayRow = async (employeeId: string) => (await rows<{ worked_minutes: number; flags: string[] }>(sql`select worked_minutes, flags from time.attendance_days where employee_id = ${employeeId} and date = ${day}::date`))[0];

let hr: TestUser;
beforeAll(async () => {
  process.env.ELEVATE_ENV = "production"; // the safety lock lets the fake client be used
  setJibbleClient(fake);
  hr = await makeUser("hr", ["hr_admin", "employee"]);
});
afterAll(() => {
  delete process.env.ELEVATE_ENV;
  setJibbleClient(undefined);
});

/** Puts a person on the Jibble clock (as HR). */
async function onJibble(p: { employeeId: string }) {
  as(hr);
  expect((await sourceActions.setClockSource({ employeeId: p.employeeId, source: "jibble" })).ok).toBe(true);
}

describe("choosing where someone's hours come from", () => {
  it("needs a Jibble match, waits until they are clocked out, tells the person, and is append-only and HR only", async () => {
    const c = await client();
    const unmatched = await person("NoMatch", [c.id], { matched: false });
    as(hr);
    expect(await sourceActions.setClockSource({ employeeId: unmatched.employeeId, source: "jibble" })).toEqual({ ok: false, error: "Match them to their Jibble account first." });

    const p = await person("Source", [c.id]);
    // Clocked in on ELEVATE right now: not while a session is open
    as(p.user);
    expect((await clockActions.clockIn({})).ok).toBe(true);
    as(hr);
    expect((await sourceActions.setClockSource({ employeeId: p.employeeId, source: "jibble" })).ok).toBe(false);
    as(p.user);
    expect((await clockActions.clockOut()).ok).toBe(true);

    as(hr);
    expect(await sourceActions.setClockSource({ employeeId: p.employeeId, source: "jibble" })).toEqual({ ok: true, data: { source: "jibble" } });
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${p.user.id} and kind = 'clock_source.changed'`)).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'clock_source.set' and target_id = ${p.employeeId}`)).toHaveLength(1);
    expect(await sourceActions.setClockSource({ employeeId: p.employeeId, source: "jibble" })).toEqual({ ok: true, data: { source: "jibble" } }); // no change, no new row
    expect(await rows(sql`select 1 from time.clock_source where employee_id = ${p.employeeId}`)).toHaveLength(1);
    await expect(db.execute(sql`update time.clock_source set source = 'elevate' where employee_id = ${p.employeeId}`)).rejects.toThrow();

    for (const role of ["team_lead", "employee", "executive"] as RoleSlug[]) {
      as(await makeUser("NoJibble", [role]));
      expect(await sourceActions.setClockSource({ employeeId: p.employeeId, source: "elevate" })).toEqual({ ok: false, error: NO_ACCESS });
    }
  });

  it("switches the ELEVATE clock off for someone on the Jibble clock, never sends them to Jibble, and shows it to the widget", async () => {
    const c = await client();
    const p = await person("NoClock", [c.id]);
    await onJibble(p);
    as(p.user);
    const result = await clockActions.clockIn({});
    expect(!result.ok && result.error).toContain("You clock in Jibble");
    expect((await queries.getClockStatus())?.clockSource).toBe("jibble");
    expect(await jobs.maySendNow(p.employeeId, p.jibbleId)).toBe(false);
    expect(fake.calls).toBe(0);
  });
});

describe("importing a day from Jibble", () => {
  it("turns the entries into events with the client, rebuilds the day, and adds nothing the second time", async () => {
    const c = await client("Import Dental");
    const p = await person("ImportA", [c.id]);
    await onJibble(p);
    fake.entries.set(p.jibbleId, [entry(p.jibbleId, "e1", "In", "09:00"), entry(p.jibbleId, "e2", "StartBreak", "12:00"), entry(p.jibbleId, "e3", "In", "12:30"), entry(p.jibbleId, "e4", "Out", "17:00")]);

    const first = await runJibbleImport({ days: 5, employeeId: p.employeeId });
    expect(first).toMatchObject({ people: 1, imported: 4, voided: 0, failed: 0, skipped: null });
    const imported = await events(p.employeeId);
    expect(imported.map((e) => e.type)).toEqual(["clock_in", "break_start", "break_end", "clock_out"]);
    expect(imported.every((e) => e.source === "jibble" && e.jibble_entry_id !== null)).toBe(true);
    expect(imported[0].client_id).toBe(c.id); // the person's only client
    expect((await dayRow(p.employeeId)).worked_minutes).toBe(450);
    expect(await rows(sql`select 1 from time.attendance_day_clients where employee_id = ${p.employeeId} and date = ${day}::date and client_id = ${c.id}`)).toHaveLength(1);

    expect(await runJibbleImport({ days: 5, employeeId: p.employeeId })).toMatchObject({ imported: 0, voided: 0 });
    expect(await events(p.employeeId)).toHaveLength(4);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'jibble.import' and target_id = ${p.employeeId}`)).toHaveLength(1);
  });

  it("follows an entry edited in Jibble (the old event is voided, never changed) and one that is deleted", async () => {
    const c = await client();
    const p = await person("ImportEdit", [c.id]);
    await onJibble(p);
    fake.entries.set(p.jibbleId, [entry(p.jibbleId, "e1", "In", "09:00"), entry(p.jibbleId, "e4", "Out", "17:00")]);
    await runJibbleImport({ days: 5, employeeId: p.employeeId });
    expect((await dayRow(p.employeeId)).worked_minutes).toBe(480);

    // The clock-in is edited to 9:30 in Jibble
    fake.entries.set(p.jibbleId, [entry(p.jibbleId, "e1", "In", "09:30"), entry(p.jibbleId, "e4", "Out", "17:00")]);
    expect(await runJibbleImport({ days: 5, employeeId: p.employeeId })).toMatchObject({ imported: 1, voided: 1 });
    expect((await dayRow(p.employeeId)).worked_minutes).toBe(450);
    expect(await rows(sql`select 1 from time.clock_events where employee_id = ${p.employeeId} and type = 'clock_in'`)).toHaveLength(2); // the old row stays, voided
    expect(await events(p.employeeId)).toHaveLength(2);

    // The clock-out is deleted in Jibble: the session is open again
    fake.entries.set(p.jibbleId, [entry(p.jibbleId, "e1", "In", "09:30")]);
    expect(await runJibbleImport({ days: 5, employeeId: p.employeeId })).toMatchObject({ imported: 0, voided: 1 });
    expect((await events(p.employeeId)).map((e) => e.type)).toEqual(["clock_in"]);
  });

  it("keeps imported hours when Jibble suddenly returns nothing, and tells HR once", async () => {
    const c = await client();
    const p = await person("ImportEmpty", [c.id]);
    await onJibble(p);
    fake.entries.set(p.jibbleId, [entry(p.jibbleId, "e1", "In", "09:00"), entry(p.jibbleId, "e2", "Out", "17:00")]);
    await runJibbleImport({ days: 5, employeeId: p.employeeId });
    fake.entries.set(p.jibbleId, []);
    const run = await runJibbleImport({ days: 5, employeeId: p.employeeId });
    expect(run).toMatchObject({ voided: 0, keptBecauseEmpty: 2 });
    expect(await events(p.employeeId)).toHaveLength(2);
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${hr.id} and kind = 'jibble.import_empty'`)).length).toBeGreaterThanOrEqual(1);
  });

  it("does not bring back an event HR voided, while Jibble still says the same", async () => {
    const c = await client();
    const p = await person("ImportVoid", [c.id]);
    await onJibble(p);
    fake.entries.set(p.jibbleId, [entry(p.jibbleId, "e1", "In", "09:00"), entry(p.jibbleId, "e2", "Out", "17:00")]);
    await runJibbleImport({ days: 5, employeeId: p.employeeId });
    const [out] = await rows<{ id: string }>(sql`select id from time.clock_events where employee_id = ${p.employeeId} and type = 'clock_out'`);
    await db.execute(sql`insert into time.clock_event_voids (event_id, reason, voided_by) values (${out.id}, 'Corrected by HR', ${hr.id})`);
    expect(await runJibbleImport({ days: 5, employeeId: p.employeeId })).toMatchObject({ imported: 0, voided: 0 });
    expect((await events(p.employeeId)).map((e) => e.type)).toEqual(["clock_in"]);
  });

  it("does nothing for people on the ELEVATE clock, when not configured, or when the link is paused", async () => {
    const c = await client();
    const onElevate = await person("StaysElevate", [c.id]);
    fake.entries.set(onElevate.jibbleId, [entry(onElevate.jibbleId, "x1", "In", "09:00")]);
    expect(await runJibbleImport({ days: 5, employeeId: onElevate.employeeId })).toMatchObject({ people: 0, imported: 0 });
    expect(await events(onElevate.employeeId)).toHaveLength(0);

    expect(await runJibbleImport({ client: null })).toMatchObject({ skipped: "not_configured" });
    await db.execute(sql`insert into time.jibble_settings (id, paused) values (1, true) on conflict (id) do update set paused = true`);
    try {
      expect(await runJibbleImport({ days: 5 })).toMatchObject({ skipped: "paused" });
    } finally {
      await db.execute(sql`update time.jibble_settings set paused = false where id = 1`);
    }
  });
});

describe("Jibble projects and activities", () => {
  it("maps a project to a client, switches client on a change of project, splits the day, and flags time with no client", async () => {
    const a = await client("Map Acme");
    const b = await client("Map Beta");
    const lead = await makeUser("MapLead", ["team_lead", "employee"]);
    const p = await person("MapPerson", [a.id, b.id]);
    await db.execute(sql`update core.employees set manager_id = (select id from core.employees where user_id = ${lead.id}) where id = ${p.employeeId}`).catch(() => undefined);
    await onJibble(p);

    as(hr);
    expect((await sourceActions.saveClientMap({ kind: "project", jibbleId: "proj-a", clientId: a.id })).ok).toBe(true);
    expect((await sourceActions.saveClientMap({ kind: "activity", jibbleId: "act-b", clientId: b.id })).ok).toBe(true);
    fake.entries.set(p.jibbleId, [
      entry(p.jibbleId, "m1", "In", "09:00", { projectId: "proj-a" }),
      entry(p.jibbleId, "m2", "In", "13:00", { projectId: "proj-a", activityId: "act-b" }), // the activity wins: now Beta
      entry(p.jibbleId, "m3", "Out", "17:00"),
    ]);
    await runJibbleImport({ days: 5, employeeId: p.employeeId });
    expect((await events(p.employeeId)).map((e) => [e.type, e.client_id])).toEqual([["clock_in", a.id], ["switch_client", b.id], ["clock_out", null]]);
    const split = await rows<{ client_id: string; worked_minutes: number }>(sql`select client_id, worked_minutes from time.attendance_day_clients where employee_id = ${p.employeeId} and date = ${day}::date`);
    expect(split.map((r) => r.worked_minutes).sort()).toEqual([240, 240]);
    expect((await dayRow(p.employeeId)).flags).not.toContain("needs_client");

    // A project nobody mapped, for a person with two clients: no client, the day is flagged, and the id is listed for HR
    const q = await person("MapUnknown", [a.id, b.id]);
    await onJibble(q);
    fake.entries.set(q.jibbleId, [entry(q.jibbleId, "u1", "In", "09:00", { projectId: "proj-new" }), entry(q.jibbleId, "u2", "Out", "17:00")]);
    await runJibbleImport({ days: 5, employeeId: q.employeeId });
    expect((await events(q.employeeId))[0].client_id).toBeNull();
    expect((await dayRow(q.employeeId)).flags).toContain("needs_client");
    expect(await rows(sql`select 1 from time.jibble_unmapped_ids where kind = 'project' and jibble_id = 'proj-new'`)).toHaveLength(1);

    // HR maps it: the next import re-attributes the day and the flag goes
    as(hr);
    expect((await sourceActions.saveClientMap({ kind: "project", jibbleId: "proj-new", clientId: b.id })).ok).toBe(true);
    expect(await rows(sql`select 1 from time.jibble_unmapped_ids where kind = 'project' and jibble_id = 'proj-new'`)).toHaveLength(0);
    await runJibbleImport({ days: 5, employeeId: q.employeeId });
    expect((await events(q.employeeId))[0].client_id).toBe(b.id);
    expect((await dayRow(q.employeeId)).flags).not.toContain("needs_client");
  });

  it("is HR only, validates the mapping, and can remove one", async () => {
    const a = await client();
    as(await makeUser("MapNo", ["team_lead", "employee"]));
    expect(await sourceActions.saveClientMap({ kind: "project", jibbleId: "x", clientId: a.id })).toEqual({ ok: false, error: NO_ACCESS });
    as(hr);
    expect((await sourceActions.saveClientMap({ kind: "project", jibbleId: "", clientId: a.id })).ok).toBe(false);
    expect((await sourceActions.saveClientMap({ kind: "project", jibbleId: "x", clientId: randomUUID() })).ok).toBe(false);
    expect((await sourceActions.saveClientMap({ kind: "project", jibbleId: "to-remove", clientId: a.id })).ok).toBe(true);
    const [m] = await rows<{ id: string }>(sql`select id from time.jibble_client_map where jibble_id = 'to-remove'`);
    expect((await sourceActions.removeClientMap({ id: m.id })).ok).toBe(true);
    expect((await sourceActions.removeClientMap({ id: m.id })).ok).toBe(false);
  });
});

describe("what review and approval see", () => {
  it("shows a Jibble day in hours review like any other, with no screenshot flags", async () => {
    const c = await client();
    const lead = await makeUser("RevLead", ["team_lead", "employee"]);
    const [leadEmp] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('RevLead', ${uniq("L")}, ${lead.email}, 'active', ${lead.id}) returning id`);
    const p = await person("RevPerson", [c.id]);
    await db.execute(sql`update core.employees set manager_id = ${leadEmp.id} where id = ${p.employeeId}`);
    await onJibble(p);
    fake.entries.set(p.jibbleId, [entry(p.jibbleId, "r1", "In", "09:00"), entry(p.jibbleId, "r2", "Out", "17:00")]);
    await runJibbleImport({ days: 5, employeeId: p.employeeId });
    as(lead);
    const review = await hoursQueries.getTeamReview(mondayOf(day));
    const d = review.rows.find((r) => r.employeeId === p.employeeId)?.days.find((x) => x.date === day);
    expect(d?.workedMinutes).toBe(480);
    expect(d?.flags).not.toContain("no_screenshots");
    expect(d?.flags).not.toContain("jibble_mismatch");
  });
});

describe("moving contractors who use Jibble alone", () => {
  const overviewQueries = import("@/modules/jibble/clock-source-queries");

  it("lists matched people with no recent ELEVATE clock use who are clocked out, and nobody else", async () => {
    const { getClockSourceOverview } = await overviewQueries;
    const c = await client();
    const alone = await person("AloneA", [c.id]);
    const usesElevate = await person("AloneUsesElevate", [c.id]);
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${usesElevate.employeeId}, 'clock_in', now() - interval '2 days'), (${usesElevate.employeeId}, 'clock_out', now() - interval '2 days' + interval '8 hours')`);
    const old = await person("AloneOldElevate", [c.id]);
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${old.employeeId}, 'clock_in', now() - interval '40 days'), (${old.employeeId}, 'clock_out', now() - interval '40 days' + interval '8 hours')`);
    const unmatched = await person("AloneUnmatched", [c.id], { matched: false });
    const already = await person("AloneAlready", [c.id]);
    await onJibble(already);
    const openNow = await person("AloneOpen", [c.id]);
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${openNow.employeeId}, 'clock_in', now() - interval '20 days')`); // never clocked out

    as(hr);
    const listed = (await getClockSourceOverview()).jibbleAlone.map((p) => p.employeeId);
    expect(listed).toContain(alone.employeeId);
    expect(listed).toContain(old.employeeId); // used it, but not in the last 14 days
    for (const other of [usesElevate, unmatched, already, openNow]) expect(listed).not.toContain(other.employeeId);
    const row = (await getClockSourceOverview()).jibbleAlone.find((p) => p.employeeId === old.employeeId);
    expect(row?.lastElevate).not.toBeNull();
    expect((await getClockSourceOverview()).jibbleAlone.find((p) => p.employeeId === alone.employeeId)?.lastElevate).toBeNull();
  });

  it("moves the ticked people at once, skips anyone who cannot move with the reason, is HR only, and asks for at least one", async () => {
    const c = await client();
    const a = await person("BulkA", [c.id]);
    const b = await person("BulkB", [c.id]);
    const unmatched = await person("BulkNoMatch", [c.id], { matched: false });
    const clockedIn = await person("BulkOpen", [c.id]);
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${clockedIn.employeeId}, 'clock_in', now() - interval '1 hour')`);
    const already = await person("BulkAlready", [c.id]);
    await onJibble(already);

    as(hr);
    const result = await sourceActions.setJibbleClockForMany({ employeeIds: [a.employeeId, b.employeeId, unmatched.employeeId, clockedIn.employeeId, already.employeeId] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ switched: 2, already: 1 });
    expect(result.data.skipped).toHaveLength(2);
    expect(result.data.skipped.map((s) => s.reason).sort()).toEqual(["Match them to their Jibble account first.", "They are clocked in right now. Change this after they clock out, so no session is cut in two."].sort());
    expect(await rows(sql`select 1 from time.clock_source where employee_id in (${a.employeeId}, ${b.employeeId}) and source = 'jibble'`)).toHaveLength(2);
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${a.user.id} and kind = 'clock_source.changed'`)).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'clock_source.set' and target_id = ${a.employeeId}`)).toHaveLength(1);

    expect((await sourceActions.setJibbleClockForMany({ employeeIds: [] })).ok).toBe(false);
    for (const role of ["team_lead", "employee", "executive"] as RoleSlug[]) {
      as(await makeUser("BulkNo", [role]));
      expect(await sourceActions.setJibbleClockForMany({ employeeIds: [a.employeeId] })).toEqual({ ok: false, error: NO_ACCESS });
    }
  });

  it("imports only the people it is asked to, when a list is given", async () => {
    const c = await client();
    const one = await person("OnlyOne", [c.id]);
    const two = await person("OnlyTwo", [c.id]);
    await onJibble(one);
    await onJibble(two);
    fake.entries.set(one.jibbleId, [entry(one.jibbleId, "o1", "In", "09:00"), entry(one.jibbleId, "o2", "Out", "17:00")]);
    fake.entries.set(two.jibbleId, [entry(two.jibbleId, "t1", "In", "09:00"), entry(two.jibbleId, "t2", "Out", "17:00")]);
    expect(await runJibbleImport({ days: 5, employeeIds: [one.employeeId] })).toMatchObject({ people: 1, imported: 2 });
    expect(await events(one.employeeId)).toHaveLength(2);
    expect(await events(two.employeeId)).toHaveLength(0);
    expect(await runJibbleImport({ days: 5, employeeIds: [] })).toMatchObject({ people: 0, imported: 0 });
    const { listJibbleImportPeople } = await import("@/modules/jibble/import");
    const due = await listJibbleImportPeople();
    expect(due).toContain(one.employeeId);
    expect(due).toContain(two.employeeId);
  });
});

describe("a session Jibble left open, and moving back to the ELEVATE clock", () => {
  const REASON = "Left the Jibble timer running";
  const iso = (time: string, plusHours = 0) => new Date(Date.parse(at(time)) + plusHours * 3_600_000).toISOString();

  /** A person on the Jibble clock whose Jibble entries end in an In with no Out (the timer was never stopped). */
  async function openOnJibble(label: string, extra: JibbleTimeEntryRow["type"][] = []) {
    const c = await client();
    const p = await person(label, [c.id]);
    await onJibble(p);
    const list = [entry(p.jibbleId, "e1", "In", "09:00"), ...extra.map((type, i) => entry(p.jibbleId, `x${i}`, type, "12:00"))];
    fake.entries.set(p.jibbleId, list);
    await runJibbleImport({ days: 5, employeeId: p.employeeId });
    return p;
  }
  const source = async (employeeId: string) => (await rows<{ source: string }>(sql`select source from time.clock_source where employee_id = ${employeeId} order by set_at desc, id desc limit 1`))[0]?.source;

  it("is refused with a plain message, then HR closes it at the time they stopped and they move in one step", async () => {
    const p = await openOnJibble("OpenA");
    expect((await events(p.employeeId)).map((e) => e.type)).toEqual(["clock_in"]);

    as(hr);
    const refused = await sourceActions.setClockSource({ employeeId: p.employeeId, source: "elevate" });
    expect(!refused.ok && refused.error).toContain("Close session and switch");
    expect(await source(p.employeeId)).toBe("jibble");

    expect(await sourceActions.closeSessionAndUseElevateClock({ employeeId: p.employeeId, closeAt: iso("17:00"), reason: REASON })).toEqual({ ok: true, data: { closed: true } });
    const after = await events(p.employeeId);
    expect(after.map((e) => [e.type, e.source])).toEqual([["clock_in", "jibble"], ["clock_out", "admin_correction"]]);
    expect(await source(p.employeeId)).toBe("elevate");
    expect((await dayRow(p.employeeId)).worked_minutes).toBe(480);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'clock_source.close_session' and target_id = ${p.employeeId}`)).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'clock_source.set' and target_id = ${p.employeeId}`)).toHaveLength(2); // to Jibble, then back
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${p.user.id} and kind = 'attendance.time_changed'`)).toHaveLength(1);
    expect(await rows(sql`select 1 from time.clock_corrections where employee_id = ${p.employeeId} and status = 'approved' and reason = ${REASON}`)).toHaveLength(1);

    // They can clock in ELEVATE now, and the Jibble import no longer touches them
    as(p.user);
    expect((await clockActions.clockIn({})).ok).toBe(true);
    expect(await runJibbleImport({ days: 5, employeeId: p.employeeId })).toMatchObject({ people: 0 });
  });

  it("ends a break first when they were on one, in that order", async () => {
    const p = await openOnJibble("OpenBreak", ["StartBreak"]);
    as(hr);
    expect((await sourceActions.closeSessionAndUseElevateClock({ employeeId: p.employeeId, closeAt: iso("12:30"), reason: REASON })).ok).toBe(true);
    expect((await events(p.employeeId)).map((e) => e.type)).toEqual(["clock_in", "break_start", "break_end", "clock_out"]);
  });

  it("refuses a time in the future, before the clock-in or more than 16 hours after it, and changes nothing", async () => {
    const p = await openOnJibble("OpenBad");
    as(hr);
    const tries: { closeAt: string; error: RegExp }[] = [
      { closeAt: new Date(Date.now() + 3_600_000).toISOString(), error: /future/i },
      { closeAt: iso("08:00"), error: /after their last clock event/i },
      { closeAt: iso("09:00", 17), error: /16 hours/i },
    ];
    for (const t of tries) {
      const result = await sourceActions.closeSessionAndUseElevateClock({ employeeId: p.employeeId, closeAt: t.closeAt, reason: REASON });
      expect(!result.ok && result.error).toMatch(t.error);
    }
    expect(await events(p.employeeId)).toHaveLength(1);
    expect(await source(p.employeeId)).toBe("jibble");
    expect(await sourceActions.closeSessionAndUseElevateClock({ employeeId: p.employeeId, closeAt: iso("17:00"), reason: "no" })).toMatchObject({ ok: false });
  });

  it("only switches when nothing is open, and does nothing for someone already on the ELEVATE clock", async () => {
    const c = await client();
    const done = await person("OpenDone", [c.id]);
    await onJibble(done);
    fake.entries.set(done.jibbleId, [entry(done.jibbleId, "d1", "In", "09:00"), entry(done.jibbleId, "d2", "Out", "17:00")]);
    await runJibbleImport({ days: 5, employeeId: done.employeeId });
    as(hr);
    expect(await sourceActions.closeSessionAndUseElevateClock({ employeeId: done.employeeId, closeAt: iso("18:00"), reason: REASON })).toEqual({ ok: true, data: { closed: false } });
    expect(await events(done.employeeId)).toHaveLength(2); // nothing added
    expect(await source(done.employeeId)).toBe("elevate");
    expect(await sourceActions.closeSessionAndUseElevateClock({ employeeId: done.employeeId, closeAt: iso("18:00"), reason: REASON })).toEqual({ ok: false, error: "They already use the ELEVATE clock." });
  });

  it("is for HR and Super Admin only, and nobody closes their own session", async () => {
    const p = await openOnJibble("OpenRoles");
    for (const role of ["team_lead", "employee", "executive", "recruiter"] as RoleSlug[]) {
      as(await makeUser("NoClose", [role]));
      expect(await sourceActions.closeSessionAndUseElevateClock({ employeeId: p.employeeId, closeAt: iso("17:00"), reason: REASON })).toEqual({ ok: false, error: NO_ACCESS });
    }
    expect(await events(p.employeeId)).toHaveLength(1);

    // An HR person who is themself the one on the Jibble clock cannot close their own session
    const own = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Own', ${uniq("Own")}, ${hr.email}, 'active', ${hr.id}) returning id`);
    await db.execute(sql`insert into time.jibble_people (employee_id, jibble_person_id, matched_by) values (${own[0].id}, ${randomUUID()}, 'manual')`);
    await db.execute(sql`insert into time.clock_source (employee_id, source, set_by) values (${own[0].id}, 'jibble', ${hr.id})`);
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, source, jibble_entry_id) values (${own[0].id}, 'clock_in', ${iso("09:00")}, 'jibble', ${uniq("own-entry")})`);
    as(hr);
    expect(await sourceActions.closeSessionAndUseElevateClock({ employeeId: own[0].id, closeAt: iso("17:00"), reason: REASON })).toEqual({ ok: false, error: "Someone else must change your own time. Ask HR or your lead." });
  });
});
