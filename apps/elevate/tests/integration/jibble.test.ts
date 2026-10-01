import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for the Jibble link (Phase 2.4) against a fake Jibble client: when calls are queued (and when not),
// order and retries, matching people by email, the nightly comparison, and who may manage it.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { formatInZone } = await import("@/lib/time");
const attendance = await import("@/modules/attendance/actions");
const attendanceJobs = await import("@/modules/attendance/jobs");
const attendanceQueries = await import("@/modules/attendance/queries");
const actions = await import("@/modules/jibble/actions");
const queries = await import("@/modules/jibble/queries");
const jobs = await import("@/modules/jibble/jobs");
const { setJibbleClient } = await import("@/modules/jibble/client");
const { JibbleError } = await import("@/modules/jibble/http-client");
type JibbleClient = import("@/modules/jibble/http-client").JibbleClient;
type JibblePerson = import("@/modules/jibble/http-client").JibblePerson;
type JibbleDay = import("@/modules/jibble/http-client").JibbleDay;

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const notes = (userId: string, kind: string) => rows(sql`select 1 from ops.notifications where user_id = ${userId} and kind = ${kind}`);
const as = (u: TestUser) => {
  current.user = u;
};
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();

class FakeJibble implements JibbleClient {
  calls: { personId: string; action: string; options?: { breakMinutes?: number | null; previousEntryId?: string | null } }[] = [];
  breaks: { id: string; name: string; durationMinutes: number | null }[] = [];
  people: JibblePerson[] = [];
  tracked: JibbleDay[] = [];
  /** Where each Jibble person is right now, for the state checks (null = no entry). A person not listed has no entry. */
  states = new Map<string, "in" | "break" | "out" | null>();
  /** Make the state lookup fail. */
  stateFails = false;
  /** Return an error to make a call fail. */
  fail: (personId: string, action: string) => InstanceType<typeof JibbleError> | null = () => null;
  async listPeople() {
    return this.people;
  }
  async listBreaks() {
    return this.breaks;
  }
  async latestState(personId: string) {
    if (this.stateFails) throw new JibbleError(503, "request refused");
    return this.states.get(personId) ?? null;
  }
  async clock(personId: string, action: string, options?: { breakMinutes?: number | null; previousEntryId?: string | null }) {
    const f = this.fail(personId, action);
    if (f) throw f;
    this.calls.push({ personId, action, options });
    return { entryId: `entry-${this.calls.length}` };
  }
  async dailyTracked() {
    return this.tracked;
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
async function makeTeam() {
  const [d] = await rows<{ id: string }>(sql`insert into core.departments (name) values (${uniq("Dept ")}) returning id`);
  const [t] = await rows<{ id: string }>(sql`insert into core.teams (department_id, name) values (${d.id}, ${uniq("Team ")}) returning id`);
  return t.id;
}
async function person(label: string, opts: { teamId?: string; mapped?: boolean } = {}) {
  const user = await makeUser(label, ["employee"]);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, team_id)
    values (${label}, ${uniq(label)}, ${user.email}, 'active', ${user.id}, ${opts.teamId ?? null}) returning id`);
  const jibbleId = randomUUID();
  mapped.set(e.id, jibbleId);
  if (opts.mapped !== false) await db.execute(sql`insert into time.jibble_people (employee_id, jibble_person_id, matched_by) values (${e.id}, ${jibbleId}, 'manual')`);
  return { user, employeeId: e.id, jibbleId };
}
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
const fayJibbleId = (employeeId: string) => mapped.get(employeeId)!;
const mapped = new Map<string, string>();
const logOf = (employeeId: string) => rows<{ action: string; status: string; attempts: number; last_error: string | null }>(sql`select action, status, attempts, last_error from time.jibble_link_log where employee_id = ${employeeId} order by created_at, action`);
const turnOn = (hr: TestUser, teamId: string, on = true) => {
  as(hr);
  return attendance.saveClockRules({ teamId, allowedCidrs: [], selfieRequired: false, idleMinutes: 30, graceMinutes: 60, jibbleMirror: on });
};

let hr: TestUser;
beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin", "employee"]);
  await rows(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Hana', ${uniq("Hr")}, ${hr.email}, 'active', ${hr.id})`);
});
beforeEach(() => {
  process.env.ELEVATE_ENV = "production"; // the safety lock lets the fake send
  delete process.env.JIBBLE_TEST_PERSON_IDS;
  fake.states = new Map();
  fake.stateFails = false;
  fake.calls = [];
  fake.breaks = [];
  fake.people = [];
  fake.tracked = [];
  fake.fail = () => null;
  setJibbleClient(fake);
  delete process.env.JIBBLE_MIRROR_ENABLED;
  delete process.env.JIBBLE_BREAK_MODE;
});
afterAll(() => {
  delete process.env.ELEVATE_ENV;
  setJibbleClient(undefined);
});

