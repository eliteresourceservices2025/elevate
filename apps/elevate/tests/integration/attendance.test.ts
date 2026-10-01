import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PDF_BYTES, PNG_BYTES } from "./fake-storage";

// Real-database tests for the time clock (Phase 2.3): state rules, append-only events, IP flags, location, selfies,
// leave blocking, corrections, the nightly rebuild, missed clock-outs and who can see whom.

const current = vi.hoisted(() => ({ user: null as unknown, ip: "198.51.100.10" }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": `${current.ip}, 10.0.0.1` }) }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/attendance/actions");
const queries = await import("@/modules/attendance/queries");
const jobs = await import("@/modules/attendance/jobs");
const peopleActions = await import("@/modules/people/actions");
const { setDocumentStorage } = await import("@/modules/documents/storage");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const HOUR = 3_600_000;
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();
const fake = new FakeStorage();

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

async function makeTeam() {
  const [d] = await rows<{ id: string }>(sql`insert into core.departments (name) values (${uniq("Dept ")}) returning id`);
  const [t] = await rows<{ id: string }>(sql`insert into core.teams (department_id, name) values (${d.id}, ${uniq("Team ")}) returning id`);
  return t.id;
}

async function person(label: string, roles: RoleSlug[] = ["employee"], opts: { managerId?: string; teamId?: string } = {}) {
  const user = await makeUser(label, roles);
  const n = uniq(label);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, team_id)
    values (${label}, ${n}, ${user.email}, 'active', ${user.id}, ${opts.managerId ?? null}, ${opts.teamId ?? null}) returning id`);
  return { user, employeeId: e.id };
}

/** Writes a clock event directly with a chosen time (the clock itself only ever uses the database clock). */
async function event(employeeId: string, type: string, at: string, extra: { outside?: boolean; planned?: number } = {}) {
  await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, outside_allowed_range, planned_break_minutes) values (${employeeId}, ${type}, ${at}, ${extra.outside ?? false}, ${extra.planned ?? null})`);
}

const stateOf = async (employeeId: string) => {
  const [r] = await rows<{ type: string }>(sql`select type from time.clock_events where employee_id = ${employeeId} order by occurred_at desc, created_at desc limit 1`);
  return r?.type ?? null;
};
const notes = (userId: string, kind: string) => rows(sql`select 1 from ops.notifications where user_id = ${userId} and kind = ${kind}`);

/** Publishes the monitoring policy for the location and selfie tests (as a second version, so version 1's placeholder stays), and withdraws it after. */
async function withMonitoring<T>(fn: () => Promise<T>): Promise<T> {
  const [p] = await rows<{ id: string }>(sql`select id from docs.policies where kind = 'monitoring'`);
  await db.execute(sql`update docs.policies set archived_at = null where id = ${p.id}`);
  await db.execute(sql`
    insert into docs.policy_versions (policy_id, version, body, status, requires_ack, published_by, published_at)
    select ${p.id}, coalesce(max(version), 0) + 1, 'Test monitoring policy', 'published', true, ${randomUUID()}, now() from docs.policy_versions where policy_id = ${p.id}`);
  try {
    return await fn();
  } finally {
    await db.execute(sql`update docs.policies set archived_at = now() where id = ${p.id}`);
  }
}

let hr: TestUser;
beforeAll(async () => {
  setDocumentStorage(fake);
  ({ user: hr } = await person("hr", ["hr_admin", "employee"]));
});

describe("clocking in and out", () => {
  it("follows the state rules, takes the time and IP from the server, deducts breaks, and audits each step", async () => {
    const ana = await person("Ana");
    as(ana.user);
    current.ip = "203.0.113.7";

    expect(await actions.clockOut()).toEqual({ ok: false, error: "You are not clocked in." });
    expect(await actions.startBreak()).toEqual({ ok: false, error: "Clock in before starting a break." });
    expect(await actions.endBreak()).toEqual({ ok: false, error: "You are not on a break." });

    // Nothing the browser sends can set the time or the address
    const result = await actions.clockIn({ occurredAt: "2001-01-01T00:00:00Z", ip: "1.1.1.1" });
    expect(result.ok).toBe(true);
    const [e] = await rows<{ type: string; ip: string; source: string; seconds_ago: number }>(sql`select type, ip, source, extract(epoch from now() - occurred_at)::float8 as seconds_ago from time.clock_events where employee_id = ${ana.employeeId}`);
    expect(e).toMatchObject({ type: "clock_in", ip: "203.0.113.7", source: "web" }); // first address of x-forwarded-for
    expect(e.seconds_ago).toBeGreaterThanOrEqual(0);
    expect(e.seconds_ago).toBeLessThan(30);

    expect(await actions.clockIn({})).toEqual({ ok: false, error: "You are already clocked in." });
    expect((await actions.startBreak()).ok).toBe(true);
    expect(await actions.startBreak()).toEqual({ ok: false, error: "You are already on a break." });
    expect(await actions.clockIn({})).toEqual({ ok: false, error: "You are already clocked in, on a break." });
    expect((await queries.getClockStatus())?.state).toBe("break");

    // Clocking out while on a break ends the break first
    const out = await actions.clockOut();
    expect(out.ok).toBe(true);
    const sequence = (await rows<{ type: string }>(sql`select type from time.clock_events where employee_id = ${ana.employeeId} order by occurred_at, created_at`)).map((r) => r.type);
    expect(sequence).toEqual(["clock_in", "break_start", "break_end", "clock_out"]);
    expect((await queries.getClockStatus())?.state).toBe("out");
    expect(await rows(sql`select 1 from ops.audit_log where action like 'clock.%' and target_id = ${ana.employeeId}`)).toHaveLength(3); // one per successful action
  });

  it("lets only one of two simultaneous clock-ins through", async () => {
    const bea = await person("Bea");
    as(bea.user);
    const results = await Promise.all([actions.clockIn({}), actions.clockIn({})]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await rows(sql`select 1 from time.clock_events where employee_id = ${bea.employeeId} and type = 'clock_in'`)).toHaveLength(1);
  });

  it("refuses a clock-in on approved full-day leave, but not on a half day", async () => {
    const cal = await person("Cal");
    const [type] = await rows<{ id: string }>(sql`select id from time.leave_types where slug = 'unpaid_day'`);
    const request = (half: boolean) =>
      db.execute(sql`insert into time.leave_requests (employee_id, leave_type_id, start_date, end_date, half_day, days, status, filed_by, step_started_on)
        values (${cal.employeeId}, ${type.id}, current_date - 1, current_date + 1, ${half}, ${half ? 0.5 : 3}, 'approved', ${cal.user.id}, current_date)`);
    // The company day and the person's day can differ by one; a three-day window covers either
    await request(false);
    as(cal.user);
    expect(await actions.clockIn({})).toEqual({ ok: false, error: "You are on approved leave today, so you cannot clock in." });
    expect(await stateOf(cal.employeeId)).toBeNull();

    const dan = await person("Dan");
    await db.execute(sql`insert into time.leave_requests (employee_id, leave_type_id, start_date, end_date, half_day, days, status, filed_by, step_started_on)
      values (${dan.employeeId}, ${type.id}, current_date, current_date, true, 0.5, 'approved', ${dan.user.id}, current_date)`);
    as(dan.user);
    expect((await actions.clockIn({})).ok).toBe(true);
  });

  it("needs a people record", async () => {
    as(await makeUser("noprofile", ["employee"]));
    expect(await actions.clockIn({})).toEqual({ ok: false, error: "Your people record is not set up yet. Ask HR." });
    expect(await queries.getClockStatus()).toBeNull();
  });
});

describe("the events are evidence", () => {
  it("cannot be edited, deleted or truncated, and a correction row must carry its reason", async () => {
    const eve = await person("Eve");
    await event(eve.employeeId, "clock_in", iso(HOUR));
    await expect(db.execute(sql`update time.clock_events set type = 'clock_out' where employee_id = ${eve.employeeId}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from time.clock_events where employee_id = ${eve.employeeId}`)).rejects.toThrow();
    await expect(db.execute(sql`truncate time.clock_events`)).rejects.toThrow();
    await expect(db.execute(sql`insert into time.clock_events (employee_id, type, source) values (${eve.employeeId}, 'clock_out', 'admin_correction')`)).rejects.toThrow();
    await expect(db.execute(sql`insert into time.clock_events (employee_id, type, approx_lat) values (${eve.employeeId}, 'clock_in', 14.6)`)).rejects.toThrow(); // location comes as a pair
  });
});

