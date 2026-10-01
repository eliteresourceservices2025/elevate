import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PDF_BYTES } from "./fake-storage";

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
async function event(employeeId: string, type: string, at: string, extra: { outside?: boolean } = {}) {
  await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, outside_allowed_range) values (${employeeId}, ${type}, ${at}, ${extra.outside ?? false})`);
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

  it("lets HR see every team's rules, with defaults for teams that have none", async () => {
    const team = await makeTeam();
    as(hr);
    const result = await queries.listClockRules();
    const row = result.rows.find((r) => r.teamId === team);
    expect(row).toMatchObject({ allowedCidrs: [], selfieRequired: false, idleMinutes: 30, graceMinutes: 60, hasRow: false });
  });
});
