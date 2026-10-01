import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for system health (Phase 2.6, part 2): job check-ins, the health check and its alert, the health page's
// numbers, and the host's own scheduler route.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const service = await import("@/modules/health/service");
const queries = await import("@/modules/health/queries");
const route = await import("@/app/api/cron/backstop/route");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
const alertsFor = (userId: string) => rows(sql`select title, body from ops.notifications where user_id = ${userId} and kind = 'system.health'`);
const jobOf = async (job: string) => (await service.jobHealth()).find((j) => j.job === job)!;

let hr: TestUser;
beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin", "employee"]);
  await db.execute(sql`delete from ops.job_runs`);
});
afterAll(() => {
  delete process.env.CRON_SECRET;
});

describe("job check-ins", () => {
  it("records a successful run, counts runs, and returns the job's result", async () => {
    expect((await jobOf("email-sender")).state).toBe("waiting");
    expect(await service.trackJob("email-sender", async () => 42)).toBe(42);
    expect(await service.trackJob("email-sender", async () => 43)).toBe(43);
    const j = await jobOf("email-sender");
    expect(j.state).toBe("ok");
    expect(j.lastSuccessAt).not.toBeNull();
    expect((await rows<{ runs: number }>(sql`select runs from ops.job_runs where job = 'email-sender'`))[0].runs).toBe(2);
  });

  it("records a failure by the error's class name only, rethrows it, and shows the job as failing", async () => {
    await service.trackJob("overbreak-alerts", async () => 1);
    class BoomError extends Error {}
    await expect(service.trackJob("overbreak-alerts", async () => { throw new BoomError("patient Jane Doe SSN 123-45-6789"); })).rejects.toThrow("patient Jane Doe");
    const [r] = await rows<{ last_error: string }>(sql`select last_error from ops.job_runs where job = 'overbreak-alerts'`);
    expect(r.last_error).toBe("Error"); // the class name, never the message
    expect(JSON.stringify(await rows(sql`select * from ops.job_runs where job = 'overbreak-alerts'`))).not.toContain("Jane");
    expect((await jobOf("overbreak-alerts")).state).toBe("failing");
  });

  it("shows a job as stopped when it has not succeeded for too long", async () => {
    await service.trackJob("quiet-session-alerts", async () => 1);
    await db.execute(sql`update ops.job_runs set last_success_at = now() - interval '2 hours' where job = 'quiet-session-alerts'`); // every 15 minutes: allowed 42
    expect((await jobOf("quiet-session-alerts")).state).toBe("late");
  });
});

describe("the health check", () => {
  it("tells HR once, not every half hour, when a job has stopped, and says which", async () => {
    await db.execute(sql`delete from ops.notifications where kind = 'system.health'`);
    await service.trackJob("jibble-repair", async () => 1);
    await db.execute(sql`update ops.job_runs set last_success_at = now() - interval '3 hours' where job = 'jibble-repair'`);
    const first = await service.runHealthCheck();
    expect(first.lateJobs).toContain("jibble-repair");
    expect(first.alerted).toBe(true);
    const alerts = await alertsFor(hr.id);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toContain("Jibble repair");
    expect((await service.runHealthCheck()).alerted).toBe(false);
    expect(await alertsFor(hr.id)).toHaveLength(1);
  });

  it("also tells HR when a call to Jibble has waited 15 minutes, but not while paused", async () => {
    await db.execute(sql`delete from ops.notifications where kind = 'system.health'`);
    await db.execute(sql`update ops.job_runs set last_success_at = now()`); // every job fine
    await db.execute(sql`delete from time.jibble_link_log where status = 'queued'`);
    const [emp] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status) values ('Wait', ${uniq("Q")}, ${`${uniq("q")}@example.com`}, 'active') returning id`);
    const [ev] = await rows<{ id: string }>(sql`insert into time.clock_events (employee_id, type) values (${emp.id}, 'clock_in') returning id`);
    await db.execute(sql`insert into time.jibble_link_log (employee_id, event_id, action, created_at) values (${emp.id}, ${ev.id}, 'In', now() - interval '20 minutes')`);
    await db.execute(sql`update time.jibble_settings set paused = true where id = 1`);
    expect((await service.runHealthCheck()).alerted).toBe(false); // paused on purpose
    await db.execute(sql`update time.jibble_settings set paused = false where id = 1`);
    const check = await service.runHealthCheck();
    expect(check.queueMinutes).toBeGreaterThanOrEqual(19);
    expect(check.alerted).toBe(true);
    expect((await alertsFor(hr.id))[0].body).toContain("has waited");
    await db.execute(sql`delete from time.jibble_link_log where employee_id = ${emp.id}`);
  });

  it("says nothing when everything is fine", async () => {
    await db.execute(sql`delete from ops.notifications where kind = 'system.health'`);
    await db.execute(sql`update ops.job_runs set last_success_at = now(), last_error_at = null`);
    const check = await service.runHealthCheck();
    expect(check).toMatchObject({ lateJobs: [], alerted: false });
    expect(await alertsFor(hr.id)).toHaveLength(0);
  });
});

describe("the health page", () => {
  it("shows HR the jobs, Jibble's queue and clock activity, and nobody else", async () => {
    as(hr);
    const health = await queries.getSystemHealth();
    expect(health.jobs.length).toBeGreaterThan(20);
    expect(health.jibble).toMatchObject({ configured: false, paused: false });
    expect(health.clock.workingNow).toBeGreaterThanOrEqual(0);
    expect(typeof health.clock.clockActionsLastHour).toBe("number");
    for (const role of ["team_lead", "recruiter", "executive", "employee"] as RoleSlug[]) {
      as(await makeUser("nohealth", [role]));
      await expect(queries.getSystemHealth()).rejects.toThrow();
    }
  });
});

describe("the host's own scheduler", () => {
  const call = (header?: string) => route.GET(new Request("http://localhost/api/cron/backstop", { headers: header ? { authorization: header } : {} }));

  it("refuses everyone when no secret is set, and anyone with the wrong one", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer anything-at-all-here")).status).toBe(401);
    process.env.CRON_SECRET = "a-long-enough-cron-secret";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer not-the-secret-at-all!!")).status).toBe(401);
  });

  it("runs the health check, the Jibble queue, the repair and missed clock-outs with the right secret", async () => {
    process.env.CRON_SECRET = "a-long-enough-cron-secret";
    const response = await call("Bearer a-long-enough-cron-secret");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; mirror: { sent: number }; repair: { checked: number }; missed: { noticed: number } };
    expect(body.ok).toBe(true);
    expect(body.mirror.sent).toBe(0); // no Jibble keys here
    expect(body.repair.checked).toBe(0);
    expect(typeof body.missed.noticed).toBe("number");
  });
});
