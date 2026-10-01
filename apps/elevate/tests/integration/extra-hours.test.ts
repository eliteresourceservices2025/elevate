import { randomUUID } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PNG_BYTES } from "./fake-storage";

// Real-database tests for extra hours (Phase 2.5, part B): asking (VA) and filing (client asked), the decision rules, what
// approved time does to the day's labels, the missed clock-out, reminders and the weekly notice.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { formatInZone } = await import("@/lib/time");
const actions = await import("@/modules/attendance/extra-hours-actions");
const queries = await import("@/modules/attendance/extra-hours-queries");
const attendanceQueries = await import("@/modules/attendance/queries");
const attendanceActions = await import("@/modules/attendance/actions");
const jobs = await import("@/modules/attendance/jobs");
const { setDocumentStorage } = await import("@/modules/documents/storage");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
const PHX = "America/Phoenix";
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const fake = new FakeStorage();
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const notes = (userId: string, kind: string) => rows(sql`select 1 from ops.notifications where user_id = ${userId} and kind = ${kind}`);

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
async function person(label: string, opts: { managerId?: string; roles?: RoleSlug[]; clientId?: string } = {}) {
  const user = await makeUser(label, opts.roles ?? ["employee"]);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id)
    values (${label}, ${uniq(label)}, ${user.email}, 'active', ${user.id}, ${opts.managerId ?? null}) returning id`);
  if (opts.clientId) await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${e.id}, ${opts.clientId}, current_date - 30)`);
  return { user, employeeId: e.id };
}
const newClient = async (name = uniq("Client ")) => (await rows<{ id: string }>(sql`insert into core.clients (name, time_zone) values (${name}, 'America/New_York') returning id`))[0].id;

/** A lead, a VA under them, and a client the VA is assigned to. */
async function setup(label = "X") {
  const clientId = await newClient();
  const lead = await person(`${label}Lead`, { roles: ["team_lead", "employee"] });
  const va = await person(`${label}Va`, { managerId: lead.employeeId, clientId });
  return { clientId, lead, va };
}

async function upload(bytes = PNG_BYTES, forEmployeeId?: string) {
  const ticket = await actions.requestExtraEvidenceUpload({ mime: "image/png", size: bytes.length, employeeId: forEmployeeId });
  if (!ticket.ok) throw new Error(ticket.error);
  fake.put("employee-docs", ticket.data.path, bytes);
  return ticket.data;
}
const window = (fromNow: number, lengthMs = 2 * HOUR) => ({ windowStart: iso(fromNow), windowEnd: iso(fromNow + lengthMs) });

async function ask(va: { user: TestUser }, clientId: string, w = window(2 * HOUR), extra: Record<string, unknown> = {}) {
  as(va.user);
  const shot = await upload();
  return actions.requestExtraHours({ clientId, ...w, contactName: "Dana Reyes", reason: "Client needs the report finished", evidenceIds: [shot.id], ...extra });
}
const latest = async (employeeId: string) => (await rows<{ id: string; status: string; minutes: number; after_the_fact: boolean; source: string; decided_by: string | null; original_window_start: Date | null }>(sql`select id, status, minutes, after_the_fact, source, decided_by, original_window_start from time.extra_hours_requests where employee_id = ${employeeId} order by created_at desc limit 1`))[0];

let hr: TestUser;
beforeAll(async () => {
  setDocumentStorage(fake);
  hr = await makeUser("hr", ["hr_admin", "employee"]);
});

