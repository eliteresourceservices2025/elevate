import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { JibbleClient } from "@/modules/jibble/http-client";
import { checkWorkingMismatch } from "@/modules/jibble/working-mismatch-check";
import { processMirrorQueue, runJibbleRepair } from "@/modules/jibble/jobs";

async function setup(clockIn = true) {
  const userId = randomUUID();
  const email = `${userId}@example.com`;
  const jibbleId = randomUUID();
  await db.execute(sql`insert into core.users (id, email) values (${userId}, ${email})`);
  const [employee] = (await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values ('Checker', ${randomUUID()}, ${email}, 'active', ${userId}) returning id`)) as unknown as { id: string }[];
  await db.execute(sql`insert into time.jibble_people (employee_id, jibble_person_id, matched_by) values (${employee.id}, ${jibbleId}, 'manual')`);
  if (clockIn) await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${employee.id}, 'clock_in', now() - interval '30 minutes')`);
  process.env.JIBBLE_SELF_TEST_EMAILS = email;
  process.env.JIBBLE_TEST_PERSON_IDS = jibbleId;
  delete process.env.ELEVATE_ENV;
  delete process.env.JIBBLE_MIRROR_ENABLED;
  const fake: JibbleClient = {
    listPeople: async () => [], listBreaks: async () => [], dailyTracked: async () => [],
    latestState: async () => "out", clock: async () => { throw new Error("unexpected send"); },
  };
  return { employeeId: employee.id, userId, fake };
}

afterEach(() => { delete process.env.JIBBLE_SELF_TEST_EMAILS; delete process.env.JIBBLE_TEST_PERSON_IDS; delete process.env.JIBBLE_COORDINATION_ENABLED; });