describe("IP ranges, location and selfies", () => {
  it("flags a clock-in from outside the team's ranges, never blocks it, and ignores teams without rules", async () => {
    const team = await makeTeam();
    const noRules = await makeTeam();
    const inside = await person("Inside", ["employee"], { teamId: team });
    const outside = await person("Outside", ["employee"], { teamId: team });
    const free = await person("Free", ["employee"], { teamId: noRules });
    as(hr);
    expect((await actions.saveClockRules({ teamId: team, allowedCidrs: ["203.0.113.0/24", "203.0.113.0/24"], selfieRequired: false, idleMinutes: 20, graceMinutes: 45 })).ok).toBe(true);
    expect((await rows<{ allowed_cidrs: string[] }>(sql`select allowed_cidrs from time.clock_rules where team_id = ${team}`))[0].allowed_cidrs).toEqual(["203.0.113.0/24"]); // duplicates dropped

    const flagged = async (p: typeof inside, ip: string) => {
      current.ip = ip;
      as(p.user);
      expect((await actions.clockIn({})).ok).toBe(true);
      return (await rows<{ outside_allowed_range: boolean }>(sql`select outside_allowed_range from time.clock_events where employee_id = ${p.employeeId}`))[0].outside_allowed_range;
    };
    expect(await flagged(inside, "203.0.113.99")).toBe(false);
    expect(await flagged(outside, "198.51.100.5")).toBe(true);
    expect(await flagged(free, "198.51.100.5")).toBe(false);

    // Bad rules are refused
    as(hr);
    expect((await actions.saveClockRules({ teamId: team, allowedCidrs: ["not-an-ip"], selfieRequired: false, idleMinutes: 20, graceMinutes: 45 })).ok).toBe(false);
    expect((await actions.saveClockRules({ teamId: randomUUID(), allowedCidrs: [], selfieRequired: false, idleMinutes: 20, graceMinutes: 45 })).ok).toBe(false);
    const lead = await person("RulesLead", ["team_lead", "employee"]);
    as(lead.user);
    expect(await actions.saveClockRules({ teamId: team, allowedCidrs: [], selfieRequired: false, idleMinutes: 20, graceMinutes: 45 })).toEqual({ ok: false, error: NO_ACCESS });
    expect(await rows(sql`select 1 from ops.audit_log where action = 'clock.rules' and target_id = ${team}`)).toHaveLength(1);
  });

  it("records an approximate location only with the person's opt-in and a published monitoring policy, rounded to about 1 km", async () => {
    const fay = await person("Fay");
    const stored = async () => (await rows<{ approx_lat: string | null; approx_lng: string | null }>(sql`select approx_lat, approx_lng from time.clock_events where employee_id = ${fay.employeeId} and type = 'clock_in' order by created_at desc limit 1`))[0];

    as(fay.user);
    // Not available before the policy exists
    expect(await actions.savePreferences({ shareLocation: true })).toEqual({ ok: false, error: "Location is not available yet. It turns on once the monitoring policy is published." });
    expect((await actions.clockIn({ latitude: 14.599512, longitude: 120.984222 })).ok).toBe(true);
    expect(await stored()).toEqual({ approx_lat: null, approx_lng: null });
    await actions.clockOut();

    await withMonitoring(async () => {
      // Policy published but the person has not opted in: still nothing stored
      expect((await actions.clockIn({ latitude: 14.599512, longitude: 120.984222 })).ok).toBe(true);
      expect(await stored()).toEqual({ approx_lat: null, approx_lng: null });
      await actions.clockOut();

      expect((await actions.savePreferences({ shareLocation: true })).ok).toBe(true);
      expect((await queries.getClockStatus())?.locationOn).toBe(true);
      expect((await actions.clockIn({ latitude: 14.599512, longitude: 120.984222 })).ok).toBe(true);
      expect(await stored()).toEqual({ approx_lat: "14.60", approx_lng: "120.98" });
      await actions.clockOut();
      // A nonsense position is dropped, not stored
      expect((await actions.clockIn({ latitude: 14.6 })).ok).toBe(true);
      expect(await stored()).toEqual({ approx_lat: null, approx_lng: null });
    });
  });

  it("requires a valid selfie where the team asks for one, and deletes it after 30 days", async () => {
    const team = await makeTeam();
    const gus = await person("Gus", ["employee"], { teamId: team });
    const hal = await person("Hal", ["employee"], { teamId: team });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]);

    // The rule needs the monitoring policy
    as(hr);
    expect(await actions.saveClockRules({ teamId: team, allowedCidrs: [], selfieRequired: true, idleMinutes: 30, graceMinutes: 60 })).toEqual({ ok: false, error: "Publish the monitoring policy before requiring selfies." });

    await withMonitoring(async () => {
      expect((await actions.saveClockRules({ teamId: team, allowedCidrs: [], selfieRequired: true, idleMinutes: 30, graceMinutes: 60 })).ok).toBe(true);
      as(gus.user);
      expect((await queries.getClockStatus())?.needsSelfie).toBe(true);
      expect(await actions.clockIn({})).toEqual({ ok: false, error: "Your team requires a selfie to clock in." });

      const ticket = await actions.requestClockSelfie();
      if (!ticket.ok) throw new Error(ticket.error);
      expect(ticket.data.path.startsWith(`selfies/${gus.employeeId}/`)).toBe(true);
      fake.put("employee-docs", ticket.data.path, jpeg);
      expect((await actions.clockIn({ selfiePath: ticket.data.path })).ok).toBe(true);
      expect(await rows(sql`select 1 from time.clock_selfies where employee_id = ${gus.employeeId} and purged_at is null`)).toHaveLength(1);
      await actions.clockOut();

      // Someone else's selfie, a made-up path, and a file that is not a JPEG are all refused
      as(hal.user);
      expect((await actions.clockIn({ selfiePath: ticket.data.path })).ok).toBe(false);
      expect((await actions.clockIn({ selfiePath: `selfies/${hal.employeeId}/${randomUUID()}.jpg` })).ok).toBe(false); // nothing was uploaded
      const bad = await actions.requestClockSelfie();
      if (!bad.ok) throw new Error(bad.error);
      fake.put("employee-docs", bad.data.path, PDF_BYTES);
      expect(await actions.clockIn({ selfiePath: bad.data.path })).toEqual({ ok: false, error: "The selfie could not be used. Take it again." });
      expect(fake.objects.has(fake.key("employee-docs", bad.data.path))).toBe(false); // and it is deleted
      expect(await stateOf(hal.employeeId)).toBeNull();

      // After 30 days the file goes and the row stays
      await db.execute(sql`update time.clock_selfies set taken_at = now() - interval '31 days' where employee_id = ${gus.employeeId}`);
      const run = await jobs.purgeSelfies();
      expect(run.purged).toBeGreaterThanOrEqual(1);
      expect(fake.objects.has(fake.key("employee-docs", ticket.data.path))).toBe(false);
      expect(await rows(sql`select 1 from time.clock_selfies where employee_id = ${gus.employeeId} and purged_at is not null`)).toHaveLength(1);
      expect((await jobs.purgeSelfies()).purged).toBe(0);
    });
    // Without the policy no selfie is asked for any more
    as(gus.user);
    expect((await queries.getClockStatus())?.needsSelfie).toBe(false);
    expect((await actions.requestClockSelfie()).ok).toBe(false);
  });
});