describe("a VA asks to work extra hours", () => {
  it("sends a request with the client's approval as proof to the lead, and audits it", async () => {
    const { clientId, lead, va } = await setup("Ask");
    expect(await ask(va, clientId)).toEqual({ ok: true, data: { warning: null } });
    const r = await latest(va.employeeId);
    expect(r).toMatchObject({ status: "pending_lead", minutes: 120, after_the_fact: false, source: "va" });
    expect(await notes(lead.user.id, "extrahours.requested")).toHaveLength(1);
    expect(await rows(sql`select 1 from time.correction_evidence where extra_request_id = ${r.id}`)).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'extra_hours.request' and target_id = ${va.employeeId}`)).toHaveLength(1);
    as(va.user);
    const mine = await queries.getMyExtraHours();
    expect(mine?.clients.map((c) => c.id)).toEqual([clientId]);
    expect(mine?.items[0]).toMatchObject({ status: "pending_lead", clientName: expect.any(String), canCancel: true, canDecide: false });
  });

  it("needs a screenshot, a client the VA is assigned to, and a sensible window", async () => {
    const { clientId, va } = await setup("Rules");
    as(va.user);
    const w = window(2 * HOUR);
    const base = { clientId, ...w, contactName: "Dana", reason: "Client needs the report" };
    expect((await actions.requestExtraHours({ ...base, evidenceIds: [] })).ok).toBe(false);
    const other = await newClient();
    expect(await ask(va, other)).toEqual({ ok: false, error: "You are not assigned to that client. Ask HR." });
    expect(await ask(va, clientId, window(2 * HOUR, 10 * MIN))).toEqual({ ok: false, error: "Ask for at least 15 minutes." });
    expect((await ask(va, clientId, window(2 * HOUR, 5 * HOUR))).ok).toBe(false); // over 4 hours
    expect((await ask(va, clientId, { windowStart: iso(2 * HOUR), windowEnd: iso(HOUR) })).ok).toBe(false);
    expect((await ask(va, clientId, window(45 * DAY))).ok).toBe(false);
    expect((await ask(va, clientId, window(-40 * DAY))).ok).toBe(false);
    expect(await rows(sql`select 1 from time.extra_hours_requests where employee_id = ${va.employeeId}`)).toHaveLength(0);
  });

  it("counts what is already asked for toward the 4 hour day, refuses an overlap, and lets a cancelled one go", async () => {
    const { clientId, va } = await setup("Cap");
    expect((await ask(va, clientId, window(30 * HOUR, 3 * HOUR))).ok).toBe(true);
    const more = await ask(va, clientId, window(34 * HOUR, 2 * HOUR)); // 3h + 2h on the same day
    expect(more.ok).toBe(false);
    expect(!more.ok && more.error).toContain("more than 4 hours");
    expect(await ask(va, clientId, window(31 * HOUR, HOUR))).toEqual({ ok: false, error: "There are already extra hours asked for or approved in part of that time." });
    const first = await latest(va.employeeId);
    expect((await actions.cancelExtraHours({ requestId: first.id })).ok).toBe(true);
    expect((await ask(va, clientId, window(31 * HOUR, HOUR))).ok).toBe(true); // the cancelled one no longer blocks
  });

  it("marks a window that has already started as after the fact, and warns when the day gets very long", async () => {
    const { clientId, va } = await setup("After");
    expect((await ask(va, clientId, window(-3 * HOUR, 2 * HOUR))).ok).toBe(true);
    expect((await latest(va.employeeId)).after_the_fact).toBe(true);
    const long = await setup("Long");
    await db.execute(sql`update time.clock_rules set max_day_minutes = 60 where false`);
    const team = await rows<{ id: string }>(sql`insert into core.departments (name) values (${uniq("D ")}) returning id`);
    const [t] = await rows<{ id: string }>(sql`insert into core.teams (department_id, name) values (${team[0].id}, ${uniq("T ")}) returning id`);
    await db.execute(sql`update core.employees set team_id = ${t.id} where id = ${long.va.employeeId}`);
    await db.execute(sql`insert into time.clock_rules (team_id, max_day_minutes) values (${t.id}, 100)`);
    const result = await ask(long.va, long.clientId, window(20 * HOUR, 2 * HOUR));
    expect(result.ok && result.data.warning).toContain("long day");
  });

  it("goes to HR when there is no lead, and not to the VA themselves", async () => {
    const clientId = await newClient();
    const solo = await person("AskSolo", { clientId });
    expect((await ask(solo, clientId)).ok).toBe(true);
    expect((await notes(hr.id, "extrahours.requested")).length).toBeGreaterThanOrEqual(1);
    expect(await notes(solo.user.id, "extrahours.requested")).toHaveLength(0);
  });
});

describe("deciding a request", () => {
  it("lets the lead approve (the person is told), and counts the time", async () => {
    const { clientId, lead, va } = await setup("Dec");
    await ask(va, clientId);
    const r = await latest(va.employeeId);
    as(lead.user);
    const queue = await queries.listExtraHoursQueue();
    expect(queue.pending.find((i) => i.id === r.id)).toMatchObject({ canDecide: true, hrOnly: false, evidence: [expect.objectContaining({ mime: "image/png" })] });
    expect((await actions.decideExtraHours({ requestId: r.id, decision: "approve", note: "Go ahead" })).ok).toBe(true);
    expect(await latest(va.employeeId)).toMatchObject({ status: "approved", decided_by: lead.user.id });
    expect(await notes(va.user.id, "extrahours.approved")).toHaveLength(1);
    expect(await actions.decideExtraHours({ requestId: r.id, decision: "approve" })).toEqual({ ok: false, error: "That request was already handled." });
  });

  it("lets the reviewer change the window when approving, and keeps what was first asked", async () => {
    const { clientId, lead, va } = await setup("Adj");
    await ask(va, clientId, window(3 * HOUR, 3 * HOUR));
    const r = await latest(va.employeeId);
    as(lead.user);
    expect((await actions.decideExtraHours({ requestId: r.id, decision: "decline", note: "no", windowStart: iso(3 * HOUR), windowEnd: iso(4 * HOUR) })).ok).toBe(false); // only when approving
    expect((await actions.decideExtraHours({ requestId: r.id, decision: "approve", windowStart: iso(3 * HOUR) })).ok).toBe(false); // both ends
    expect((await actions.decideExtraHours({ requestId: r.id, decision: "approve", windowStart: iso(3 * HOUR), windowEnd: iso(3 * HOUR + 10 * MIN) })).ok).toBe(false); // too short
    expect((await actions.decideExtraHours({ requestId: r.id, decision: "approve", windowStart: iso(3 * HOUR), windowEnd: iso(4 * HOUR) })).ok).toBe(true);
    const after = await latest(va.employeeId);
    expect(after).toMatchObject({ status: "approved", minutes: 60 });
    expect(after.original_window_start).not.toBeNull();
    expect((await rows<{ title: string }>(sql`select title from ops.notifications where user_id = ${va.user.id} and kind = 'extrahours.approved'`))[0].title).toContain("changed time");
  });

  it("needs a reason to decline, and refuses the person themselves, the filer, and people outside the chain", async () => {
    const { clientId, lead, va } = await setup("Who");
    await ask(va, clientId);
    const r = await latest(va.employeeId);
    as(lead.user);
    expect(await actions.decideExtraHours({ requestId: r.id, decision: "decline" })).toEqual({ ok: false, error: "Give a short reason so the person knows why." });
    as(va.user);
    expect(await actions.decideExtraHours({ requestId: r.id, decision: "approve" })).toEqual({ ok: false, error: "Someone else must decide on your own request." });
    const outsider = await person("WhoOutsider", { roles: ["team_lead", "employee"] });
    for (const u of [outsider.user, await makeUser("WhoEmp", ["employee"]), await makeUser("WhoExec", ["executive"])]) {
      as(u);
      expect(await actions.decideExtraHours({ requestId: r.id, decision: "approve" })).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(lead.user);
    expect((await actions.decideExtraHours({ requestId: r.id, decision: "decline", note: "Not this week" })).ok).toBe(true);
    expect(await latest(va.employeeId)).toMatchObject({ status: "declined" });
    expect(await notes(va.user.id, "extrahours.declined")).toHaveLength(1);
  });

  it("sends an after-the-fact request more than 7 days old to HR only", async () => {
    const { clientId, lead, va } = await setup("Old");
    expect((await ask(va, clientId, window(-10 * DAY, 2 * HOUR))).ok).toBe(true);
    const r = await latest(va.employeeId);
    expect(await notes(lead.user.id, "extrahours.requested")).toHaveLength(0);
    as(lead.user);
    expect(await actions.decideExtraHours({ requestId: r.id, decision: "approve" })).toEqual({ ok: false, error: "Only HR can decide this request." });
    expect((await queries.listExtraHoursQueue()).pending.find((i) => i.id === r.id)).toMatchObject({ hrOnly: true, canDecide: false });
    as(hr);
    expect((await queries.listExtraHoursQueue()).pending.find((i) => i.id === r.id)?.canDecide).toBe(true);
    expect((await actions.decideExtraHours({ requestId: r.id, decision: "approve" })).ok).toBe(true);
  });

  it("lets only the person, their chain of leads and HR open the screenshot", async () => {
    const { clientId, lead, va } = await setup("Proof");
    await ask(va, clientId);
    const [ev] = await rows<{ id: string }>(sql`select id from time.correction_evidence where employee_id = ${va.employeeId} and extra_request_id is not null`);
    for (const u of [va.user, lead.user, hr]) {
      as(u);
      const link = await attendanceActions.openEvidence({ evidenceId: ev.id });
      expect(link.ok && link.data.url).toContain("expires=60");
    }
    as((await person("ProofOutsider", { roles: ["team_lead", "employee"] })).user);
    expect(await attendanceActions.openEvidence({ evidenceId: ev.id })).toEqual({ ok: false, error: NO_ACCESS });
  });
});

describe("extra hours the client asked for", () => {
  it("is filed by the lead, confirmed by the VA, and approved", async () => {
    const { clientId, lead, va } = await setup("File");
    as(lead.user);
    const shot = await upload(PNG_BYTES, va.employeeId);
    const body = { employeeId: va.employeeId, clientId, ...window(2 * HOUR), contactName: "Pat Cruz", reason: "Month-end close", evidenceIds: [shot.id] };
    expect((await actions.fileExtraHoursFor(body)).ok).toBe(true);
    const r = await latest(va.employeeId);
    expect(r).toMatchObject({ status: "pending_confirm", source: "client" });
    expect(await notes(va.user.id, "extrahours.confirm_needed")).toHaveLength(1);
    expect((await notes(hr.id, "extrahours.filed_for")).length).toBeGreaterThanOrEqual(1);

    as(va.user);
    const mine = await queries.getMyExtraHours();
    expect(mine?.items.find((i) => i.id === r.id)).toMatchObject({ needsMyAnswer: true, filedByName: expect.stringContaining("FileLead") });
    expect((await actions.answerExtraHours({ requestId: r.id, answer: "confirm" })).ok).toBe(true);
    expect(await latest(va.employeeId)).toMatchObject({ status: "approved", decided_by: lead.user.id });
    expect(await notes(lead.user.id, "extrahours.confirmed")).toHaveLength(1);
    expect(await actions.answerExtraHours({ requestId: r.id, answer: "decline" })).toEqual({ ok: false, error: "That request was already answered." });
  });

  it("can be declined by the VA, and needs proof or a phone confirmation", async () => {
    const { clientId, lead, va } = await setup("Decline");
    as(lead.user);
    const body = { employeeId: va.employeeId, clientId, ...window(5 * HOUR), contactName: "Pat Cruz", reason: "Urgent fix" };
    expect((await actions.fileExtraHoursFor({ ...body, evidenceIds: [] })).ok).toBe(false);
    expect((await actions.fileExtraHoursFor({ ...body, evidenceIds: [], confirmedByPhone: true })).ok).toBe(true);
    const r = await latest(va.employeeId);
    as(va.user);
    expect(await actions.answerExtraHours({ requestId: randomUUID(), answer: "confirm" })).toEqual({ ok: false, error: "That request was not found." });
    expect((await actions.answerExtraHours({ requestId: r.id, answer: "decline", note: "I have a conflict" })).ok).toBe(true);
    expect(await latest(va.employeeId)).toMatchObject({ status: "declined" });
    expect(await notes(lead.user.id, "extrahours.declined_by_va")).toHaveLength(1);
    // someone else's request cannot be answered
    as(lead.user);
    await actions.fileExtraHoursFor({ ...body, ...window(9 * HOUR), evidenceIds: [], confirmedByPhone: true });
    const r2 = await latest(va.employeeId);
    as((await person("DeclineOther")).user);
    expect(await actions.answerExtraHours({ requestId: r2.id, answer: "confirm" })).toEqual({ ok: false, error: "That request was not found." });
  });

  it("lets only a lead (their team) or HR file, never for themselves, and keeps uploads with whoever made them", async () => {
    const { clientId, lead, va } = await setup("Reach");
    const stranger = await person("ReachStranger", { clientId });
    const body = { employeeId: va.employeeId, clientId, ...window(2 * HOUR), contactName: "Pat Cruz", reason: "Month-end close", confirmedByPhone: true };
    for (const u of [await makeUser("ReachEmp", ["employee"]), await makeUser("ReachRec", ["recruiter"]), await makeUser("ReachExec", ["executive"])]) {
      as(u);
      expect(await actions.fileExtraHoursFor(body)).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(lead.user);
    expect(await actions.fileExtraHoursFor({ ...body, employeeId: stranger.employeeId })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await actions.fileExtraHoursFor({ ...body, employeeId: lead.employeeId })).toEqual({ ok: false, error: NO_ACCESS }); // not in their own downline
    const notAssigned = await newClient();
    expect(await actions.fileExtraHoursFor({ ...body, clientId: notAssigned })).toEqual({ ok: false, error: "They are not assigned to that client." });
    // A lead cannot upload for someone outside their team, and another person's upload cannot be attached
    await expect(upload(PNG_BYTES, stranger.employeeId)).rejects.toThrow();
    const shot = await upload(PNG_BYTES, va.employeeId);
    as(hr);
    expect((await actions.fileExtraHoursFor({ ...body, confirmedByPhone: false, evidenceIds: [shot.id] })).ok).toBe(false); // HR did not upload it
    as(lead.user);
    expect((await actions.fileExtraHoursFor({ ...body, confirmedByPhone: false, evidenceIds: [shot.id] })).ok).toBe(true);
    as(hr);
    expect((await actions.fileExtraHoursFor({ ...body, ...window(10 * HOUR), employeeId: stranger.employeeId })).ok).toBe(true); // HR can file for anyone
  });
});

describe("cancelling", () => {
  it("lets the person or the filer cancel a waiting request, and a lead or HR cancel an approved one that has not started", async () => {
    const { clientId, lead, va } = await setup("Cx");
    await ask(va, clientId, window(6 * HOUR));
    const r = await latest(va.employeeId);
    as((await person("CxPeer")).user);
    expect(await actions.cancelExtraHours({ requestId: r.id })).toEqual({ ok: false, error: NO_ACCESS });
    as(lead.user);
    await actions.decideExtraHours({ requestId: r.id, decision: "approve" });
    expect((await actions.cancelExtraHours({ requestId: r.id })).ok).toBe(true); // approved, not started
    expect(await latest(va.employeeId)).toMatchObject({ status: "cancelled" });
    expect(await actions.cancelExtraHours({ requestId: r.id })).toEqual({ ok: false, error: "That request can no longer be cancelled." });

    // Approved time that already started cannot be taken back
    await ask(va, clientId, window(-2 * HOUR, 5 * HOUR));
    const started = await latest(va.employeeId);
    as(hr);
    await actions.decideExtraHours({ requestId: started.id, decision: "approve" });
    expect(await actions.cancelExtraHours({ requestId: started.id })).toEqual({ ok: false, error: "That request can no longer be cancelled." });
  });
});

describe("what approved extra hours do to the day", () => {
  const yesterday = () => formatInZone(Date.now() - DAY, PHX, "yyyy-MM-dd");
  const at = (date: string, time: string) => fromZonedTime(`${date}T${time}:00`, PHX).toISOString();
  async function worked(label: string, approvedMinutes: number | null) {
    const clientId = await newClient();
    const p = await person(label, { clientId });
    const Y = yesterday();
    await db.execute(sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone) values (${p.employeeId}, current_date - 10, '09:00', '17:00', array[1,2,3,4,5,6,7]::smallint[], 60, ${PHX})`);
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_in', ${at(Y, "09:00")}), (${p.employeeId}, 'clock_out', ${at(Y, "19:00")})`); // 10h worked, 7h scheduled: 3h extra
    if (approvedMinutes !== null) {
      await db.execute(sql`insert into time.extra_hours_requests (employee_id, client_id, source, status, window_start, window_end, minutes, contact_name, reason, filed_by, decided_at)
        values (${p.employeeId}, ${clientId}, 'va', 'approved', ${at(Y, "17:00")}, ${at(Y, "17:00").replace(/.*/, () => new Date(Date.parse(at(Y, "17:00")) + approvedMinutes * MIN).toISOString())}, ${approvedMinutes}, 'Dana', 'Client work', ${p.user.id}, now())`);
    }
    await jobs.rebuildAttendanceDays();
    return { p, Y };
  }
  const day = async (employeeId: string, Y: string) => (await rows<{ extra_minutes: number; approved_extra_minutes: number; flags: string[] }>(sql`select extra_minutes, approved_extra_minutes, flags from time.attendance_days where employee_id = ${employeeId} and date = ${Y}::date`))[0];

  it("labels extra time covered by an approved request as approved, and the rest as unapproved", async () => {
    const partial = await worked("EffPartial", 120);
    expect(await day(partial.p.employeeId, partial.Y)).toMatchObject({ extra_minutes: 180, approved_extra_minutes: 120 });
    expect((await day(partial.p.employeeId, partial.Y)).flags).toEqual(expect.arrayContaining(["extra_hours", "unapproved_extra"]));

    const full = await worked("EffFull", 240);
    expect(await day(full.p.employeeId, full.Y)).toMatchObject({ extra_minutes: 180, approved_extra_minutes: 180 });
    expect((await day(full.p.employeeId, full.Y)).flags).toContain("extra_hours");
    expect((await day(full.p.employeeId, full.Y)).flags).not.toContain("unapproved_extra");

    const none = await worked("EffNone", null);
    expect(await day(none.p.employeeId, none.Y)).toMatchObject({ extra_minutes: 180, approved_extra_minutes: 0 });
    expect((await day(none.p.employeeId, none.Y)).flags).toContain("unapproved_extra");
  });

  it("shows the person approved and unapproved extra live in My time", async () => {
    const { p, Y } = await worked("EffLive", 60);
    as(p.user);
    const week = await attendanceQueries.getMyTime(Y);
    const d = week!.days.find((x) => x.date === Y)!;
    expect(d.extraMinutes).toBe(180);
    expect(d.approvedExtraMinutes).toBe(60);
  });
});