describe("working Jibble mismatch check", () => {
  it("reports a confirmed mismatch once and closes it when the observed states align", async () => {
    const p = await setup();
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("checked");
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("checked");
    const notices = (await db.execute(sql`select id from ops.notifications where user_id = ${p.userId} and kind = 'jibble.working_mismatch'`)) as unknown as unknown[];
    expect(notices).toHaveLength(1);
    p.fake.latestState = async () => "in";
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("checked");
    const [issue] = (await db.execute(sql`select resolved_at from time.jibble_mismatches where employee_id = ${p.employeeId}`)) as unknown as { resolved_at: Date | null }[];
    expect(issue.resolved_at).not.toBeNull();
  });

  it("does not report when an ELEVATE clock event changes while Jibble is being checked", async () => {
    const p = await setup();
    p.fake.latestState = async () => {
      await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_out', now())`);
      return "out";
    };
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("skipped");
    const issues = (await db.execute(sql`select id from time.jibble_mismatches where employee_id = ${p.employeeId}`)) as unknown as unknown[];
    expect(issues).toHaveLength(0);
  });

  it("closes a working-state issue when the person goes on break without claiming Jibble aligned", async () => {
    const p = await setup();
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("checked");
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'break_start', now() - interval '5 minutes')`);
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("checked");
    const [issue] = (await db.execute(sql`select resolution from time.jibble_mismatches where employee_id = ${p.employeeId} and family = 'working'`)) as unknown as { resolution: string | null }[];
    expect(issue.resolution).toBe("ELEVATE on break");
  });

  it("does not guess an unavailable Jibble state or check someone outside the allowed test account", async () => {
    const p = await setup();
    p.fake.latestState = async () => { throw new Error("unavailable"); };
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("unknown");
    delete process.env.JIBBLE_TEST_PERSON_IDS;
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("skipped");
  });

  it("does not notify when the Jibble mapping changes during the state lookup", async () => {
    const p = await setup();
    p.fake.latestState = async () => {
      await db.execute(sql`update time.jibble_people set jibble_person_id = ${randomUUID()} where employee_id = ${p.employeeId}`);
      return "out";
    };
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("skipped");
    const issues = (await db.execute(sql`select id from time.jibble_mismatches where employee_id = ${p.employeeId}`)) as unknown as unknown[];
    expect(issues).toHaveLength(0);
  });

  it("does not check while an ELEVATE call is waiting to be sent", async () => {
    const p = await setup();
    await db.execute(sql`insert into time.jibble_link_log (employee_id, action, status) values (${p.employeeId}, 'In', 'queued')`);
    let called = false;
    p.fake.latestState = async () => { called = true; return "out"; };
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("skipped");
    expect(called).toBe(false);
  });

  it("records a possible Jibble-only start without creating hours, and escalates after ten minutes", async () => {
    const p = await setup();
    const leadId = randomUUID();
    const email = `${leadId}@example.com`;
    await db.execute(sql`insert into core.users (id, email) values (${leadId}, ${email})`);
    const [lead] = (await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Lead', ${randomUUID()}, ${email}, 'active', ${leadId}) returning id`)) as unknown as { id: string }[];
    await db.execute(sql`update core.employees set manager_id = ${lead.id} where id = ${p.employeeId}`);
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_out', now() - interval '10 minutes')`);
    const now = new Date();
    p.fake.latestEntry = async () => ({ id: "external-entry", state: "in", time: new Date(now.getTime() - 5 * 60_000).toISOString() });
    expect(await checkWorkingMismatch(p.employeeId, p.fake, now)).toBe("checked");
    expect(await db.execute(sql`select 1 from time.jibble_mismatches where employee_id = ${p.employeeId} and kind = 'possible_jibble_only'`)).toHaveLength(1);
    expect(await db.execute(sql`select 1 from time.clock_corrections where employee_id = ${p.employeeId} and origin = 'jibble'`)).toHaveLength(0);
    expect(await db.execute(sql`select 1 from ops.notifications where user_id = ${p.userId} and kind = 'jibble.out_mismatch'`)).toHaveLength(1);
    expect(await db.execute(sql`select 1 from ops.notifications where user_id = ${leadId} and kind = 'jibble.out_mismatch'`)).toHaveLength(0);
    expect(await checkWorkingMismatch(p.employeeId, p.fake, new Date(now.getTime() + 11 * 60_000))).toBe("checked");
    expect(await db.execute(sql`select 1 from ops.notifications where user_id = ${leadId} and kind = 'jibble.out_mismatch'`)).toHaveLength(1);
    expect(await db.execute(sql`select 1 from ops.notifications where user_id = ${p.userId} and kind = 'jibble.out_mismatch'`)).toHaveLength(1);
    p.fake.latestEntry = async () => ({ id: "later-out", state: "out", time: new Date(now.getTime() + 12 * 60_000).toISOString() });
    expect(await checkWorkingMismatch(p.employeeId, p.fake, new Date(now.getTime() + 13 * 60_000))).toBe("checked");
    expect(await db.execute(sql`select 1 from time.jibble_mismatches where employee_id = ${p.employeeId} and kind = 'possible_jibble_only' and resolved_at is null and jibble_entry_id = 'external-entry'`)).toHaveLength(1);
  });

  it("also finds a possible Jibble-only start when ELEVATE has no clock events", async () => {
    const p = await setup(false);
    p.fake.latestEntry = async () => ({ id: "external-first-entry", state: "in", time: new Date(Date.now() - 5 * 60_000).toISOString() });
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("checked");
    expect(await db.execute(sql`select 1 from time.jibble_mismatches where employee_id = ${p.employeeId} and kind = 'possible_jibble_only'`)).toHaveLength(1);
  });

  it("creates only one pending correction for a stable Desktop entry, without adding attendance", async () => {
    const p = await setup(false);
    process.env.JIBBLE_COORDINATION_ENABLED = "true";
    const now = new Date();
    const at = new Date(now.getTime() - 5 * 60_000).toISOString();
    const entryId = randomUUID();
    p.fake.latestEntry = async () => ({ id: entryId, state: "in", time: at });
    p.fake.entryEvidence = async (personId) => ({ id: entryId, personId, state: "in", time: at, createdAt: at, updatedAt: at, clientType: "Desktop", elevateOrigin: false, hasDeviceEvidence: true });
    expect(await checkWorkingMismatch(p.employeeId, p.fake, now)).toBe("checked");
    expect(await checkWorkingMismatch(p.employeeId, p.fake, now)).toBe("checked");
    const proposals = (await db.execute(sql`select requested_by, origin, status from time.clock_corrections where employee_id = ${p.employeeId} and source_jibble_entry_id = ${entryId}`)) as unknown as { requested_by: string | null; origin: string; status: string }[];
    expect(proposals).toEqual([{ requested_by: null, origin: "jibble", status: "pending" }]);
    expect(await db.execute(sql`select 1 from time.v_clock_events where employee_id = ${p.employeeId}`)).toHaveLength(0);
  });

  it("leaves edited or delayed entries for review instead of proposing attendance", async () => {
    const p = await setup(false);
    process.env.JIBBLE_COORDINATION_ENABLED = "true";
    const now = new Date();
    const at = new Date(now.getTime() - 5 * 60_000).toISOString();
    const entryId = randomUUID();
    p.fake.latestEntry = async () => ({ id: entryId, state: "in", time: at });
    p.fake.entryEvidence = async (personId) => ({ id: entryId, personId, state: "in", time: at, createdAt: at, updatedAt: new Date(Date.parse(at) + 1000).toISOString(), clientType: "Desktop", elevateOrigin: false, hasDeviceEvidence: true });
    expect(await checkWorkingMismatch(p.employeeId, p.fake, now)).toBe("checked");
    expect(await db.execute(sql`select 1 from time.clock_corrections where employee_id = ${p.employeeId} and origin = 'jibble'`)).toHaveLength(0);
    expect(await db.execute(sql`select 1 from time.jibble_mismatches where employee_id = ${p.employeeId} and kind = 'possible_jibble_only'`)).toHaveLength(1);
  });

  it("includes an eligible Jibble-only person in the experimental scheduled check", async () => {
    const p = await setup(false);
    process.env.JIBBLE_COORDINATION_ENABLED = "true";
    p.fake.latestEntry = async () => ({ id: "scheduled-external-entry", state: "in", time: new Date(Date.now() - 5 * 60_000).toISOString() });
    await runJibbleRepair(new Date(), p.fake);
    expect(await db.execute(sql`select 1 from time.jibble_mismatches where employee_id = ${p.employeeId} and kind = 'possible_jibble_only'`)).toHaveLength(1);
  });

  it("keeps an older Jibble entry after an ELEVATE clock-out for review", async () => {
    const p = await setup();
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_out', now() - interval '10 minutes')`);
    p.fake.latestEntry = async () => ({ id: "older-entry", state: "in", time: new Date(Date.now() - 15 * 60_000).toISOString() });
    expect(await checkWorkingMismatch(p.employeeId, p.fake)).toBe("checked");
    expect(await db.execute(sql`select 1 from time.jibble_mismatches where employee_id = ${p.employeeId} and kind = 'elevate_out_jibble_in'`)).toHaveLength(1);
  });

  it("stops Jibble after a verified recent ELEVATE clock-out without adding attendance", async () => {
    const p = await setup();
    process.env.JIBBLE_COORDINATION_ENABLED = "true";
    const now = new Date();
    const clockOut = new Date(now.getTime() - 10 * 60_000).toISOString();
    const at = new Date(now.getTime() - 15 * 60_000).toISOString();
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, created_at, source) values (${p.employeeId}, 'clock_out', ${clockOut}::timestamptz, ${clockOut}::timestamptz, 'web')`);
    const id = randomUUID();
    p.fake.latestEntry = async () => ({ id, state: "in", time: at });
    p.fake.entryEvidence = async (personId) => ({ id, personId, state: "in", time: at, createdAt: at, updatedAt: at, clientType: "Desktop", elevateOrigin: false, hasDeviceEvidence: true });
    let calls = 0;
    p.fake.clock = async (_personId, action) => { expect(action).toBe("Out"); calls += 1; return { entryId: randomUUID() }; };
    expect(await checkWorkingMismatch(p.employeeId, p.fake, now)).toBe("checked");
    expect(calls).toBe(1);
    expect(await db.execute(sql`select 1 from time.jibble_link_log where employee_id = ${p.employeeId} and source = 'repair' and action = 'Out' and status = 'sent'`)).toHaveLength(1);
    expect(await db.execute(sql`select 1 from time.v_clock_events where employee_id = ${p.employeeId}`)).toHaveLength(2);
  });

  it("does not stop Jibble if ELEVATE clocks in during the final Jibble lookup", async () => {
    const p = await setup();
    process.env.JIBBLE_COORDINATION_ENABLED = "true";
    const now = new Date();
    const clockOut = new Date(now.getTime() - 10 * 60_000).toISOString();
    const at = new Date(now.getTime() - 15 * 60_000).toISOString();
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, created_at, source) values (${p.employeeId}, 'clock_out', ${clockOut}::timestamptz, ${clockOut}::timestamptz, 'web')`);
    const id = randomUUID();
    let lookups = 0;
    p.fake.latestEntry = async () => {
      lookups += 1;
      if (lookups === 3) await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_in', now())`);
      return { id, state: "in", time: at };
    };
    p.fake.entryEvidence = async (personId) => ({ id, personId, state: "in", time: at, createdAt: at, updatedAt: at, clientType: "Desktop", elevateOrigin: false, hasDeviceEvidence: true });
    let calls = 0;
    p.fake.clock = async () => { calls += 1; return { entryId: null }; };
    expect(await checkWorkingMismatch(p.employeeId, p.fake, now)).toBe("skipped");
    expect(calls).toBe(0);
  });

  it("keeps a failed stop uncertain and notifies the person without retrying", async () => {
    const p = await setup();
    process.env.JIBBLE_COORDINATION_ENABLED = "true";
    const now = new Date();
    const clockOut = new Date(now.getTime() - 10 * 60_000).toISOString();
    const at = new Date(now.getTime() - 15 * 60_000).toISOString();
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, created_at, source) values (${p.employeeId}, 'clock_out', ${clockOut}::timestamptz, ${clockOut}::timestamptz, 'web')`);
    const id = randomUUID();
    p.fake.latestEntry = async () => ({ id, state: "in", time: at });
    p.fake.entryEvidence = async (personId) => ({ id, personId, state: "in", time: at, createdAt: at, updatedAt: at, clientType: "Desktop", elevateOrigin: false, hasDeviceEvidence: true });
    let calls = 0;
    p.fake.clock = async () => { calls += 1; throw new Error("timeout"); };
    expect(await checkWorkingMismatch(p.employeeId, p.fake, now)).toBe("unknown");
    expect(await checkWorkingMismatch(p.employeeId, p.fake, now)).toBe("skipped");
    await db.execute(sql`insert into time.jibble_link_log (employee_id, action, status) values (${p.employeeId}, 'In', 'queued')`);
    await processMirrorQueue(new Date(), p.fake, { employeeId: p.employeeId });
    expect(calls).toBe(1);
    expect(await db.execute(sql`select 1 from time.jibble_operation_guard where employee_id = ${p.employeeId} and phase = 'uncertain'`)).toHaveLength(1);
    expect(await db.execute(sql`select 1 from ops.notifications where user_id = ${p.userId} and kind = 'jibble.stop_uncertain'`)).toHaveLength(1);
  });

  it("sends a new ELEVATE clock-in after an in-flight guarded stop completes", async () => {
    const p = await setup();
    process.env.JIBBLE_COORDINATION_ENABLED = "true";
    const now = new Date();
    const clockOut = new Date(now.getTime() - 10 * 60_000).toISOString();
    const at = new Date(now.getTime() - 15 * 60_000).toISOString();
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, created_at, source) values (${p.employeeId}, 'clock_out', ${clockOut}::timestamptz, ${clockOut}::timestamptz, 'web')`);
    const id = randomUUID();
    p.fake.latestEntry = async () => ({ id, state: "in", time: at });
    p.fake.entryEvidence = async (personId) => ({ id, personId, state: "in", time: at, createdAt: at, updatedAt: at, clientType: "Desktop", elevateOrigin: false, hasDeviceEvidence: true });
    let started!: () => void;
    let resume!: () => void;
    const callStarted = new Promise<void>((resolve) => { started = resolve; });
    const waiting = new Promise<void>((resolve) => { resume = resolve; });
    const actions: string[] = [];
    p.fake.clock = async (_personId, action) => { actions.push(action); if (action === "Out") { started(); await waiting; } return { entryId: randomUUID() }; };
    const running = checkWorkingMismatch(p.employeeId, p.fake, now);
    try {
      await callStarted;
      const [event] = (await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${p.employeeId}, 'clock_in', now()) returning id`)) as unknown as { id: string }[];
      await db.execute(sql`insert into time.jibble_link_log (employee_id, event_id, action, status) values (${p.employeeId}, ${event.id}, 'In', 'queued')`);
    } finally { resume(); }
    expect(await running).toBe("checked");
    expect(actions).toEqual(["Out", "In"]);
  });
});