describe("idle prompts", () => {
  it("records a prompt and its answer, and an unanswered one becomes a flag", async () => {
    const ivy = await person("Ivy");
    as(ivy.user);
    const shown = await actions.reportIdlePrompt({ source: "fallback" });
    if (!shown.ok) throw new Error(shown.error);
    expect((await actions.answerIdlePrompt({ promptId: shown.data.promptId })).ok).toBe(true);
    expect((await rows<{ answered_at: Date | null }>(sql`select answered_at from time.idle_prompts where id = ${shown.data.promptId}`))[0].answered_at).not.toBeNull();
    expect((await actions.reportIdlePrompt({ source: "nope" })).ok).toBe(false);

    // Nobody else can answer it
    const other = await person("IdleOther");
    as(other.user);
    await actions.answerIdlePrompt({ promptId: shown.data.promptId });
    as(ivy.user);
    const open = await actions.reportIdlePrompt({ source: "idle_api" });
    if (!open.ok) throw new Error(open.error);
    as(other.user);
    await actions.answerIdlePrompt({ promptId: open.data.promptId });
    expect((await rows<{ answered_at: Date | null }>(sql`select answered_at from time.idle_prompts where id = ${open.data.promptId}`))[0].answered_at).toBeNull();

    // A session with an unanswered prompt older than 10 minutes is flagged by the nightly rebuild
    await event(ivy.employeeId, "clock_in", iso(3 * HOUR));
    await event(ivy.employeeId, "clock_out", iso(HOUR));
    await db.execute(sql`update time.idle_prompts set prompted_at = now() - interval '2 hours' where id = ${open.data.promptId}`);
    await jobs.rebuildAttendanceDays();
    const [day] = await rows<{ flags: string[] }>(sql`select flags from time.attendance_days where employee_id = ${ivy.employeeId}`);
    expect(day.flags).toContain("idle_unanswered");
  });
});