describe("when a clock click is queued for Jibble", () => {
  it("queues In and Out for a mapped person on a team that uses Jibble, once monitoring is published", async () => {
    await withMonitoring(async () => {
      const team = await makeTeam();
      expect((await turnOn(hr, team)).ok).toBe(true);
      const ana = await person("Ana", { teamId: team });
      as(ana.user);
      expect((await attendance.clockIn({})).ok).toBe(true);
      expect((await attendance.clockOut()).ok).toBe(true);
      expect((await logOf(ana.employeeId)).map((l) => `${l.action}:${l.status}`).sort()).toEqual(["In:queued", "Out:queued"]);
      expect(fake.calls).toHaveLength(0); // queued only: sending happens in the job, never in the click
    });
  });

  it("queues nothing when the link is not configured, monitoring is not published, the team is off, or ELEVATE is in fallback mode", async () => {
    const team = await makeTeam();
    const off = await person("Off", { teamId: team });
    const none = await person("None");
    await withMonitoring(async () => {
      expect((await turnOn(hr, team)).ok).toBe(true);
      // team off
      const other = await makeTeam();
      const p = await person("TeamOff", { teamId: other });
      as(p.user);
      await attendance.clockIn({});
      expect(await logOf(p.employeeId)).toHaveLength(0);
      // no team at all
      as(none.user);
      await attendance.clockIn({});
      expect(await logOf(none.employeeId)).toHaveLength(0);
      // fallback mode
      process.env.JIBBLE_MIRROR_ENABLED = "false";
      as(off.user);
      await attendance.clockIn({});
      expect(await logOf(off.employeeId)).toHaveLength(0);
      await attendance.clockOut();
      delete process.env.JIBBLE_MIRROR_ENABLED;
      // not configured
      setJibbleClient(null);
      await attendance.clockIn({});
      expect(await logOf(off.employeeId)).toHaveLength(0);
      setJibbleClient(fake);
      await attendance.clockOut();
    });
    // monitoring policy not published (outside withMonitoring)
    const late = await person("NoPolicy", { teamId: team });
    as(late.user);
    await attendance.clockIn({});
    expect(await logOf(late.employeeId)).toHaveLength(0);
  });

  it("refuses to turn the switch on until the monitoring policy is published", async () => {
    const team = await makeTeam();
    expect(await turnOn(hr, team)).toEqual({ ok: false, error: "Publish the monitoring policy before turning on Jibble screenshots." });
    expect((await turnOn(hr, team, false)).ok).toBe(true);
  });

  it("records a skipped row (and sends nothing) for a person with no Jibble match", async () => {
    await withMonitoring(async () => {
      const team = await makeTeam();
      await turnOn(hr, team);
      const lost = await person("Unmatched", { teamId: team, mapped: false });
      as(lost.user);
      await attendance.clockIn({});
      expect(await logOf(lost.employeeId)).toEqual([expect.objectContaining({ action: "In", status: "skipped", last_error: "no Jibble person matched" })]);
      await jobs.processMirrorQueue();
      expect(await logOf(lost.employeeId)).toEqual([expect.objectContaining({ action: "In", status: "skipped" })]); // still skipped, never sent
      expect(fake.calls.every((c) => c.personId !== lost.jibbleId)).toBe(true);
    });
  });

  it("uses Jibble's own breaks by default, can clock out and in for a break instead, sends only the Out when clocking out on a break, or sends no breaks", async () => {
    await withMonitoring(async () => {
      const team = await makeTeam();
      process.env.JIBBLE_BREAK_MODE = "clock";
      await turnOn(hr, team);
      const bea = await person("Bea", { teamId: team });
      as(bea.user);
      await attendance.clockIn({});
      await attendance.startBreak({ breakMinutes: 15 });
      await attendance.endBreak();
      await attendance.startBreak({});
      await attendance.clockOut(); // ends the break and the shift together
      const actionsInOrder = (await rows<{ action: string }>(sql`select action from time.jibble_link_log where employee_id = ${bea.employeeId} order by created_at`)).map((r) => r.action);
      expect(actionsInOrder).toEqual(["In", "Out", "In", "Out", "Out"]); // in, break out, break in, break out, then the shift ends

      process.env.JIBBLE_BREAK_MODE = "off";
      const cy = await person("Cy", { teamId: team });
      as(cy.user);
      await attendance.clockIn({});
      await attendance.startBreak({});
      await attendance.endBreak();
      expect((await logOf(cy.employeeId)).map((l) => l.action)).toEqual(["In"]);

      delete process.env.JIBBLE_BREAK_MODE; // the default is Jibble's own breaks
      const di = await person("Di", { teamId: team });
      as(di.user);
      await attendance.clockIn({});
      await attendance.startBreak({});
      await attendance.endBreak();
      expect((await rows<{ action: string }>(sql`select action from time.jibble_link_log where employee_id = ${di.employeeId} order by created_at`)).map((r) => r.action)).toEqual(["In", "StartBreak", "EndBreak"]);
    });
  });

  it("sends the break length when a break starts, and points the break end at the entry that started it", async () => {
    await withMonitoring(async () => {
      const team = await makeTeam();
      await turnOn(hr, team);
      const fay = await person("Fay", { teamId: team });
      as(fay.user);
      await attendance.clockIn({});
      await attendance.startBreak({ breakMinutes: 30 });
      await attendance.endBreak();
      await attendance.startBreak({}); // no time limit
      await attendance.endBreak();
      await jobs.processMirrorQueue();
      const mine = fake.calls.filter((c) => c.personId === fayJibbleId(fay.employeeId));
      expect(mine.map((c) => c.action)).toEqual(["In", "StartBreak", "EndBreak", "StartBreak", "EndBreak"]);
      expect(mine[1].options).toEqual({ breakMinutes: 30 });
      expect(mine[3].options).toEqual({ breakMinutes: null });
      // Each break end points at the entry its own break start returned (entry ids come from the fake in call order)
      expect(mine[2].options?.previousEntryId).toMatch(/^entry-/);
      expect(mine[4].options?.previousEntryId).toMatch(/^entry-/);
      expect(mine[2].options?.previousEntryId).not.toBe(mine[4].options?.previousEntryId);
    });
  });

  it("never blocks the clock when Jibble is down: the click succeeds and the call waits in the queue", async () => {
    await withMonitoring(async () => {
      const team = await makeTeam();
      await turnOn(hr, team);
      const eli = await person("Eli", { teamId: team });
      fake.fail = () => new JibbleError(503, "request refused");
      as(eli.user);
      expect((await attendance.clockIn({})).ok).toBe(true);
      await jobs.processMirrorQueue();
      expect(await logOf(eli.employeeId)).toEqual([expect.objectContaining({ action: "In", status: "queued", attempts: 1 })]);
      expect((await attendanceQueries.getClockStatus())?.state).toBe("working");
    });
  });
});