describe("a session left open past the shift with approved extra hours", () => {
  const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

  it("is not a missed clock-out while the approved window runs on from the shift, only after it", async () => {
    const clientId = await newClient();
    const lead = await person("MissLead", { roles: ["team_lead", "employee"] });
    const inside = await person("MissInside", { managerId: lead.employeeId, clientId });
    const after = await person("MissAfter", { managerId: lead.employeeId, clientId });
    const now = Date.now();
    for (const p of [inside, after]) {
      await db.execute(sql`insert into time.clock_prefs (employee_id, time_zone) values (${p.employeeId}, 'UTC')`);
      await db.execute(sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone)
        values (${p.employeeId}, current_date - 5, ${hhmm(now - 6 * HOUR)}, ${hhmm(now - 3 * HOUR)}, array[1,2,3,4,5,6,7]::smallint[], 0, 'UTC')`); // ended 3 hours ago
      await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_in', ${new Date(now - 6 * HOUR).toISOString()})`);
    }
    const approve = (p: typeof inside, from: number, to: number) =>
      db.execute(sql`insert into time.extra_hours_requests (employee_id, client_id, source, status, window_start, window_end, minutes, contact_name, reason, filed_by, decided_at)
        values (${p.employeeId}, ${clientId}, 'va', 'approved', ${new Date(from).toISOString()}, ${new Date(to).toISOString()}, ${Math.round((to - from) / MIN)}, 'Dana', 'Client work', ${p.user.id}, now())`);
    await approve(inside, now - 3 * HOUR, now + HOUR); // still running
    await approve(after, now - 3 * HOUR, now - 2 * HOUR); // ended 2 hours ago: past the shift end plus a 60 minute grace

    await jobs.runMissedClockouts(new Date(now));
    expect(await notes(inside.user.id, "attendance.missed_clockout")).toHaveLength(0);
    expect(await notes(after.user.id, "attendance.missed_clockout")).toHaveLength(1);
  });

  it("tells the header when the shift ends and which approved windows are around", async () => {
    const clientId = await newClient();
    const p = await person("StatusP", { clientId });
    const now = Date.now();
    await db.execute(sql`insert into time.clock_prefs (employee_id, time_zone) values (${p.employeeId}, 'UTC')`);
    await db.execute(sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone)
      values (${p.employeeId}, current_date - 5, ${hhmm(now - 2 * HOUR)}, ${hhmm(now + 2 * HOUR)}, array[1,2,3,4,5,6,7]::smallint[], 0, 'UTC')`);
    await db.execute(sql`insert into time.extra_hours_requests (employee_id, client_id, source, status, window_start, window_end, minutes, contact_name, reason, filed_by, decided_at)
      values (${p.employeeId}, ${clientId}, 'va', 'approved', ${new Date(now + 2 * HOUR).toISOString()}, ${new Date(now + 4 * HOUR).toISOString()}, 120, 'Dana', 'Client work', ${p.user.id}, now())`);
    as(p.user);
    const status = await attendanceQueries.getClockStatus();
    expect(Math.abs(status!.shiftEndMs! - (now + 2 * HOUR))).toBeLessThan(2 * MIN);
    expect(status!.extraWindows).toHaveLength(1);
    expect(Math.abs(status!.extraWindows[0].startMs - (now + 2 * HOUR))).toBeLessThan(2 * MIN);
  });
});

describe("reminders and the weekly notice", () => {
  it("nudges a request still waiting when its window is about to start, once, and leaves later ones alone", async () => {
    const { clientId, lead, va } = await setup("Rem");
    await ask(va, clientId, window(HOUR));
    const soon = await latest(va.employeeId);
    const later = await setup("RemLater");
    await ask(later.va, later.clientId, window(5 * HOUR));

    const run = await jobs.runExtraHoursReminders();
    expect(run.reminded).toBeGreaterThanOrEqual(1);
    expect(await notes(lead.user.id, "extrahours.reminder")).toHaveLength(1);
    expect((await notes(hr.id, "extrahours.reminder")).length).toBeGreaterThanOrEqual(1);
    expect(await notes(later.lead.user.id, "extrahours.reminder")).toHaveLength(0);
    expect((await rows<{ reminded_at: Date | null }>(sql`select reminded_at from time.extra_hours_requests where id = ${soon.id}`))[0].reminded_at).not.toBeNull();
    await jobs.runExtraHoursReminders();
    expect(await notes(lead.user.id, "extrahours.reminder")).toHaveLength(1); // once

    // A client's request waiting for the VA nudges the VA and the filer
    as(lead.user);
    await actions.fileExtraHoursFor({ employeeId: va.employeeId, clientId, ...window(12 * HOUR, HOUR), contactName: "Pat Cruz", reason: "Urgent", confirmedByPhone: true });
    await db.execute(sql`update time.extra_hours_requests set status = 'cancelled' where id = ${soon.id}`); // so the moved window does not overlap it
    await db.execute(sql`update time.extra_hours_requests set window_start = now() + interval '30 minutes', window_end = now() + interval '90 minutes' where employee_id = ${va.employeeId} and status = 'pending_confirm'`);
    await jobs.runExtraHoursReminders();
    expect(await notes(va.user.id, "extrahours.reminder")).toHaveLength(1);
    expect((await notes(lead.user.id, "extrahours.reminder")).length).toBe(2);
  });

  it("tells HR last week's approved extra hours per client, and nothing when there were none", async () => {
    await db.execute(sql`delete from ops.notifications where kind = 'extrahours.weekly'`);
    const none = await jobs.runWeeklyExtraHoursNotice(new Date(Date.UTC(2020, 0, 6, 1, 0, 0)));
    expect(none.clients).toBe(0);
    expect(await notes(hr.id, "extrahours.weekly")).toHaveLength(0);

    const clientA = await newClient("Weekly Client A");
    const clientB = await newClient("Weekly Client B");
    const a = await person("WeeklyA", { clientId: clientA });
    // A Monday 8:00 AM in Manila, with the requests inside the week before it
    const monday = new Date(Date.UTC(2021, 2, 8, 0, 0, 0)); // 2021-03-08 08:00 Manila
    const insert = (employeeId: string, clientId: string, start: string, minutes: number, status = "approved") =>
      db.execute(sql`insert into time.extra_hours_requests (employee_id, client_id, source, status, window_start, window_end, minutes, contact_name, reason, filed_by)
        values (${employeeId}, ${clientId}, 'va', ${status}, ${start}::timestamptz, ${start}::timestamptz + (${minutes} * interval '1 minute'), ${minutes}, 'Dana', 'Work', ${a.user.id})`);
    await insert(a.employeeId, clientA, "2021-03-03T02:00:00Z", 150);
    await insert(a.employeeId, clientB, "2021-03-04T02:00:00Z", 60);
    await insert(a.employeeId, clientA, "2021-03-05T02:00:00Z", 60, "declined"); // not counted
    await insert(a.employeeId, clientA, "2021-03-10T02:00:00Z", 60); // the week after: not counted
    const run = await jobs.runWeeklyExtraHoursNotice(monday);
    expect(run.clients).toBe(2);
    const [n] = await rows<{ body: string; title: string }>(sql`select body, title from ops.notifications where user_id = ${hr.id} and kind = 'extrahours.weekly'`);
    expect(n.body).toContain("Weekly Client A 2h 30m");
    expect(n.body).toContain("Weekly Client B 1h");
    expect(n.title).toContain("2021-03-01");
  });
});

describe("two live requests cannot overlap", () => {
  it("is enforced by the database itself", async () => {
    const clientId = await newClient();
    const p = await person("Overlap", { clientId });
    const insert = (from: number, to: number, status: string) =>
      db.execute(sql`insert into time.extra_hours_requests (employee_id, client_id, source, status, window_start, window_end, minutes, contact_name, reason, filed_by)
        values (${p.employeeId}, ${clientId}, 'va', ${status}, ${iso(from)}, ${iso(to)}, 60, 'Dana', 'Work', ${p.user.id})`);
    await insert(50 * HOUR, 52 * HOUR, "pending_lead");
    await expect(insert(51 * HOUR, 53 * HOUR, "approved")).rejects.toThrow();
    await insert(51 * HOUR, 53 * HOUR, "cancelled"); // a cancelled one does not count
    await insert(52 * HOUR, 54 * HOUR, "approved"); // touching is fine
  });
});