describe("corrections", () => {
  async function setup() {
    const lead = await person("CorrLead", ["team_lead", "employee"]);
    const worker = await person("Worker", ["employee"], { managerId: lead.employeeId });
    return { lead, worker };
  }
  const propose = (events: { type: string; at: string }[], reason = "Forgot to clock out") => actions.requestCorrection({ reason, events });
  const pending = async (employeeId: string) => (await rows<{ id: string }>(sql`select id from time.clock_corrections where employee_id = ${employeeId} and status = 'pending'`))[0]?.id;

  it("adds new events when the lead approves, and never changes the original ones", async () => {
    const { lead, worker } = await setup();
    await event(worker.employeeId, "clock_in", iso(14 * HOUR)); // an open session from yesterday
    as(worker.user);
    expect((await propose([{ type: "clock_out", at: iso(6 * HOUR) }])).ok).toBe(true);
    const id = await pending(worker.employeeId);
    expect(await notes(lead.user.id, "attendance.correction_needed")).toHaveLength(1);

    // Not the person, not a stranger lead, and a rejection needs a note
    expect(await actions.decideCorrection({ correctionId: id, decision: "approve" })).toEqual({ ok: false, error: "Someone else must decide on your own request." });
    as((await person("Stranger", ["team_lead", "employee"])).user);
    expect(await actions.decideCorrection({ correctionId: id, decision: "approve" })).toEqual({ ok: false, error: NO_ACCESS });
    as(lead.user);
    expect(await actions.decideCorrection({ correctionId: id, decision: "reject" })).toEqual({ ok: false, error: "Give a short reason so the person knows why." });

    expect((await actions.decideCorrection({ correctionId: id, decision: "approve" })).ok).toBe(true);
    const events = await rows<{ type: string; source: string; correction_reason: string | null; created_by: string | null }>(sql`select type, source, correction_reason, created_by from time.clock_events where employee_id = ${worker.employeeId} order by occurred_at`);
    expect(events).toEqual([
      { type: "clock_in", source: "web", correction_reason: null, created_by: null },
      { type: "clock_out", source: "admin_correction", correction_reason: "Forgot to clock out", created_by: lead.user.id },
    ]);
    as(worker.user);
    expect((await queries.getClockStatus())?.state).toBe("out");
    expect(await notes(worker.user.id, "attendance.correction_approved")).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'clock.correction_approve' and target_id = ${worker.employeeId}`)).toHaveLength(1);
    as(lead.user);
    expect(await actions.decideCorrection({ correctionId: id, decision: "approve" })).toEqual({ ok: false, error: "That request was already handled." });
  });

  it("refuses corrections that cannot be true", async () => {
    const { worker } = await setup();
    await event(worker.employeeId, "clock_in", iso(5 * HOUR));
    await event(worker.employeeId, "clock_out", iso(4 * HOUR));
    as(worker.user);
    const refuse = async (events: { type: string; at: string }[], contains: string) => {
      const r = await propose(events);
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.error).toContain(contains);
    };
    await refuse([{ type: "clock_out", at: new Date(Date.now() + 2 * HOUR).toISOString() }], "future");
    await refuse([{ type: "clock_out", at: iso(40 * 24 * HOUR) }], "31 days");
    await refuse([{ type: "clock_out", at: iso(3 * HOUR) }], "do not fit"); // already out
    await refuse([{ type: "break_end", at: iso(2 * HOUR) }], "do not fit"); // no break to end
    await refuse([{ type: "clock_in", at: iso(4.5 * HOUR) }], "do not fit"); // inside an existing session: would break it
    await refuse([{ type: "clock_in", at: iso(30 * HOUR) }, { type: "clock_out", at: iso(10 * HOUR) }], "16 hours");
    expect((await propose([{ type: "clock_in", at: "garbage" }])).ok).toBe(false);
    expect((await propose([{ type: "clock_out", at: iso(HOUR) }], "x")).ok).toBe(false); // reason too short
    expect(await pending(worker.employeeId)).toBeUndefined();
  });

  it("lets HR decide when nobody is above the person, limits pending requests, and lets the person cancel", async () => {
    const solo = await person("Solo");
    as(solo.user);
    await event(solo.employeeId, "clock_in", iso(20 * HOUR));
    expect((await propose([{ type: "clock_out", at: iso(12 * HOUR) }])).ok).toBe(true);
    const id = await pending(solo.employeeId);
    expect((await notes(hr.id, "attendance.correction_needed")).length).toBeGreaterThanOrEqual(1); // HR was told

    // Three can wait, a fourth cannot; the person can cancel
    expect((await propose([{ type: "clock_out", at: iso(11 * HOUR) }])).ok).toBe(true);
    expect((await propose([{ type: "clock_out", at: iso(10 * HOUR) }])).ok).toBe(true);
    expect(await propose([{ type: "clock_out", at: iso(9 * HOUR) }])).toEqual({ ok: false, error: "You already have 3 corrections waiting. Wait for them to be decided." });
    expect((await actions.cancelCorrection({ correctionId: id })).ok).toBe(true);
    expect(await actions.cancelCorrection({ correctionId: id })).toEqual({ ok: false, error: "That request is no longer pending." });

    // HR approves another; the rest no longer fit and cannot be applied
    const next = await pending(solo.employeeId);
    as(hr);
    expect((await queries.listCorrectionQueue()).items.find((i) => i.id === next)?.canDecide).toBe(true);
    expect((await actions.decideCorrection({ correctionId: next, decision: "approve" })).ok).toBe(true);
    const stale = await pending(solo.employeeId);
    const result = await actions.decideCorrection({ correctionId: stale, decision: "approve" });
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("It cannot be applied now");
    expect((await actions.decideCorrection({ correctionId: stale, decision: "reject", note: "Superseded" })).ok).toBe(true);
  });
});

describe("the nightly rebuild", () => {
  it("builds one row per person and day from the events, with flags, and is safe to run again", async () => {
    const jon = await person("Jon");
    const day = (h: number) => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime() + h * HOUR;
    const at = (h: number) => new Date(day(h) - 24 * HOUR).toISOString(); // yesterday, UTC
    await event(jon.employeeId, "clock_in", at(9), { outside: true });
    await event(jon.employeeId, "break_start", at(12));
    await event(jon.employeeId, "break_end", at(12.5));
    await event(jon.employeeId, "clock_out", at(17));

    // Company-zone people: put the person in UTC so "yesterday" is unambiguous
    as(jon.user);
    expect((await actions.savePreferences({ shareLocation: false, timeZone: "UTC" })).ok).toBe(true);

    const first = await jobs.rebuildAttendanceDays();
    expect(first.days).toBeGreaterThanOrEqual(1);
    const read = () => rows<{ date: string; sessions: number; worked_minutes: number; break_minutes: number; flags: string[] }>(sql`select date::text as date, sessions, worked_minutes, break_minutes, flags from time.attendance_days where employee_id = ${jon.employeeId}`);
    const [d] = await read();
    expect(d).toMatchObject({ sessions: 1, worked_minutes: 450, break_minutes: 30 });
    expect(d.flags).toEqual(expect.arrayContaining(["outside_range"]));

    await jobs.rebuildAttendanceDays();
    expect(await read()).toHaveLength(1); // rebuilt in place, never duplicated
  });

  it("marks a day that is still open, and a day on approved leave", async () => {
    const kim = await person("Kim");
    await event(kim.employeeId, "clock_in", iso(2 * HOUR));
    await jobs.rebuildAttendanceDays();
    const flags = async () => (await rows<{ flags: string[] }>(sql`select flags from time.attendance_days where employee_id = ${kim.employeeId} order by date desc limit 1`))[0].flags;
    expect(await flags()).toContain("open_session");
    expect((await rows<{ worked_minutes: number }>(sql`select worked_minutes from time.attendance_days where employee_id = ${kim.employeeId}`))[0].worked_minutes).toBe(0); // an open session is not counted
  });
});

describe("missed clock-outs", () => {
  it("tells the person and their lead once when a session is open for over 12 hours", async () => {
    const lead = await person("MissLead", ["team_lead", "employee"]);
    const lou = await person("Lou", ["employee"], { managerId: lead.employeeId });
    const recent = await person("Recent", ["employee"], { managerId: lead.employeeId });
    await event(lou.employeeId, "clock_in", iso(13 * HOUR));
    await event(recent.employeeId, "clock_in", iso(11 * HOUR));

    const first = await jobs.runMissedClockouts();
    expect(first.noticed).toBeGreaterThanOrEqual(1);
    expect(await notes(lou.user.id, "attendance.missed_clockout")).toHaveLength(1);
    expect(await notes(lead.user.id, "attendance.missed_clockout_lead")).toHaveLength(1);
    expect(await notes(recent.user.id, "attendance.missed_clockout")).toHaveLength(0);

    await jobs.runMissedClockouts();
    expect(await notes(lou.user.id, "attendance.missed_clockout")).toHaveLength(1); // once

    // Clocked out in time: nothing
    const done = await person("Done");
    await event(done.employeeId, "clock_in", iso(20 * HOUR));
    await event(done.employeeId, "clock_out", iso(10 * HOUR));
    await jobs.runMissedClockouts();
    expect(await notes(done.user.id, "attendance.missed_clockout")).toHaveLength(0);
  });
});

describe("who sees what", () => {
  it("shows a lead their downline's clocks, HR everyone's, and nobody else", async () => {
    const lead = await person("SeeLead", ["team_lead", "employee"]);
    const report = await person("SeeReport", ["employee"], { managerId: lead.employeeId });
    const stranger = await person("SeeStranger");
    for (const p of [report, stranger]) await event(p.employeeId, "clock_in", iso(HOUR));
    await event(report.employeeId, "break_start", iso(0.5 * HOUR));

    as(lead.user);
    const team = await queries.listWorkingNow();
    expect(team.scope).toBe("team");
    expect(team.rows.map((r) => r.employeeId)).toEqual([report.employeeId]);
    expect(team.rows[0].state).toBe("break");

    as(hr);
    const all = await queries.listWorkingNow();
    expect(all.scope).toBe("all");
    expect(all.rows.map((r) => r.employeeId)).toEqual(expect.arrayContaining([report.employeeId, stranger.employeeId]));

    as(stranger.user);
    await expect(queries.listWorkingNow()).rejects.toThrow("Forbidden");
    await expect(queries.listFlags()).rejects.toThrow("Forbidden");
    await expect(queries.listCorrectionQueue()).rejects.toThrow("Forbidden");
    await expect(queries.listClockRules()).rejects.toThrow("Forbidden");
  });

  it("builds a person's week from their own events, in their own time zone", async () => {
    const may = await person("May");
    as(may.user);
    // 22:00-06:00 Manila time is a single shift that belongs to the day it started
    await actions.savePreferences({ shareLocation: false, timeZone: "Asia/Manila" });
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 1);
    const day = start.toISOString().slice(0, 10);
    await event(may.employeeId, "clock_in", `${day}T14:00:00Z`); // 22:00 Manila
    await event(may.employeeId, "clock_out", `${new Date(Date.parse(`${day}T14:00:00Z`) + 8 * HOUR).toISOString()}`); // 06:00 Manila next day
    const week = await queries.getMyTime(day);
    expect(week?.zone).toBe("Asia/Manila");
    const worked = week!.days.filter((d) => d.workedMinutes > 0);
    expect(worked).toHaveLength(1);
    expect(worked[0].workedMinutes).toBe(480);
    expect(week!.weekMinutes).toBe(480);
    expect((await actions.savePreferences({ shareLocation: false, timeZone: "Mars/Olympus" })).ok).toBe(false);
  });

  it("counts a session that is still open up to now in the person's own week, minus breaks", async () => {
    const ned = await person("Ned");
    await event(ned.employeeId, "clock_in", iso(3 * HOUR));
    await event(ned.employeeId, "break_start", iso(2 * HOUR));
    await event(ned.employeeId, "break_end", iso(1.5 * HOUR));
    as(ned.user);
    const week = await queries.getMyTime();
    const today = week!.days.find((d) => d.open)!;
    expect(today.open).toBe(true);
    expect(today.workedMinutes).toBeGreaterThanOrEqual(149); // 3h minus the 30 minute break, to the minute
    expect(today.workedMinutes).toBeLessThanOrEqual(151);
    expect(today.breakMinutes).toBe(30);
    expect(week!.weekMinutes).toBe(today.workedMinutes);
    // The nightly rebuild still leaves an unfinished session out
    await jobs.rebuildAttendanceDays();
    expect((await rows<{ worked_minutes: number }>(sql`select worked_minutes from time.attendance_days where employee_id = ${ned.employeeId}`))[0].worked_minutes).toBe(0);
  });

  it("lets HR see every team's rules, with defaults for teams that have none", async () => {
    const team = await makeTeam();
    as(hr);
    const result = await queries.listClockRules();
    const row = result.rows.find((r) => r.teamId === team);
    expect(row).toMatchObject({ allowedCidrs: [], selfieRequired: false, idleMinutes: 30, graceMinutes: 60, hasRow: false });
  });
});

describe("timed breaks and overbreaks", () => {
  const MIN = 60_000;
  const overNotes = (userId: string) => notes(userId, "attendance.overbreak");
  async function setup() {
    const lead = await person("BrkLead", ["team_lead", "employee"]);
    const worker = await person("Brk", ["employee"], { managerId: lead.employeeId });
    return { lead, worker };
  }

  it("stores the chosen break length, and refuses a length that is not offered", async () => {
    const { worker } = await setup();
    as(worker.user);
    expect((await actions.clockIn({})).ok).toBe(true);
    expect((await actions.startBreak({ breakMinutes: 45 })).ok).toBe(false);
    expect((await actions.startBreak({ breakMinutes: "30" })).ok).toBe(true); // a form can send it as text
    const planned = async () => (await rows<{ planned_break_minutes: number | null }>(sql`select planned_break_minutes from time.clock_events where employee_id = ${worker.employeeId} and type = 'break_start' order by created_at desc limit 1`))[0].planned_break_minutes;
    expect(await planned()).toBe(30);
    expect((await queries.getClockStatus())?.breakPlannedMinutes).toBe(30);
    expect((await actions.endBreak()).ok).toBe(true);
    expect((await actions.startBreak({})).ok).toBe(true); // no limit
    expect(await planned()).toBeNull();
    expect((await queries.getClockStatus())?.breakPlannedMinutes).toBeNull();
    // Only a break start can carry a length
    await expect(db.execute(sql`insert into time.clock_events (employee_id, type, planned_break_minutes) values (${worker.employeeId}, 'clock_in', 15)`)).rejects.toThrow();
  });

  it("reports an overbreak to the lead when the break ends, shows it on the timesheet, and flags the day", async () => {
    const { lead, worker } = await setup();
    await event(worker.employeeId, "clock_in", iso(2 * HOUR));
    await event(worker.employeeId, "break_start", iso(50 * MIN), { planned: 15 });
    as(worker.user);
    expect((await actions.endBreak()).ok).toBe(true);

    expect(await overNotes(lead.user.id)).toHaveLength(1);
    const [n] = await rows<{ title: string; body: string }>(sql`select title, body from ops.notifications where user_id = ${lead.user.id} and kind = 'attendance.overbreak'`);
    expect(n.title).toContain("went over their 15 minutes break");
    expect(Number.parseInt(n.body, 10)).toBeGreaterThanOrEqual(34);
    expect(await rows(sql`select 1 from time.overbreak_notices where minutes_over >= 34`)).not.toHaveLength(0);

    const week = await queries.getMyTime();
    const today = week!.days.find((d) => d.sessions > 0)!;
    expect(today.overbreakMinutes).toBeGreaterThanOrEqual(34);
    expect(today.sessionList[0].breaks[0]).toMatchObject({ plannedMinutes: 15 });
    expect(today.sessionList[0].breaks[0].overMinutes).toBeGreaterThanOrEqual(34);

    await jobs.rebuildAttendanceDays();
    const [day] = await rows<{ flags: string[]; overbreak_minutes: number }>(sql`select flags, overbreak_minutes from time.attendance_days where employee_id = ${worker.employeeId}`);
    expect(day.flags).toContain("overbreak");
    expect(day.overbreak_minutes).toBeGreaterThanOrEqual(34);

    as(lead.user);
    const flagged = (await queries.listFlags()).rows.find((r) => r.employeeId === worker.employeeId);
    expect(flagged?.flags).toContain("overbreak");
    expect(flagged?.overbreakMinutes).toBeGreaterThanOrEqual(34);
  });

  it("does not count a break that ends within the one-minute grace, or one with no limit", async () => {
    const { lead, worker } = await setup();
    await event(worker.employeeId, "clock_in", iso(3 * HOUR));
    await event(worker.employeeId, "break_start", iso(15 * MIN + 30_000), { planned: 15 });
    as(worker.user);
    expect((await actions.endBreak()).ok).toBe(true);
    expect((await actions.startBreak({})).ok).toBe(true);
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, planned_break_minutes) values (${worker.employeeId}, 'break_end', now(), null)`);
    expect(await overNotes(lead.user.id)).toHaveLength(0);
    expect((await queries.getMyTime())!.days.find((d) => d.sessions > 0)!.overbreakMinutes).toBe(0);
  });

  it("tells the lead while the break is still running past its length, once, and not again when it ends", async () => {
    const { lead, worker } = await setup();
    await event(worker.employeeId, "clock_in", iso(2 * HOUR));
    await event(worker.employeeId, "break_start", iso(20 * MIN), { planned: 15 });
    const quiet = await person("BrkQuiet"); // a break still inside its time: nothing
    await event(quiet.employeeId, "clock_in", iso(HOUR));
    await event(quiet.employeeId, "break_start", iso(10 * MIN), { planned: 15 });

    const first = await jobs.runOverbreakAlerts();
    expect(first.noticed).toBeGreaterThanOrEqual(1);
    expect(await overNotes(lead.user.id)).toHaveLength(1);
    expect(await jobs.runOverbreakAlerts()).toEqual({ noticed: 0 });
    expect((await rows(sql`select 1 from ops.notifications where kind = 'attendance.overbreak' and body is not null and user_id in (select user_id from core.employees where id = ${quiet.employeeId})`))).toHaveLength(0);

    as(worker.user);
    expect((await actions.endBreak()).ok).toBe(true);
    expect(await overNotes(lead.user.id)).toHaveLength(1); // already reported: not twice
  });

  it("goes to HR when nobody is above the person, never to the person themselves", async () => {
    const solo = await person("BrkSolo");
    await event(solo.employeeId, "clock_in", iso(2 * HOUR));
    await event(solo.employeeId, "break_start", iso(45 * MIN), { planned: 15 });
    as(solo.user);
    await actions.endBreak();
    expect((await overNotes(hr.id)).length).toBeGreaterThanOrEqual(1);
    expect(await overNotes(solo.user.id)).toHaveLength(0);
  });
});