describe("sending to Jibble", () => {
  async function queued(label: string, steps: string[]) {
    const team = await makeTeam();
    const p = await person(label, { teamId: team });
    const [ev] = await rows<{ id: string }>(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_in', ${iso(HOUR)}) returning id`);
    const ids = [ev.id];
    for (let i = 1; i < steps.length; i++) {
      const [e] = await rows<{ id: string }>(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, ${i % 2 ? "clock_out" : "clock_in"}, ${iso(HOUR - i * MIN)}) returning id`);
      ids.push(e.id);
    }
    for (let i = 0; i < steps.length; i++) {
      await db.execute(sql`insert into time.jibble_link_log (employee_id, event_id, action, created_at) values (${p.employeeId}, ${ids.at(i)}, ${steps.at(i)}, now() - (${steps.length - i} * interval '1 second'))`);
    }
    return p;
  }

  it("sends waiting calls in the order the clicks happened and marks them sent", async () => {
    const p = await queued("Order", ["In", "Out"]);
    const run = await jobs.processMirrorQueue();
    expect(run.sent).toBeGreaterThanOrEqual(2);
    expect(fake.calls.filter((c) => c.personId === p.jibbleId).map((c) => c.action)).toEqual(["In", "Out"]);
    expect((await logOf(p.employeeId)).map((l) => l.status)).toEqual(["sent", "sent"]);
    await jobs.processMirrorQueue();
    expect(fake.calls.filter((c) => c.personId === p.jibbleId)).toHaveLength(2); // nothing is sent twice
  });

  it("retries network trouble with a growing delay, keeps later calls waiting, and gives up after six tries", async () => {
    const p = await queued("Retry", ["In", "Out"]);
    fake.fail = (id) => (id === p.jibbleId ? new JibbleError(null, "timeout") : null);
    const start = new Date();
    expect(await jobs.processMirrorQueue(start)).toMatchObject({ retrying: expect.any(Number) });
    const log = await logOf(p.employeeId);
    expect(log.map((l) => `${l.action}:${l.status}:${l.attempts}`)).toEqual(["In:queued:1", "Out:queued:0"]); // Out waits behind In
    const [due] = await rows<{ next: Date }>(sql`select next_attempt_at as next from time.jibble_link_log where employee_id = ${p.employeeId} and action = 'In'`);
    expect(new Date(due.next).getTime() - start.getTime()).toBeGreaterThanOrEqual(59_000);

    // not due yet: nothing happens
    await jobs.processMirrorQueue(new Date(start.getTime() + 30_000));
    expect((await logOf(p.employeeId))[0].attempts).toBe(1);

    // it comes back: the first call goes through, and the second follows in the same run
    fake.fail = () => null;
    await jobs.processMirrorQueue(new Date(start.getTime() + 2 * MIN));
    expect((await logOf(p.employeeId)).map((l) => l.status)).toEqual(["sent", "sent"]);

    // a call that never works is given up on after six tries
    const q = await queued("GiveUp", ["In"]);
    fake.fail = (id) => (id === q.jibbleId ? new JibbleError(503, "request refused") : null);
    let at = Date.now() + MIN;
    for (let i = 0; i < 6; i++) {
      await jobs.processMirrorQueue(new Date(at));
      at += 31 * MIN;
    }
    const [final] = await logOf(q.employeeId);
    expect(final).toMatchObject({ status: "failed", attempts: 6 });
    expect(final.last_error).toBe("http 503: request refused");
  });

  it("treats 'already in that state' as sent, and a refusal as final", async () => {
    const dup = await queued("Dup", ["In"]);
    const refused = await queued("Refused", ["In"]);
    fake.fail = (id) => (id === dup.jibbleId ? new JibbleError(409, "conflict") : id === refused.jibbleId ? new JibbleError(400, "request refused") : null);
    await jobs.processMirrorQueue();
    expect((await logOf(dup.employeeId))[0]).toMatchObject({ status: "sent", last_error: "already in that state" });
    expect((await logOf(refused.employeeId))[0]).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("tells HR once a day when the token is rejected, and lets HR retry a failed call", async () => {
    await db.execute(sql`delete from ops.notifications where kind = 'jibble.auth'`);
    const p = await queued("Token", ["In"]);
    fake.fail = () => new JibbleError(401, "token rejected");
    await jobs.processMirrorQueue();
    await jobs.processMirrorQueue(); // nothing left to send, and no second alert
    const alerts = await rows<{ title: string }>(sql`select title from ops.notifications where kind = 'jibble.auth' and user_id = ${hr.id}`);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe("ELEVATE cannot sign in to Jibble");

    const [row] = await rows<{ id: string }>(sql`select id from time.jibble_link_log where employee_id = ${p.employeeId}`);
    as(hr);
    expect(await actions.retryJibbleSend({ logId: randomUUID() })).toEqual({ ok: false, error: "That call was not found." });
    fake.fail = () => null;
    expect((await actions.retryJibbleSend({ logId: row.id })).ok).toBe(true);
    expect((await logOf(p.employeeId))[0]).toMatchObject({ status: "sent" });
    expect(await rows(sql`select 1 from ops.audit_log where action = 'jibble.retry' and actor_user_id = ${hr.id}`)).toHaveLength(1);
  });
});

describe("matching people to Jibble accounts", () => {
  it("matches by work email regardless of case, keeps hand-made matches, and never gives one Jibble account to two people", async () => {
    const a = await person("MatchA", { mapped: false });
    const b = await person("MatchB", { mapped: false });
    const manual = await person("MatchManual"); // already matched by hand
    const dupe = await person("MatchDupe", { mapped: false });
    const aId = randomUUID();
    const bId = randomUUID();
    fake.people = [
      { id: aId, email: a.user.email.toUpperCase(), fullName: "A", status: "Active" },
      { id: bId, email: b.user.email, fullName: "B", status: "Active" },
      { id: randomUUID(), email: manual.user.email, fullName: "M", status: "Active" }, // would override the hand-made match
      { id: bId, email: dupe.user.email, fullName: "D", status: "Active" }, // same Jibble id as B
    ];
    const result = await jobs.syncJibblePeople(fake);
    expect(result.jibblePeople).toBe(4);
    const mapOf = (e: string) => rows<{ jibble_person_id: string; matched_by: string }>(sql`select jibble_person_id, matched_by from time.jibble_people where employee_id = ${e}`);
    expect(await mapOf(a.employeeId)).toEqual([{ jibble_person_id: aId, matched_by: "email" }]);
    expect(await mapOf(manual.employeeId)).toEqual([{ jibble_person_id: manual.jibbleId, matched_by: "manual" }]);
    // B and the duplicate both claim the same Jibble account: exactly one of them gets it
    expect(await rows(sql`select 1 from time.jibble_people where jibble_person_id = ${bId}`)).toHaveLength(1);
    expect((await mapOf(b.employeeId)).length + (await mapOf(dupe.employeeId)).length).toBe(1);
  });

  it("lets HR match and unmatch by hand, refusing an account that someone else has, and only HR", async () => {
    const x = await person("HandX", { mapped: false });
    const y = await person("HandY", { mapped: false });
    const id = randomUUID();
    as(hr);
    expect((await actions.setJibblePerson({ employeeId: x.employeeId, jibblePersonId: id })).ok).toBe(true);
    expect(await actions.setJibblePerson({ employeeId: y.employeeId, jibblePersonId: id })).toEqual({ ok: false, error: "That Jibble account is already matched to someone else." });
    expect((await actions.setJibblePerson({ employeeId: y.employeeId, jibblePersonId: "not-an-id" })).ok).toBe(false);
    expect((await actions.setJibblePerson({ employeeId: x.employeeId, jibblePersonId: "" })).ok).toBe(true);
    expect(await rows(sql`select 1 from time.jibble_people where employee_id = ${x.employeeId}`)).toHaveLength(0);

    for (const role of ["team_lead", "recruiter", "executive", "employee"] as RoleSlug[]) {
      as(await makeUser("nojibble", [role]));
      expect(await actions.setJibblePerson({ employeeId: x.employeeId, jibblePersonId: id })).toEqual({ ok: false, error: NO_ACCESS });
      expect(await actions.syncJibblePeopleNow()).toEqual({ ok: false, error: NO_ACCESS });
      expect(await actions.testJibbleConnection()).toEqual({ ok: false, error: NO_ACCESS });
      await expect(queries.getJibbleOverview()).rejects.toThrow();
    }
  });

  it("tests the connection and shows HR the overview", async () => {
    fake.people = [{ id: randomUUID(), email: "x@example.com", fullName: "X", status: "Active" }];
    as(hr);
    expect(await actions.testJibbleConnection()).toEqual({ ok: true, data: { people: 1, breaks: 0 } });
    fake.breaks = [{ id: randomUUID(), name: "15 minute break", durationMinutes: 15 }];
    expect(await actions.testJibbleConnection()).toEqual({ ok: true, data: { people: 1, breaks: 1 } });
    fake.listPeople = async () => {
      throw new JibbleError(401, "token rejected");
    };
    expect(await actions.testJibbleConnection()).toEqual({ ok: false, error: "Jibble rejected the access token. It may have expired." });
    const overview = await queries.getJibbleOverview();
    expect(overview).toMatchObject({ configured: true, mode: "mirror", breakMode: "native", toleranceMinutes: 15 });
    expect(overview.people.length).toBeGreaterThan(0);
    process.env.JIBBLE_MIRROR_ENABLED = "false";
    expect((await queries.getJibbleOverview()).mode).toBe("fallback");
    setJibbleClient(null);
    expect((await queries.getJibbleOverview()).configured).toBe(false);
    expect(await actions.testJibbleConnection()).toEqual({ ok: false, error: "Jibble is not set up yet. Add the access token on the server first." });
  });
});

describe("the nightly comparison", () => {
  const yesterday = () => formatInZone(Date.now() - DAY, "America/Phoenix", "yyyy-MM-dd");
  async function workedYesterday(employeeId: string, worked: number) {
    await db.execute(sql`insert into time.attendance_days (employee_id, date, sessions, worked_minutes, break_minutes) values (${employeeId}, ${yesterday()}::date, 1, ${worked}, 30)`);
  }
  const flagsOn = async (employeeId: string) => (await rows<{ flags: string[] }>(sql`select flags from time.attendance_days where employee_id = ${employeeId} and date = ${yesterday()}::date`))[0]?.flags ?? null;

  it("flags days where Jibble and ELEVATE differ by more than 15 minutes, and only for teams that use Jibble", async () => {
    const team = await makeTeam();
    await db.execute(sql`insert into time.clock_rules (team_id, jibble_mirror) values (${team}, true)`);
    const same = await person("CmpSame", { teamId: team });
    const off = await person("CmpOff", { teamId: team });
    const under = await person("CmpUnder", { teamId: team });
    const ghost = await person("CmpGhost", { teamId: team }); // used Jibble, never clocked in ELEVATE
    const none = await person("CmpNone", { teamId: team }); // neither: no row at all
    const outside = await person("CmpOutside", { teamId: await makeTeam() }); // team without the switch
    for (const [p, minutes] of [[same, 480], [off, 480], [under, 480], [outside, 480]] as const) await workedYesterday(p.employeeId, minutes);
    const date = yesterday();
    fake.tracked = [
      { personId: same.jibbleId, date, trackedMinutes: 470 },
      { personId: off.jibbleId, date, trackedMinutes: 380 }, // 100 less
      { personId: under.jibbleId, date, trackedMinutes: 480 },
      { personId: ghost.jibbleId, date, trackedMinutes: 120 },
      { personId: outside.jibbleId, date, trackedMinutes: 10 },
    ];

    const run = await jobs.runJibbleComparison(new Date(), fake);
    expect(run.flagged).toBeGreaterThanOrEqual(2);
    expect(await flagsOn(same.employeeId)).toEqual([]);
    expect(await flagsOn(under.employeeId)).toEqual([]);
    expect(await flagsOn(off.employeeId)).toEqual(["jibble_mismatch"]);
    expect(await flagsOn(ghost.employeeId)).toEqual(["jibble_mismatch"]);
    expect(await flagsOn(none.employeeId)).toBeNull();
    expect(await flagsOn(outside.employeeId)).toEqual([]); // not compared
    expect(await rows(sql`select 1 from time.jibble_daily where employee_id = ${outside.employeeId}`)).toHaveLength(0);
    expect(await rows(sql`select jibble_minutes, elevate_minutes, flagged from time.jibble_daily where employee_id = ${off.employeeId}`)).toEqual([{ jibble_minutes: 380, elevate_minutes: 480, flagged: true }]);

    // The flag is visible to the lead and survives the nightly rebuild; fixing the gap clears it on the next comparison
    const leadPerson = await person("CmpLead", { mapped: false });
    await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${leadPerson.user.id}, 'team_lead')`);
    await db.execute(sql`update core.employees set manager_id = ${leadPerson.employeeId} where id = ${off.employeeId}`);
    as({ ...leadPerson.user, roles: ["team_lead", "employee"] });
    expect((await attendanceQueries.listFlags()).rows.some((r) => r.employeeId === off.employeeId && r.flags.includes("jibble_mismatch"))).toBe(true);
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${off.employeeId}, 'clock_in', now() - interval '26 hours'), (${off.employeeId}, 'clock_out', now() - interval '18 hours')`);
    await attendanceJobs.rebuildAttendanceDays();
    expect(await rows(sql`select 1 from time.attendance_days where employee_id = ${off.employeeId} and 'jibble_mismatch' = any(flags)`)).not.toHaveLength(0);

    fake.tracked = fake.tracked.map((t) => (t.personId === off.jibbleId ? { ...t, trackedMinutes: 475 } : t));
    await jobs.runJibbleComparison(new Date(), fake);
    expect(await rows(sql`select 1 from time.attendance_days where employee_id = ${off.employeeId} and 'jibble_mismatch' = any(flags)`)).toHaveLength(0);
  });

  it("compares against worked time plus breaks when breaks are not sent to Jibble", async () => {
    const team = await makeTeam();
    await db.execute(sql`insert into time.clock_rules (team_id, jibble_mirror) values (${team}, true)`);
    const p = await person("CmpBreaks", { teamId: team });
    await workedYesterday(p.employeeId, 450); // plus 30 minutes of breaks
    fake.tracked = [{ personId: p.jibbleId, date: yesterday(), trackedMinutes: 480 }];
    process.env.JIBBLE_BREAK_MODE = "off";
    await jobs.runJibbleComparison(new Date(), fake);
    expect(await flagsOn(p.employeeId)).toEqual([]); // 450 + 30 = 480
    process.env.JIBBLE_BREAK_MODE = "clock";
    await jobs.runJibbleComparison(new Date(), fake);
    expect(await flagsOn(p.employeeId)).toEqual(["jibble_mismatch"]); // 450 vs 480
  });

  it("keeps comparison totals for 35 days and send logs for 90", async () => {
    const p = await person("Purge");
    await db.execute(sql`insert into time.jibble_daily (employee_id, date, jibble_minutes, elevate_minutes, compared_at) values (${p.employeeId}, '2026-01-01', 1, 1, now() - interval '40 days'), (${p.employeeId}, '2026-01-02', 1, 1, now())`);
    const [e] = await rows<{ id: string }>(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_in', now()) returning id`);
    await db.execute(sql`insert into time.jibble_link_log (employee_id, event_id, action, status, created_at) values (${p.employeeId}, ${e.id}, 'In', 'sent', now() - interval '100 days')`);
    const purged = await jobs.purgeJibbleData();
    expect(purged.daily).toBeGreaterThanOrEqual(1);
    expect(purged.logs).toBeGreaterThanOrEqual(1);
    expect(await rows(sql`select 1 from time.jibble_daily where employee_id = ${p.employeeId}`)).toHaveLength(1);
  });
});

