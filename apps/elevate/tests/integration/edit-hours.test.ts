import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Changing someone's recorded time: HR removes a wrongly recorded event (it is marked removed, never deleted) and adds the right ones, at
// once and for any day up to a year back; a Team Lead's change for their team waits for HR; nobody changes their own time; the hours are
// rebuilt from the events that remain and the record keeps everything.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const edit = await import("@/modules/attendance/edit-actions");
const actions = await import("@/modules/attendance/actions");
const queries = await import("@/modules/attendance/queries");
const jobs = await import("@/modules/attendance/jobs");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();

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

async function event(employeeId: string, type: string, at: string): Promise<string> {
  const [r] = await rows<{ id: string }>(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${employeeId}, ${type}, ${at}) returning id`);
  return r.id;
}
/** The reason an action was refused (undefined when it went through). */
const failure = async (result: Promise<{ ok: boolean; error?: string }>) => (await result).error;
const rebuild = (employeeId: string, daysBack = 20) => jobs.rebuildAttendanceDays(new Date(), daysBack, employeeId);
const dayRow = async (employeeId: string, ago: number) => {
  const date = new Date(Date.now() - ago).toISOString().slice(0, 10);
  return (await rows<{ worked_minutes: number; flags: string[]; date: string }>(sql`select worked_minutes, flags, date::text as date from time.attendance_days where employee_id = ${employeeId} and date between ${date}::date - 1 and ${date}::date + 1 order by worked_minutes desc limit 1`))[0];
};
const effectiveTypes = async (employeeId: string) => (await rows<{ type: string }>(sql`select type from time.v_clock_events where employee_id = ${employeeId} order by occurred_at, created_at`)).map((r) => r.type);

let hr: TestUser;
let hr2: TestUser;
let lead: TestUser;
let leadEmployeeId: string;
let stranger: TestUser;
beforeAll(async () => {
  hr = (await person("hr", ["hr_admin", "employee"])).user;
  hr2 = (await person("hr2", ["hr_admin", "employee"])).user;
  const l = await person("lead", ["team_lead", "employee"]);
  lead = l.user;
  leadEmployeeId = l.employeeId;
  stranger = (await person("stranger", ["employee"])).user;
});

describe("HR changes someone's time at once", () => {
  it("removes a wrong clock-out and adds the right one: the day is rebuilt, the record keeps everything", async () => {
    const worker = await person("Wrong", ["employee"], { managerId: leadEmployeeId });
    const inId = await event(worker.employeeId, "clock_in", iso(30 * HOUR));
    const wrongOut = await event(worker.employeeId, "clock_out", iso(21 * HOUR)); // forgot, clocked out 9 hours later than they stopped?
    await rebuild(worker.employeeId);
    const before = await dayRow(worker.employeeId, 30 * HOUR);
    expect(before.worked_minutes).toBe(540);

    as(hr);
    // The day's events can be loaded, in the person's zone
    const day = await edit.loadEditableDay({ employeeId: worker.employeeId, date: new Date(Date.now() - 30 * HOUR).toISOString().slice(0, 10) });
    expect(day.ok).toBe(true);
    if (day.ok) expect(day.data.events.map((e) => e.id)).toEqual(expect.arrayContaining([inId, wrongOut]));

    const result = await edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [wrongOut], events: [{ type: "clock_out", at: iso(26 * HOUR) }], reason: "He stopped at 4 hours, the clock-out was recorded late" });
    expect(result).toEqual({ ok: true, data: { applied: true } });

    // Hours now follow the right event; nothing was deleted or edited
    expect((await dayRow(worker.employeeId, 30 * HOUR)).worked_minutes).toBe(240);
    expect(await effectiveTypes(worker.employeeId)).toEqual(["clock_in", "clock_out"]);
    expect((await rows(sql`select 1 from time.clock_events where employee_id = ${worker.employeeId}`)).length).toBe(3); // the wrong one is still there
    const [voidRow] = await rows<{ event_id: string; reason: string; voided_by: string }>(sql`select event_id, reason, voided_by from time.clock_event_voids where event_id = ${wrongOut}`);
    expect(voidRow).toMatchObject({ event_id: wrongOut, voided_by: hr.id });
    expect((await dayRow(worker.employeeId, 30 * HOUR)).flags).toContain("corrected");

    // The change is on the record: a correction row, the audit entry with before and after, and the person is told
    const [corr] = await rows<{ status: string; requested_by: string; void_event_ids: string[] }>(sql`select status, requested_by, void_event_ids from time.clock_corrections where employee_id = ${worker.employeeId}`);
    expect(corr).toMatchObject({ status: "approved", requested_by: hr.id, void_event_ids: [wrongOut] });
    const [audit] = await rows<{ before: { removed: { id: string }[] }; after: { added: unknown[] } }>(sql`select before, after from ops.audit_log where action = 'clock.edit_hours' and target_id = ${worker.employeeId} order by id desc limit 1`);
    expect(audit.before.removed.map((r) => r.id)).toEqual([wrongOut]);
    expect(audit.after.added).toHaveLength(1);
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${worker.user.id} and kind = 'attendance.time_changed'`)).length).toBe(1);

    // The person sees the change in their own list, with what was removed
    as(worker.user);
    const mine = (await queries.getMyTime())!;
    expect(mine.corrections[0].removes.map((r) => r.type)).toEqual(["clock_out"]);
  });

  it("can add a whole missed day and works for a day older than 31 days (up to a year)", async () => {
    const worker = await person("Old");
    as(hr);
    const result = await edit.editAttendance({
      employeeId: worker.employeeId,
      voidEventIds: [],
      events: [{ type: "clock_in", at: iso(100 * DAY + 8 * HOUR) }, { type: "clock_out", at: iso(100 * DAY) }],
      reason: "Missed day entered for payroll from the timesheet",
    });
    expect(result).toEqual({ ok: true, data: { applied: true } });
    expect(await effectiveTypes(worker.employeeId)).toEqual(["clock_in", "clock_out"]);
    expect((await dayRow(worker.employeeId, 100 * DAY + 4 * HOUR)).worked_minutes).toBe(480);

    // not further than a year, never in the future
    expect((await edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [], events: [{ type: "clock_in", at: iso(400 * DAY) }], reason: "Too old to be changed" })).ok).toBe(false);
    expect((await edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [], events: [{ type: "clock_in", at: new Date(Date.now() + 2 * HOUR).toISOString() }], reason: "In the future is not allowed" })).ok).toBe(false);
  });

  it("brings the clock back to 'still clocked in' when the clock-out is removed", async () => {
    const worker = await person("Reopen");
    await event(worker.employeeId, "clock_in", iso(3 * HOUR));
    const out = await event(worker.employeeId, "clock_out", iso(1 * HOUR));
    as(hr);
    expect((await edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [out], events: [], reason: "He never clocked out, the click was a mistake" })).ok).toBe(true);
    as(worker.user);
    expect((await queries.getClockStatus())?.state).toBe("working");
  });

  it("refuses a change that leaves the record not fitting, an event that is not theirs, one already removed, and a session over 16 hours", async () => {
    const worker = await person("Fit");
    const other = await person("Other");
    const inId = await event(worker.employeeId, "clock_in", iso(10 * HOUR));
    const outId = await event(worker.employeeId, "clock_out", iso(6 * HOUR));
    const otherEvent = await event(other.employeeId, "clock_in", iso(5 * HOUR));
    as(hr);
    // removing the clock-in would leave a clock-out with nothing before it
    expect(await failure(edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [inId], events: [], reason: "Removing only the clock-in" }))).toMatch(/does not fit/);
    // somebody else's event
    expect(await failure(edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [otherEvent], events: [], reason: "That is not their event" }))).toMatch(/not on this person's record/);
    // a clock-out so late that the session would run over 16 hours
    const long = await person("Long");
    await event(long.employeeId, "clock_in", iso(30 * HOUR));
    const longOut = await event(long.employeeId, "clock_out", iso(28 * HOUR));
    expect(await failure(edit.editAttendance({ employeeId: long.employeeId, voidEventIds: [longOut], events: [{ type: "clock_out", at: iso(5 * HOUR) }], reason: "Moved it a whole day later" }))).toMatch(/16 hours/);
    // a moved clock-out that fits is fine
    expect((await edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [outId], events: [{ type: "clock_out", at: iso(5 * HOUR) }], reason: "Moved it an hour later than recorded" })).ok).toBe(true);
    expect(await failure(edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [outId], events: [], reason: "Remove it a second time" }))).toMatch(/already removed/);
    expect((await edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [], events: [], reason: "Nothing at all to change" })).ok).toBe(false);
    expect((await edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [], events: [{ type: "clock_out", at: iso(HOUR / 2) }], reason: "ok" })).ok).toBe(false); // reason too short
  });
});