describe("every clock-in stays its own record", () => {
  it("lists two sessions on the same day separately, with their own breaks", async () => {
    const two = await person("Two");
    as(two.user);
    expect((await actions.clockIn({})).ok).toBe(true);
    expect((await actions.startBreak({ breakMinutes: 15 })).ok).toBe(true);
    expect((await actions.endBreak()).ok).toBe(true);
    expect((await actions.clockOut()).ok).toBe(true);
    expect((await actions.clockIn({})).ok).toBe(true);
    expect((await actions.clockOut()).ok).toBe(true);

    const week = await queries.getMyTime();
    const day = week!.days.find((d) => d.sessions > 0)!;
    expect(day.sessions).toBe(2);
    expect(day.sessionList).toHaveLength(2);
    expect(day.sessionList[0].breaks).toHaveLength(1);
    expect(day.sessionList[1].breaks).toHaveLength(0);
    expect(day.sessionList[0].endAt).toBeLessThanOrEqual(day.sessionList[1].startAt);
    // The rebuilt day adds them up rather than replacing one with the other
    await jobs.rebuildAttendanceDays();
    expect((await rows<{ sessions: number }>(sql`select sessions from time.attendance_days where employee_id = ${two.employeeId}`))[0].sessions).toBe(2);
  });
});