// ---- Phase 2.6: hardening ------------------------------------------------------------------------------

async function queuedRows(label: string, steps: string[], opts: { teamId?: string } = {}) {
  const p = await person(label, { teamId: opts.teamId ?? (await makeTeam()) });
  const ids: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const [e] = await rows<{ id: string }>(sql`insert into time.clock_events (employee_id, type, occurred_at, planned_break_minutes) values (${p.employeeId}, ${i % 2 ? "clock_out" : "clock_in"}, ${iso(HOUR - i * MIN)}, null) returning id`);
    ids.push(e.id);
  }
  for (let i = 0; i < steps.length; i++) {
    await db.execute(sql`insert into time.jibble_link_log (employee_id, event_id, action, created_at) values (${p.employeeId}, ${ids.at(i)}, ${steps.at(i)}, now() - (${steps.length - i} * interval '1 second'))`);
  }
  return p;
}

describe("the safety lock", () => {
  it("sends only in production, or for named test people, so a copy of the app cannot clock real people", async () => {
    await withMonitoring(async () => {
      const team = await makeTeam();
      await turnOn(hr, team);
      const a = await person("LockA", { teamId: team });
      const b = await person("LockB", { teamId: team });
      delete process.env.ELEVATE_ENV; // a laptop or staging
      as(a.user);
      await attendance.clockIn({});
      expect(await logOf(a.employeeId)).toEqual([expect.objectContaining({ action: "In", status: "skipped", last_error: "not sent: not the production environment" })]);

      process.env.JIBBLE_TEST_PERSON_IDS = `other-id, ${fayJibbleId(b.employeeId)}`; // a named test person is allowed
      as(b.user);
      await attendance.clockIn({});
      expect(await logOf(b.employeeId)).toEqual([expect.objectContaining({ action: "In", status: "queued" })]);

      // Queued before the lock was applied: the sender refuses too
      delete process.env.JIBBLE_TEST_PERSON_IDS;
      const run = await jobs.processMirrorQueue();
      expect(run.skipped).toBeGreaterThanOrEqual(1);
      expect(fake.calls.filter((c) => c.personId === fayJibbleId(b.employeeId))).toHaveLength(0);
      expect((await logOf(b.employeeId))[0]).toMatchObject({ status: "skipped", last_error: "not sent: not the production environment" });
    });
  });
});