describe("who may change time", () => {
  it("nobody changes their own, including HR; an ordinary employee cannot", async () => {
    const hrPerson = await person("hrself", ["hr_admin", "employee"]);
    const e = await event(hrPerson.employeeId, "clock_in", iso(3 * HOUR));
    as(hrPerson.user);
    const own = await edit.editAttendance({ employeeId: hrPerson.employeeId, voidEventIds: [], events: [{ type: "clock_out", at: iso(HOUR) }], reason: "Closing my own session" });
    expect(own).toEqual({ ok: false, error: "Someone else must change your own time. Ask HR or your lead." });
    expect(e).toBeTruthy();
    // another HR admin can
    as(hr2);
    expect((await edit.editAttendance({ employeeId: hrPerson.employeeId, voidEventIds: [], events: [{ type: "clock_out", at: iso(HOUR) }], reason: "Closing their session for them" })).ok).toBe(true);

    const worker = await person("Plain");
    as(stranger);
    expect(await edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [], events: [{ type: "clock_in", at: iso(HOUR) }], reason: "Trying to change someone's time" })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await edit.loadEditableDay({ employeeId: worker.employeeId, date: new Date().toISOString().slice(0, 10) })).toEqual({ ok: false, error: NO_ACCESS });
  });

  it("a lead's change for their team is only a proposal until HR approves it, and a lead cannot decide it", async () => {
    const worker = await person("Team", ["employee"], { managerId: leadEmployeeId });
    const inId = await event(worker.employeeId, "clock_in", iso(20 * HOUR));
    const wrongOut = await event(worker.employeeId, "clock_out", iso(10 * HOUR));
    await rebuild(worker.employeeId);

    as(lead);
    const proposed = await edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [wrongOut], events: [{ type: "clock_out", at: iso(16 * HOUR) }], reason: "She stopped four hours in, the clock ran on" });
    expect(proposed).toEqual({ ok: true, data: { applied: false } });
    // nothing changed yet
    expect(await effectiveTypes(worker.employeeId)).toEqual(["clock_in", "clock_out"]);
    expect((await rows(sql`select 1 from time.clock_event_voids where event_id = ${wrongOut}`)).length).toBe(0);
    const [pending] = await rows<{ id: string; status: string; void_event_ids: string[] }>(sql`select id, status, void_event_ids from time.clock_corrections where employee_id = ${worker.employeeId}`);
    expect(pending).toMatchObject({ status: "pending", void_event_ids: [wrongOut] });
    expect((await rows(sql`select 1 from ops.notifications where user_id = ${hr.id} and kind = 'attendance.correction_needed'`)).length).toBeGreaterThan(0);

    // HR sees what would be removed, the lead cannot decide it, HR can
    as(hr);
    const queue = await queries.listCorrectionQueue();
    expect(queue.items.find((i) => i.id === pending.id)?.removes.map((r) => r.type)).toEqual(["clock_out"]);
    as(lead);
    expect((await actions.decideCorrection({ correctionId: pending.id, decision: "approve" })).ok).toBe(false);
    as(hr);
    expect((await actions.decideCorrection({ correctionId: pending.id, decision: "approve" })).ok).toBe(true);
    expect(await effectiveTypes(worker.employeeId)).toEqual(["clock_in", "clock_out"]);
    expect((await rows(sql`select 1 from time.clock_event_voids where event_id = ${wrongOut} and correction_id = ${pending.id}`)).length).toBe(1);
    expect((await dayRow(worker.employeeId, 20 * HOUR)).worked_minutes).toBe(240); // rebuilt at once, not at the next nightly run
    expect(inId).toBeTruthy();
  });

  it("a lead cannot change someone outside their team", async () => {
    const outsider = await person("Outside");
    await event(outsider.employeeId, "clock_in", iso(3 * HOUR));
    as(lead);
    expect(await edit.editAttendance({ employeeId: outsider.employeeId, voidEventIds: [], events: [{ type: "clock_out", at: iso(HOUR) }], reason: "Not on my team at all" })).toEqual({ ok: false, error: NO_ACCESS });
  });
});

describe("the record cannot be rewritten", () => {
  it("refuses to update or delete a void, and to delete or edit the event it marks", async () => {
    const worker = await person("Evidence");
    await event(worker.employeeId, "clock_in", iso(5 * HOUR));
    const out = await event(worker.employeeId, "clock_out", iso(3 * HOUR));
    as(hr);
    expect((await edit.editAttendance({ employeeId: worker.employeeId, voidEventIds: [out], events: [], reason: "Marked removed for the test" })).ok).toBe(true);
    await expect(db.execute(sql`delete from time.clock_event_voids where event_id = ${out}`)).rejects.toThrow();
    await expect(db.execute(sql`update time.clock_event_voids set reason = 'changed' where event_id = ${out}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from time.clock_events where id = ${out}`)).rejects.toThrow();
    await expect(db.execute(sql`update time.clock_events set type = 'clock_in' where id = ${out}`)).rejects.toThrow();
  });
});