describe("internal staff can use the clock too", () => {
  it("lets an HR or Super Admin account without a people record set one up and clock in", async () => {
    const owner = await makeUser("owner", ["super_admin", "employee"]);
    as(owner);
    expect(await queries.getClockStatus()).toBeNull();
    expect(await actions.clockIn({})).toEqual({ ok: false, error: "Your people record is not set up yet. Ask HR." });

    expect((await peopleActions.createMyProfile({ firstName: "x", lastName: "" })).ok).toBe(false);
    const made = await peopleActions.createMyProfile({ firstName: "Olivia", lastName: "Owner" });
    expect(made.ok).toBe(true);
    const [e] = await rows<{ user_id: string; work_email: string; status: string }>(sql`select user_id, work_email, status from core.employees where user_id = ${owner.id}`);
    expect(e).toMatchObject({ user_id: owner.id, work_email: owner.email, status: "active" });
    expect(await rows(sql`select 1 from ops.audit_log where action = 'people.create_self' and actor_user_id = ${owner.id}`)).toHaveLength(1);

    expect((await queries.getClockStatus())?.state).toBe("out");
    expect((await actions.clockIn({})).ok).toBe(true);
    expect(await peopleActions.createMyProfile({ firstName: "Olivia", lastName: "Owner" })).toEqual({ ok: false, error: "You already have a people record." });
  });

  it("links the record HR already added with the same email instead of creating a duplicate", async () => {
    const hrUser = await makeUser("linkme", ["hr_admin", "employee"]);
    const [pre] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status) values ('Pre', 'Added', ${hrUser.email}, 'active') returning id`);
    as(hrUser);
    expect((await peopleActions.createMyProfile({ firstName: "Other", lastName: "Name" })).ok).toBe(true);
    const mine = await rows<{ id: string; legal_first_name: string }>(sql`select id, legal_first_name from core.employees where user_id = ${hrUser.id}`);
    expect(mine).toEqual([{ id: pre.id, legal_first_name: "Pre" }]); // the existing record, not a new one
  });

  it("is only for HR and Super Admin; everyone else asks HR", async () => {
    for (const role of ["team_lead", "recruiter", "executive", "employee"] as RoleSlug[]) {
      as(await makeUser("nopeprofile", [role]));
      expect(await peopleActions.createMyProfile({ firstName: "A", lastName: "B" })).toEqual({ ok: false, error: NO_ACCESS });
    }
  });
});

describe("presence, welcome back and the quiet-session alert", () => {
  const MIN = 60_000;
  async function setup() {
    const lead = await person("PresLead", ["team_lead", "employee"]);
    const worker = await person("Pres", ["employee"], { managerId: lead.employeeId });
    return { lead, worker };
  }
  const setSeen = (employeeId: string, agoMs: number) => db.execute(sql`insert into time.clock_presence (employee_id, last_seen_at) values (${employeeId}, ${iso(agoMs)}) on conflict (employee_id) do update set last_seen_at = excluded.last_seen_at`);

  it("records presence at clock-in, and a ping after a long gap returns when the person was last seen", async () => {
    const { worker } = await setup();
    as(worker.user);
    expect((await actions.pingPresence())).toMatchObject({ ok: true, data: { working: false, previousSeenMs: null } }); // not clocked in: nothing recorded
    expect(await rows(sql`select 1 from time.clock_presence where employee_id = ${worker.employeeId}`)).toHaveLength(0);

    expect((await actions.clockIn({})).ok).toBe(true);
    const first = await actions.pingPresence();
    expect(first.ok && first.data.working).toBe(true);
    expect(first.ok && first.data.previousSeenMs !== null && first.data.serverNowMs - first.data.previousSeenMs < 15 * MIN).toBe(true); // clock-in counted as seen

    await setSeen(worker.employeeId, 3 * HOUR);
    const gap = await actions.pingPresence();
    expect(gap.ok && gap.data.previousSeenMs !== null && gap.data.serverNowMs - gap.data.previousSeenMs > 2.9 * HOUR).toBe(true);
    const again = await actions.pingPresence(); // the ping itself counts as seen
    expect(again.ok && again.data.serverNowMs - again.data.previousSeenMs! < MIN).toBe(true);
  });

  it("shows the lead when each person was last seen and who is possibly offline", async () => {
    const { lead, worker } = await setup();
    const quiet = await person("PresQuiet", ["employee"], { managerId: lead.employeeId });
    for (const p of [worker, quiet]) await event(p.employeeId, "clock_in", iso(HOUR));
    await setSeen(worker.employeeId, MIN);
    await setSeen(quiet.employeeId, 25 * MIN);
    as(lead.user);
    const { rows: working } = await queries.listWorkingNow();
    const w = working.find((r) => r.employeeId === worker.employeeId)!;
    const q = working.find((r) => r.employeeId === quiet.employeeId)!;
    expect(w).toMatchObject({ possiblyOffline: false });
    expect(w.lastSeenMs).not.toBeNull();
    expect(q.possiblyOffline).toBe(true);
  });

  it("tells the lead once when someone working has not been seen for 2 hours, and never someone on a break or recently seen", async () => {
    const { lead, worker } = await setup();
    const fresh = await person("PresFresh", ["employee"], { managerId: lead.employeeId });
    const onBreak = await person("PresBreak", ["employee"], { managerId: lead.employeeId });
    await event(worker.employeeId, "clock_in", iso(4 * HOUR));
    await setSeen(worker.employeeId, 3 * HOUR);
    await event(fresh.employeeId, "clock_in", iso(4 * HOUR));
    await setSeen(fresh.employeeId, 5 * MIN);
    await event(onBreak.employeeId, "clock_in", iso(4 * HOUR));
    await event(onBreak.employeeId, "break_start", iso(3 * HOUR));
    await setSeen(onBreak.employeeId, 3 * HOUR);

    const run = await jobs.runQuietSessionAlerts();
    expect(run.noticed).toBeGreaterThanOrEqual(1);
    const mine = await rows<{ title: string }>(sql`select title from ops.notifications where user_id = ${lead.user.id} and kind = 'attendance.quiet_lead'`);
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toContain("has not been seen");
    expect((await jobs.runQuietSessionAlerts()).noticed).toBe(0); // once
    expect(await notes(lead.user.id, "attendance.quiet_lead")).toHaveLength(1);
    expect(await rows(sql`select 1 from time.clock_events where employee_id = ${worker.employeeId} and type = 'clock_out'`)).toHaveLength(0); // nobody was clocked out
  });
});

describe("\"I stopped at\" requests", () => {
  it("holds the other clock actions until the lead decides or the person cancels, and clocks out at the approved time", async () => {
    const lead = await person("StopLead", ["team_lead", "employee"]);
    const worker = await person("Stop", ["employee"], { managerId: lead.employeeId });
    await event(worker.employeeId, "clock_in", iso(3 * HOUR));
    as(worker.user);
    const stopAt = iso(2 * HOUR);
    expect((await actions.requestCorrection({ reason: "My internet connection dropped.", kind: "connection_problem", events: [{ type: "clock_out", at: stopAt }] })).ok).toBe(true);

    const status = await queries.getClockStatus();
    expect(status?.state).toBe("working");
    expect(status?.pendingClockOut).not.toBeNull();
    expect(Math.abs(status!.pendingClockOut!.atMs - Date.parse(stopAt))).toBeLessThan(1000);
    expect(await actions.clockOut()).toEqual({ ok: false, error: "Your clock-out request is waiting for approval. Cancel it first if you are still working." });
    expect((await actions.startBreak()).ok).toBe(false);

    // Cancelling gives the clock back
    await actions.cancelCorrection({ correctionId: status!.pendingClockOut!.id });
    expect((await queries.getClockStatus())?.pendingClockOut).toBeNull();
    // A new request, approved by the lead
    expect((await actions.requestCorrection({ reason: "My device restarted.", kind: "device_problem", events: [{ type: "clock_out", at: stopAt }] })).ok).toBe(true);
    const [c] = await rows<{ id: string; kind: string }>(sql`select id, kind from time.clock_corrections where employee_id = ${worker.employeeId} and status = 'pending'`);
    expect(c.kind).toBe("device_problem");
    as(lead.user);
    expect((await actions.decideCorrection({ correctionId: c.id, decision: "approve" })).ok).toBe(true);
    expect(await stateOf(worker.employeeId)).toBe("clock_out");
  });
});

describe("time claims with evidence", () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  async function setup() {
    const lead = await person("ClaimLead", ["team_lead", "employee"]);
    const worker = await person("Claim", ["employee"], { managerId: lead.employeeId });
    return { lead, worker };
  }
  async function upload(bytes: Uint8Array, mime = "image/png") {
    const ticket = await actions.requestEvidenceUpload({ mime, size: bytes.length });
    if (!ticket.ok) throw new Error(ticket.error);
    fake.put("employee-docs", ticket.data.path, bytes);
    return ticket.data;
  }
  const claimEvents = (startAgo = 3 * HOUR, endAgo = HOUR) => [{ type: "clock_in", at: iso(startAgo) }, { type: "clock_out", at: iso(endAgo) }];

  it("needs a screenshot when the claim adds a clock-in, and attaches checked evidence", async () => {
    const { lead, worker } = await setup();
    as(worker.user);
    const noProof = await actions.requestCorrection({ reason: "I forgot to clock in", kind: "forgot", events: claimEvents() });
    expect(noProof).toEqual({ ok: false, error: "Attach at least one screenshot (for example your browser history) that shows when you started working." });

    const shot = await upload(PNG_BYTES);
    const sent = await actions.requestCorrection({ reason: "I forgot to clock in", kind: "forgot", events: claimEvents(), evidenceIds: [shot.id] });
    expect(sent.ok).toBe(true);
    const [ev] = await rows<{ correction_id: string | null; size_bytes: number; sha256: string }>(sql`select correction_id, size_bytes, sha256 from time.correction_evidence where id = ${shot.id}`);
    expect(ev.correction_id).not.toBeNull();
    expect(ev.size_bytes).toBe(PNG_BYTES.length);
    expect(ev.sha256).toHaveLength(64);
    expect(await notes(lead.user.id, "attendance.correction_needed")).toHaveLength(1);

    // The same screenshot cannot be attached twice, and a clock-out only claim needs no proof
    expect((await actions.requestCorrection({ reason: "Again with the same file", kind: "forgot", events: claimEvents(10 * HOUR, 9 * HOUR), evidenceIds: [shot.id] })).ok).toBe(false);
    expect((await actions.requestCorrection({ reason: "Forgot to clock out", kind: "forgot", events: [{ type: "clock_out", at: iso(30 * 60_000) }] })).ok).toBe(false); // no open session: does not fit, and not for lack of proof
  });

  it("refuses a file that is not really a JPG or PNG and deletes it, and someone else's screenshot", async () => {
    const { worker } = await setup();
    const other = await person("ClaimOther");
    as(other.user);
    const theirs = await upload(PNG_BYTES);
    as(worker.user);
    const fakeImage = await upload(new TextEncoder().encode("MZ not an image at all"));
    const bad = await actions.requestCorrection({ reason: "I forgot to clock in", kind: "forgot", events: claimEvents(), evidenceIds: [fakeImage.id] });
    expect(bad.ok).toBe(false);
    expect(fake.objects.has(fake.key("employee-docs", fakeImage.path))).toBe(false);
    expect(await rows(sql`select 1 from time.clock_corrections where employee_id = ${worker.employeeId}`)).toHaveLength(0); // rolled back

    const stolen = await actions.requestCorrection({ reason: "I forgot to clock in", kind: "forgot", events: claimEvents(), evidenceIds: [theirs.id] });
    expect(stolen.ok).toBe(false);
    expect((await actions.requestCorrection({ reason: "Too many files", kind: "forgot", events: claimEvents(), evidenceIds: [randomUUID(), randomUUID(), randomUUID(), randomUUID()] })).ok).toBe(false);
    expect((await actions.requestEvidenceUpload({ mime: "application/pdf", size: 100 })).ok).toBe(false);
    expect((await actions.requestEvidenceUpload({ mime: "image/png", size: 6_000_000 })).ok).toBe(false);
  });

  it("lets only the person, their chain of leads and HR open a screenshot, and audits each open", async () => {
    const { lead, worker } = await setup();
    as(worker.user);
    const shot = await upload(JPEG, "image/jpeg");
    await actions.requestCorrection({ reason: "I forgot to clock in", kind: "forgot", events: claimEvents(), evidenceIds: [shot.id] });

    for (const who of [worker.user, lead.user, hr]) {
      as(who);
      const link = await actions.openEvidence({ evidenceId: shot.id });
      expect(link.ok && link.data.url).toContain("expires=60");
    }
    expect(await rows(sql`select 1 from ops.audit_log where action = 'clock.evidence_view' and metadata->>'evidenceId' = ${shot.id}`)).toHaveLength(3);

    const outsiderLead = await person("ClaimOutsider", ["team_lead", "employee"]);
    const peer = await person("ClaimPeer");
    for (const who of [outsiderLead.user, peer.user]) {
      as(who);
      expect(await actions.openEvidence({ evidenceId: shot.id })).toEqual({ ok: false, error: NO_ACCESS });
    }
    // An upload that was never attached to a claim cannot be opened
    as(worker.user);
    const loose = await upload(PNG_BYTES);
    expect((await actions.openEvidence({ evidenceId: loose.id })).ok).toBe(false);
  });

  it("lets the reviewer adjust the times before approving, and tells the person", async () => {
    const { lead, worker } = await setup();
    as(worker.user);
    const shot = await upload(PNG_BYTES);
    await actions.requestCorrection({ reason: "I forgot to clock in", kind: "forgot", events: claimEvents(4 * HOUR, 2 * HOUR), evidenceIds: [shot.id] });
    const [c] = await rows<{ id: string }>(sql`select id from time.clock_corrections where employee_id = ${worker.employeeId}`);

    as(lead.user);
    expect((await actions.decideCorrection({ correctionId: c.id, decision: "reject", note: "no", events: claimEvents() })).ok).toBe(false); // times change only with an approval
    const adjusted = [{ type: "clock_in", at: iso(3 * HOUR) }, { type: "clock_out", at: iso(2 * HOUR) }];
    expect((await actions.decideCorrection({ correctionId: c.id, decision: "approve", events: adjusted })).ok).toBe(true);

    const written = await rows<{ type: string; seconds: number }>(sql`select type, extract(epoch from now() - occurred_at)::float8 as seconds from time.clock_events where employee_id = ${worker.employeeId} and source = 'admin_correction' order by occurred_at`);
    expect(written.map((w) => w.type)).toEqual(["clock_in", "clock_out"]);
    expect(Math.abs(written[0].seconds - 3 * 3600)).toBeLessThan(60); // the adjusted time, not the asked one
    const [row] = await rows<{ original_proposed: { type: string }[] | null; status: string }>(sql`select original_proposed, status from time.clock_corrections where id = ${c.id}`);
    expect(row.status).toBe("approved");
    expect(row.original_proposed).toHaveLength(2);
    expect((await rows<{ title: string }>(sql`select title from ops.notifications where user_id = ${worker.user.id} and kind = 'attendance.correction_approved'`))[0].title).toContain("with changes");
  });

  it("sends claims older than 7 days to HR, and only HR can decide them", async () => {
    const { lead, worker } = await setup();
    as(worker.user);
    const shot = await upload(PNG_BYTES);
    const sent = await actions.requestCorrection({ reason: "Last week was missed", kind: "device_problem", events: claimEvents(10 * 24 * HOUR, 10 * 24 * HOUR - 8 * HOUR), evidenceIds: [shot.id] });
    expect(sent.ok).toBe(true);
    expect(await notes(lead.user.id, "attendance.correction_needed")).toHaveLength(0); // not the lead
    expect((await notes(hr.id, "attendance.correction_needed")).length).toBeGreaterThanOrEqual(1);
    const [c] = await rows<{ id: string }>(sql`select id from time.clock_corrections where employee_id = ${worker.employeeId}`);

    as(lead.user);
    expect(await actions.decideCorrection({ correctionId: c.id, decision: "approve" })).toEqual({ ok: false, error: "Only HR can decide this request." });
    const queue = (await queries.listCorrectionQueue()).items.find((i) => i.id === c.id);
    expect(queue).toMatchObject({ hrOnly: true, canDecide: false });
    expect(queue?.evidence).toHaveLength(1);
    as(hr);
    expect((await queries.listCorrectionQueue()).items.find((i) => i.id === c.id)?.canDecide).toBe(true);
    expect((await actions.decideCorrection({ correctionId: c.id, decision: "approve" })).ok).toBe(true);
  });

  it("deletes screenshots 90 days after the decision, and ones never attached after a day", async () => {
    const { lead, worker } = await setup();
    as(worker.user);
    const shot = await upload(PNG_BYTES);
    await actions.requestCorrection({ reason: "I forgot to clock in", kind: "forgot", events: claimEvents(), evidenceIds: [shot.id] });
    const loose = await upload(PNG_BYTES);
    const [c] = await rows<{ id: string }>(sql`select id from time.clock_corrections where employee_id = ${worker.employeeId}`);
    as(lead.user);
    await actions.decideCorrection({ correctionId: c.id, decision: "approve" });

    await jobs.purgeEvidence();
    expect(fake.objects.has(fake.key("employee-docs", shot.path))).toBe(true); // just decided: kept
    expect(fake.objects.has(fake.key("employee-docs", loose.path))).toBe(true); // less than a day old: kept

    await db.execute(sql`update time.clock_corrections set decided_at = now() - interval '91 days' where id = ${c.id}`);
    await db.execute(sql`update time.correction_evidence set created_at = now() - interval '2 days' where id = ${loose.id}`);
    await jobs.purgeEvidence();
    expect(fake.objects.has(fake.key("employee-docs", shot.path))).toBe(false);
    expect(fake.objects.has(fake.key("employee-docs", loose.path))).toBe(false);
    expect((await rows<{ purged_at: Date | null }>(sql`select purged_at from time.correction_evidence where id = ${shot.id}`))[0].purged_at).not.toBeNull(); // the row stays
    expect(await rows(sql`select 1 from time.correction_evidence where id = ${loose.id}`)).toHaveLength(0);
  });
});

describe("filing a correction for someone else", () => {
  const forThem = (employeeId: string, reason = "Their laptop died") => actions.fileCorrectionForOthers({ employeeId, reason, kind: "device_problem", events: [{ type: "clock_in", at: iso(3 * HOUR) }, { type: "clock_out", at: iso(HOUR) }] });

  it("lets a lead file for their downline, tells the person, and leaves the decision to HR", async () => {
    const lead = await person("FileLead", ["team_lead", "employee"]);
    const worker = await person("Filed", ["employee"], { managerId: lead.employeeId });
    as(lead.user);
    expect((await queries.listFilablePeople()).map((p) => p.id)).toContain(worker.employeeId);
    expect((await forThem(worker.employeeId)).ok).toBe(true);
    expect(await notes(worker.user.id, "attendance.correction_filed_for_you")).toHaveLength(1);
    expect((await notes(hr.id, "attendance.correction_needed")).length).toBeGreaterThanOrEqual(1);
    const [c] = await rows<{ id: string; requested_by: string }>(sql`select id, requested_by from time.clock_corrections where employee_id = ${worker.employeeId}`);
    expect(c.requested_by).toBe(lead.user.id);

    // Not the lead who filed it, and not another lead above the person either
    expect(await actions.decideCorrection({ correctionId: c.id, decision: "approve" })).toEqual({ ok: false, error: "Someone else must decide on your own request." });
    const boss = await person("FileBoss", ["team_lead", "employee"]);
    await db.execute(sql`update core.employees set manager_id = ${boss.employeeId} where id = ${lead.employeeId}`);
    as(boss.user);
    expect(await actions.decideCorrection({ correctionId: c.id, decision: "approve" })).toEqual({ ok: false, error: "Only HR can decide this request." });
    expect((await queries.listCorrectionQueue()).items.find((i) => i.id === c.id)).toMatchObject({ canDecide: false, hrOnly: true });
    as(hr);
    expect((await queries.listCorrectionQueue()).items.find((i) => i.id === c.id)?.filedBy).toContain("FileLead");
    expect((await actions.decideCorrection({ correctionId: c.id, decision: "approve" })).ok).toBe(true);
  });

  it("refuses a lead filing outside their downline or for themselves, and everyone below lead", async () => {
    const lead = await person("FileLead2", ["team_lead", "employee"]);
    const stranger = await person("FileStranger");
    as(lead.user);
    expect(await forThem(stranger.employeeId)).toEqual({ ok: false, error: NO_ACCESS });
    expect(await forThem(lead.employeeId)).toEqual({ ok: false, error: NO_ACCESS }); // not in their own downline
    for (const role of ["employee", "recruiter", "executive"] as RoleSlug[]) {
      as(await makeUser("nofile", [role]));
      expect(await forThem(stranger.employeeId)).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(hr);
    expect((await forThem(stranger.employeeId)).ok).toBe(true); // HR can file for anyone
    expect(await forThem(stranger.employeeId, "x")).toMatchObject({ ok: false }); // reason too short
    const hrPerson = await rows<{ id: string }>(sql`select id from core.employees where user_id = ${hr.id}`);
    expect(await forThem(hrPerson[0].id)).toEqual({ ok: false, error: "File your own corrections from My time." });
  });

  it("lets another HR admin decide what an HR admin filed, but not the filer", async () => {
    const worker = await person("FiledByHr");
    const hr2 = await person("hr2", ["hr_admin", "employee"]);
    as(hr);
    expect((await forThem(worker.employeeId)).ok).toBe(true);
    const [c] = await rows<{ id: string }>(sql`select id from time.clock_corrections where employee_id = ${worker.employeeId}`);
    expect(await actions.decideCorrection({ correctionId: c.id, decision: "approve" })).toEqual({ ok: false, error: "Someone else must decide on your own request." });
    as(hr2.user);
    expect((await actions.decideCorrection({ correctionId: c.id, decision: "approve" })).ok).toBe(true);
  });
});

describe("end-of-day notes", () => {
  async function setup() {
    const lead = await person("NoteLead", ["team_lead", "employee"]);
    const worker = await person("Note", ["employee"], { managerId: lead.employeeId });
    return { lead, worker };
  }

  it("returns the finished session's id on clock-out, saves a note, marks edits, and shows it to the lead and HR only", async () => {
    const { lead, worker } = await setup();
    as(worker.user);
    expect((await actions.clockIn({})).ok).toBe(true);
    const [start] = await rows<{ id: string }>(sql`select id from time.clock_events where employee_id = ${worker.employeeId} and type = 'clock_in'`);
    expect(await actions.saveShiftNote({ sessionId: start.id, body: "Too early" })).toEqual({ ok: false, error: "Clock out first, then write your end-of-day note." });
    const out = await actions.clockOut();
    expect(out.ok && out.data.sessionId).toBe(start.id);
    expect((await actions.clockIn({})).ok).toBe(true);
    const second = await actions.clockOut();
    expect(second.ok && second.data.sessionId).not.toBe(start.id);

    expect((await actions.saveShiftNote({ sessionId: start.id, body: "Done today:\n- inbox\n- calls" })).ok).toBe(true);
    expect((await actions.saveShiftNote({ sessionId: start.id, body: "   " })).ok).toBe(false);
    expect((await actions.saveShiftNote({ sessionId: start.id, body: "x".repeat(5001) })).ok).toBe(false);
    expect((await actions.saveShiftNote({ sessionId: start.id, body: "Done today:\n- inbox\n- calls\n- reports" })).ok).toBe(true);
    const [n] = await rows<{ body: string; edited: boolean }>(sql`select body, edited from time.shift_notes where session_event_id = ${start.id}`);
    expect(n).toMatchObject({ edited: true });
    expect(n.body).toContain("reports");
    expect(await rows(sql`select 1 from ops.audit_log where action in ('clock.note', 'clock.note_edit') and target_id = ${worker.employeeId}`)).toHaveLength(2);

    const week = await queries.getMyTime();
    expect(week!.notes[start.id]).toMatchObject({ edited: true });

    // The note belongs to its session: nobody else can write on it
    const other = await person("NoteOther");
    as(other.user);
    expect(await actions.saveShiftNote({ sessionId: start.id, body: "Not mine" })).toEqual({ ok: false, error: "That session was not found." });
    await expect(queries.listShiftNotes()).rejects.toThrow();

    as(lead.user);
    expect((await queries.listShiftNotes()).rows.some((r) => r.employeeId === worker.employeeId && r.body.includes("reports"))).toBe(true);
    const outsider = await person("NoteOutsider", ["team_lead", "employee"]);
    as(outsider.user);
    expect((await queries.listShiftNotes()).rows.some((r) => r.employeeId === worker.employeeId)).toBe(false);
    as(hr);
    expect((await queries.listShiftNotes()).rows.some((r) => r.employeeId === worker.employeeId)).toBe(true);
  });

  it("closes the note 24 hours after clock-out", async () => {
    const { worker } = await setup();
    await event(worker.employeeId, "clock_in", iso(40 * HOUR));
    await event(worker.employeeId, "clock_out", iso(30 * HOUR));
    const [start] = await rows<{ id: string }>(sql`select id from time.clock_events where employee_id = ${worker.employeeId} and type = 'clock_in'`);
    as(worker.user);
    expect(await actions.saveShiftNote({ sessionId: start.id, body: "Late" })).toEqual({ ok: false, error: "The 24 hours for this note are over. Ask HR if it must change." });
    expect((await queries.getMyTime())).not.toBeNull();
  });

  it("flags a missing report only for teams that expect one, and clears the flag once it is written", async () => {
    const team = await makeTeam();
    const worker = await person("NoteEod", ["employee"], { teamId: team });
    const free = await person("NoteFree", ["employee"]); // a team with no rule
    for (const p of [worker, free]) {
      await event(p.employeeId, "clock_in", iso(5 * HOUR));
      await event(p.employeeId, "clock_out", iso(HOUR));
    }
    as(hr);
    expect((await actions.saveClockRules({ teamId: team, allowedCidrs: [], selfieRequired: false, idleMinutes: 30, graceMinutes: 60, eodExpected: true })).ok).toBe(true);
    const flagsOf = async (employeeId: string) => (await rows<{ flags: string[] }>(sql`select flags from time.attendance_days where employee_id = ${employeeId}`)).flatMap((r) => r.flags);

    await jobs.rebuildAttendanceDays();
    expect(await flagsOf(worker.employeeId)).toContain("no_eod");
    expect(await flagsOf(free.employeeId)).not.toContain("no_eod");

    const [start] = await rows<{ id: string }>(sql`select id from time.clock_events where employee_id = ${worker.employeeId} and type = 'clock_in'`);
    as(worker.user);
    expect((await actions.saveShiftNote({ sessionId: start.id, body: "Wrapped up the audit." })).ok).toBe(true);
    await jobs.rebuildAttendanceDays();
    expect(await flagsOf(worker.employeeId)).not.toContain("no_eod");
  });
});