describe("the pause switch", () => {
  it("holds everything while paused, drops stale calls on resume, and is HR only", async () => {
    const fresh = await queuedRows("PauseFresh", ["In"]);
    const old = await queuedRows("PauseOld", ["In"]);
    await db.execute(sql`update time.jibble_link_log set created_at = now() - interval '30 minutes' where employee_id = ${old.employeeId}`);
    as(hr);
    expect(await actions.setJibblePaused({ paused: true })).toEqual({ ok: true, data: { dropped: 0 } });
    expect((await queries.getJibbleOverview()).paused).toBe(true);
    expect(await jobs.processMirrorQueue()).toEqual({ sent: 0, retrying: 0, failed: 0, skipped: 0 });
    expect(fake.calls).toHaveLength(0);
    expect((await logOf(fresh.employeeId))[0].status).toBe("queued"); // still waiting

    const resumed = await actions.setJibblePaused({ paused: false });
    expect(resumed.ok && resumed.data.dropped).toBeGreaterThanOrEqual(1);
    expect((await logOf(old.employeeId))[0]).toMatchObject({ status: "skipped", last_error: "dropped: waited too long while paused" });
    expect((await logOf(fresh.employeeId))[0].status).toBe("sent"); // the recent one went out on resume
    expect(await rows(sql`select 1 from ops.audit_log where action in ('jibble.pause', 'jibble.resume') and actor_user_id = ${hr.id}`)).toHaveLength(2);

    for (const role of ["team_lead", "recruiter", "executive", "employee"] as RoleSlug[]) {
      as(await makeUser("nopause", [role]));
      expect(await actions.setJibblePaused({ paused: true })).toEqual({ ok: false, error: NO_ACCESS });
    }
  });
});

describe("when Jibble refuses a break", () => {
  it("clocks the person out instead, so screenshots still stop, and clocks them back in when the break ends", async () => {
    const p = await queuedRows("Fallback", ["StartBreak", "EndBreak"]);
    fake.fail = (id, action) => (id === fayJibbleId(p.employeeId) && action === "StartBreak" ? new JibbleError(422, "no break set up for this person in Jibble") : null);
    await jobs.processMirrorQueue();
    expect(fake.calls.filter((c) => c.personId === fayJibbleId(p.employeeId)).map((c) => c.action)).toEqual(["Out", "In"]); // out for the break, in at the end
    expect(await logOf(p.employeeId)).toEqual([
      expect.objectContaining({ action: "StartBreak", status: "sent", last_error: "no Jibble break available: clocked out instead" }),
      expect.objectContaining({ action: "EndBreak", status: "sent" }),
    ]);
    expect((await rows<{ fallback: boolean }>(sql`select fallback from time.jibble_link_log where employee_id = ${p.employeeId} order by created_at`)).map((r) => r.fallback)).toEqual([true, true]);
  });

  it("remembers a fallback break across runs, and does not fall back when the failure is Jibble being down", async () => {
    const p = await queuedRows("FallbackLater", ["StartBreak"]);
    fake.fail = (id, action) => (id === fayJibbleId(p.employeeId) && action === "StartBreak" ? new JibbleError(400, "request refused") : null);
    await jobs.processMirrorQueue();
    // The break end arrives in a later run
    const [e] = await rows<{ id: string }>(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'break_end', now()) returning id`);
    await db.execute(sql`insert into time.jibble_link_log (employee_id, event_id, action) values (${p.employeeId}, ${e.id}, 'EndBreak')`);
    fake.calls = [];
    fake.fail = () => null;
    await jobs.processMirrorQueue();
    expect(fake.calls.map((c) => c.action)).toEqual(["In"]);

    const down = await queuedRows("FallbackDown", ["StartBreak"]);
    fake.calls = [];
    fake.fail = (id) => (id === fayJibbleId(down.employeeId) ? new JibbleError(503, "request refused") : null);
    await jobs.processMirrorQueue();
    expect(fake.calls).toHaveLength(0); // retried later, not clocked out
    expect((await logOf(down.employeeId))[0]).toMatchObject({ status: "queued", attempts: 1 });
  });
});

describe("retries are careful", () => {
  it("looks at Jibble before a retry, so a call that already went through is not sent twice", async () => {
    const p = await queuedRows("Careful", ["In"]);
    const jid = fayJibbleId(p.employeeId);
    await db.execute(sql`update time.jibble_link_log set attempts = 1 where employee_id = ${p.employeeId}`);
    fake.states.set(jid, "in"); // the first try worked, we just never heard back
    await jobs.processMirrorQueue();
    expect(fake.calls.filter((c) => c.personId === jid)).toHaveLength(0);
    expect((await logOf(p.employeeId))[0]).toMatchObject({ status: "sent", last_error: "already in that state (checked)" });

    const q = await queuedRows("CarefulNot", ["In"]);
    await db.execute(sql`update time.jibble_link_log set attempts = 1 where employee_id = ${q.employeeId}`);
    fake.states.set(fayJibbleId(q.employeeId), "out"); // it did not go through: send it
    await jobs.processMirrorQueue();
    expect(fake.calls.filter((c) => c.personId === fayJibbleId(q.employeeId)).map((c) => c.action)).toEqual(["In"]);

    const r = await queuedRows("CarefulUnknown", ["In"]);
    await db.execute(sql`update time.jibble_link_log set attempts = 1 where employee_id = ${r.employeeId}`);
    fake.stateFails = true; // cannot look: send it (a 409 would still be handled)
    await jobs.processMirrorQueue();
    expect(fake.calls.filter((c) => c.personId === fayJibbleId(r.employeeId))).toHaveLength(1);
  });

  it("waits as long as Jibble asks when it says to slow down", async () => {
    const p = await queuedRows("SlowDown", ["In"]);
    fake.fail = (id) => (id === fayJibbleId(p.employeeId) ? new JibbleError(429, "slow down", null, 20 * MIN) : null);
    const start = new Date();
    await jobs.processMirrorQueue(start);
    const [row] = await rows<{ next: Date }>(sql`select next_attempt_at as next from time.jibble_link_log where employee_id = ${p.employeeId}`);
    expect(new Date(row.next).getTime() - start.getTime()).toBeGreaterThanOrEqual(19 * MIN); // longer than the one minute backoff
  });

  it("tells HR about failing calls only once three have failed, and then only once in six hours", async () => {
    await db.execute(sql`delete from ops.notifications where kind = 'jibble.failing'`);
    await db.execute(sql`delete from time.jibble_link_log where status = 'failed' and created_at > now() - interval '3 hours'`);
    const make = async (label: string) => {
      const p = await queuedRows(label, ["In"]);
      return p;
    };
    const a = await make("FailA");
    const b = await make("FailB");
    const c = await make("FailC");
    fake.fail = (id) => ([a, b, c].some((x) => fayJibbleId(x.employeeId) === id) ? new JibbleError(400, "request refused") : null);
    // The first two failures are not yet a pattern
    await db.execute(sql`update time.jibble_link_log set status = 'skipped' where employee_id = ${c.employeeId}`);
    await jobs.processMirrorQueue();
    expect(await notes(hr.id, "jibble.failing")).toHaveLength(0);
    await db.execute(sql`update time.jibble_link_log set status = 'queued' where employee_id = ${c.employeeId}`);
    await jobs.processMirrorQueue();
    expect(await notes(hr.id, "jibble.failing")).toHaveLength(1);
    const d = await make("FailD");
    fake.fail = () => new JibbleError(400, "request refused");
    await jobs.processMirrorQueue();
    expect(await notes(hr.id, "jibble.failing")).toHaveLength(1); // not again within six hours
    expect(d.employeeId).toBeTruthy();
  });
});

describe("the repair job", () => {
  async function onTeam(label: string, state: { events: [string, number, number | null][] }) {
    const team = await makeTeam();
    await db.execute(sql`insert into time.clock_rules (team_id, jibble_mirror) values (${team}, true)`);
    const p = await person(label, { teamId: team });
    for (const [type, agoMs, planned] of state.events) await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, planned_break_minutes) values (${p.employeeId}, ${type}, ${iso(agoMs)}, ${planned})`);
    return { ...p, jid: fayJibbleId(p.employeeId) };
  }
  const sent = (jid: string) => fake.calls.filter((c) => c.personId === jid);

  it("clocks Jibble in when ELEVATE says someone is working and Jibble says they are out, and out when it is the other way round", async () => {
    const working = await onTeam("RepWork", { events: [["clock_in", 40 * MIN, null]] });
    const finished = await onTeam("RepDone", { events: [["clock_in", 3 * HOUR, null], ["clock_out", 10 * MIN, null]] });
    const agreed = await onTeam("RepAgree", { events: [["clock_in", 40 * MIN, null]] });
    fake.states.set(working.jid, "out");
    fake.states.set(finished.jid, "in");
    fake.states.set(agreed.jid, "in");
    const run = await jobs.runJibbleRepair();
    expect(run.repaired).toBeGreaterThanOrEqual(2);
    expect(sent(working.jid).map((c) => c.action)).toEqual(["In"]);
    expect(sent(finished.jid).map((c) => c.action)).toEqual(["Out"]);
    expect(sent(agreed.jid)).toHaveLength(0);
    expect(await rows(sql`select 1 from time.jibble_link_log where employee_id = ${working.employeeId} and source = 'repair' and event_id is null and status = 'sent'`)).toHaveLength(1);
    // Not again straight away, even if Jibble still disagrees
    fake.calls = [];
    await jobs.runJibbleRepair();
    expect(sent(working.jid)).toHaveLength(0);
  });

  it("starts a native break in Jibble with the chosen length when ELEVATE says the person is on a break", async () => {
    const onBreak = await onTeam("RepBreak", { events: [["clock_in", 2 * HOUR, null], ["break_start", 30 * MIN, 15]] });
    fake.states.set(onBreak.jid, "in");
    await jobs.runJibbleRepair();
    expect(sent(onBreak.jid)).toEqual([expect.objectContaining({ action: "StartBreak", options: { breakMinutes: 15 } })]);
  });

  it("leaves alone a click from the last minutes, a person with a call still waiting, people who are out, and a Jibble it cannot read", async () => {
    const justNow = await onTeam("RepJust", { events: [["clock_in", MIN, null]] });
    const waiting = await onTeam("RepWait", { events: [["clock_in", 30 * MIN, null]] });
    const out = await onTeam("RepOut", { events: [["clock_in", 5 * HOUR, null], ["clock_out", 4 * HOUR, null]] });
    const unreadable = await onTeam("RepUnread", { events: [["clock_in", 30 * MIN, null]] });
    for (const p of [justNow, waiting, out, unreadable]) fake.states.set(p.jid, "out");
    const [e] = await rows<{ id: string }>(sql`select id from time.clock_events where employee_id = ${waiting.employeeId} limit 1`);
    await db.execute(sql`insert into time.jibble_link_log (employee_id, event_id, action) values (${waiting.employeeId}, ${e.id}, 'In')`);
    fake.states.delete(unreadable.jid); // unknown: no entry in Jibble
    await jobs.runJibbleRepair();
    for (const p of [justNow, waiting, out, unreadable]) expect(sent(p.jid)).toHaveLength(0);
  });

  it("does nothing when paused, in fallback mode, outside production, or when Jibble cannot be read", async () => {
    const p = await onTeam("RepOff", { events: [["clock_in", 40 * MIN, null]] });
    fake.states.set(p.jid, "out");
    fake.stateFails = true;
    expect((await jobs.runJibbleRepair()).repaired).toBe(0);
    fake.stateFails = false;
    process.env.JIBBLE_MIRROR_ENABLED = "false";
    await jobs.runJibbleRepair();
    delete process.env.JIBBLE_MIRROR_ENABLED;
    delete process.env.ELEVATE_ENV;
    await jobs.runJibbleRepair();
    process.env.ELEVATE_ENV = "production";
    as(hr);
    await actions.setJibblePaused({ paused: true });
    await jobs.runJibbleRepair();
    expect(sent(p.jid)).toHaveLength(0);
    await actions.setJibblePaused({ paused: false });
    expect(sent(p.jid).map((c) => c.action)).toEqual(["In"]); // resuming sets Jibble right
  });
});

describe("people who clock in without a Jibble account", () => {
  it("gives HR one list of who worked without screenshots, and nothing when everyone is matched", async () => {
    await db.execute(sql`delete from ops.notifications where kind = 'jibble.unmatched'`);
    await db.execute(sql`update time.jibble_link_log set created_at = now() - interval '3 days' where status = 'skipped' and last_error = 'no Jibble person matched'`);
    expect((await jobs.runJibbleUnmatchedReport()).people).toBe(0);
    expect(await notes(hr.id, "jibble.unmatched")).toHaveLength(0);

    await withMonitoring(async () => {
      const team = await makeTeam();
      await turnOn(hr, team);
      const lost = await person("NoMatchOne", { teamId: team, mapped: false });
      const lost2 = await person("NoMatchTwo", { teamId: team, mapped: false });
      for (const p of [lost, lost2]) {
        as(p.user);
        await attendance.clockIn({});
      }
    });
    const run = await jobs.runJibbleUnmatchedReport();
    expect(run.people).toBe(2);
    const [n] = await rows<{ title: string; body: string }>(sql`select title, body from ops.notifications where user_id = ${hr.id} and kind = 'jibble.unmatched'`);
    expect(n.title).toContain("2 people clocked in with no Jibble account");
    expect(n.body).toContain("NoMatchOne");
  });

  it("flags the day for the lead when screenshots could not run, but not when the only reason was the safety lock", async () => {
    const team = await makeTeam();
    await db.execute(sql`insert into time.clock_rules (team_id, jibble_mirror) values (${team}, true)`);
    const Y = formatInZone(Date.now() - 24 * HOUR, "America/Phoenix", "yyyy-MM-dd");
    const at = (time: string) => new Date(`${Y}T${time}:00-07:00`).toISOString();
    const missed = await person("ShotsMissed", { teamId: team, mapped: false });
    const locked = await person("ShotsLocked", { teamId: team });
    for (const [p, reason] of [[missed, "no Jibble person matched"], [locked, "not sent: not the production environment"]] as const) {
      const [e] = await rows<{ id: string }>(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_in', ${at("09:00")}) returning id`);
      await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_out', ${at("17:00")})`);
      await db.execute(sql`insert into time.jibble_link_log (employee_id, event_id, action, status, last_error, created_at) values (${p.employeeId}, ${e.id}, 'In', 'skipped', ${reason}, ${at("09:00:30".slice(0, 5))})`);
    }
    await attendanceJobs.rebuildAttendanceDays();
    const flagsOf = async (id: string) => (await rows<{ flags: string[] }>(sql`select flags from time.attendance_days where employee_id = ${id} and date = ${Y}::date`)).flatMap((r) => r.flags);
    expect(await flagsOf(missed.employeeId)).toContain("no_screenshots");
    expect(await flagsOf(locked.employeeId)).not.toContain("no_screenshots");
  });
});
