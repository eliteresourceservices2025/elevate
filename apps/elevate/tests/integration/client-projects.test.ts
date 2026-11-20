import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Client projects against a real database: HR adds them, a person assigned to the client picks one on the clock (web or the app), and
// the time records which client and project it belonged to.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.90, 10.0.0.1" }) }));

const { db } = await import("@/lib/db");
const people = await import("@/modules/people/actions");
const { clockForDevice } = await import("@/modules/activity/device-clock");
const { clockStateFor } = await import("@/modules/activity/ingest");
const { loadWorkLog } = await import("@/modules/attendance/work-log");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
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
async function worker() {
  const user = await makeUser("pw", ["employee"]);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values ('Pro', 'Ject', ${user.email}, 'active', ${user.id}) returning id`);
  return { user, employeeId: e.id };
}
async function client(name = uniq("Client ")) {
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${name}) returning id`);
  return c.id;
}
const assign = (employeeId: string, clientId: string) => db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${employeeId}, ${clientId}, current_date - 1)`);
async function project(clientId: string, name = uniq("Proj ")) {
  const [p] = await rows<{ id: string }>(sql`insert into core.client_projects (client_id, name) values (${clientId}, ${name}) returning id`);
  return p.id;
}

let hr: TestUser;
beforeEach(async () => {
  hr = await makeUser("hr", ["hr_admin"]);
  as(hr);
});

describe("adding projects (HR and Super Admin)", () => {
  it("adds a project to a client and audits it with ids only", async () => {
    const c = await client();
    const name = uniq("Intake ");
    const r = await people.createClientProject({ clientId: c, name });
    expect(r.ok).toBe(true);
    const [p] = await rows<{ id: string; name: string }>(sql`select id, name from core.client_projects where client_id = ${c}`);
    expect(p.name).toBe(name);
    const [a] = await rows<{ after: Record<string, unknown>; target_id: string }>(sql`select after, target_id from ops.audit_log where action = 'client.project.create' and target_id = ${p.id}`);
    expect(a.after).toEqual({ clientId: c });
  });

  it("refuses a second active project with the same name in the same client, but not in another client", async () => {
    const c = await client();
    const other = await client();
    expect((await people.createClientProject({ clientId: c, name: "Billing" })).ok).toBe(true);
    expect(await people.createClientProject({ clientId: c, name: "  billing " })).toEqual({ ok: false, error: "That client already has a project with that name." });
    expect((await people.createClientProject({ clientId: other, name: "Billing" })).ok).toBe(true);
  });

  it("renames and archives; an archived name can be used again", async () => {
    const c = await client();
    const p = await project(c, "Old name");
    expect((await people.renameClientProject({ projectId: p, name: "New name" })).ok).toBe(true);
    expect((await people.archiveClientProject({ projectId: p })).ok).toBe(true);
    const [row] = await rows<{ name: string; archived_at: string | null }>(sql`select name, archived_at from core.client_projects where id = ${p}`);
    expect(row.name).toBe("New name");
    expect(row.archived_at).not.toBeNull();
    expect((await people.createClientProject({ clientId: c, name: "New name" })).ok).toBe(true);
  });

  it("is for HR and Super Admin only", async () => {
    const c = await client();
    const w = await worker();
    as(w.user);
    expect(await people.createClientProject({ clientId: c, name: "Nope" })).toEqual({ ok: false, error: NO_ACCESS });
    const lead = await makeUser("tl", ["team_lead"]);
    as(lead);
    expect(await people.createClientProject({ clientId: c, name: "Nope" })).toEqual({ ok: false, error: NO_ACCESS });
    const sa = await makeUser("sa", ["super_admin"]);
    as(sa);
    expect((await people.createClientProject({ clientId: c, name: "Yes" })).ok).toBe(true);
  });

  it("the database never lets a project move to another client", async () => {
    const c = await client();
    const other = await client();
    const p = await project(c);
    await expect(db.execute(sql`update core.client_projects set client_id = ${other} where id = ${p}`)).rejects.toThrow();
  });
});

describe("choosing a project on the clock", () => {
  it("clock in with just a project: the client comes from it and both are recorded", async () => {
    const w = await worker();
    const c = await client();
    const c2 = await client();
    await assign(w.employeeId, c);
    await assign(w.employeeId, c2);
    const p = await project(c);
    const r = await clockForDevice(w.employeeId, "clock_in", { projectId: p });
    expect(r.ok).toBe(true);
    const [ev] = await rows<{ client_id: string; project_id: string }>(sql`select client_id, project_id from time.clock_events where employee_id = ${w.employeeId}`);
    expect(ev).toEqual({ client_id: c, project_id: p });
  });

  it("still asks a person with two clients to choose, and accepts a client with no project", async () => {
    const w = await worker();
    const c = await client();
    const c2 = await client();
    await assign(w.employeeId, c);
    await assign(w.employeeId, c2);
    expect(await clockForDevice(w.employeeId, "clock_in", {})).toEqual({ ok: false, error: "refused", message: "Choose the client you are working for." });
    const r = await clockForDevice(w.employeeId, "clock_in", { clientId: c });
    expect(r.ok).toBe(true);
    const [ev] = await rows<{ project_id: string | null }>(sql`select project_id from time.clock_events where employee_id = ${w.employeeId}`);
    expect(ev.project_id).toBeNull();
  });

  it("refuses a project of a client the person is not assigned to", async () => {
    const w = await worker();
    const mine = await client();
    const notMine = await client();
    await assign(w.employeeId, mine);
    const p = await project(notMine);
    expect(await clockForDevice(w.employeeId, "clock_in", { projectId: p })).toEqual({ ok: false, error: "refused", message: "You are not assigned to that client." });
  });

  it("refuses an archived project, a missing project, and a project that is not the chosen client's", async () => {
    const w = await worker();
    const c = await client();
    const c2 = await client();
    await assign(w.employeeId, c);
    await assign(w.employeeId, c2);
    const archived = await project(c);
    await db.execute(sql`update core.client_projects set archived_at = now() where id = ${archived}`);
    expect(await clockForDevice(w.employeeId, "clock_in", { projectId: archived })).toEqual({ ok: false, error: "refused", message: "That project is not available." });
    expect(await clockForDevice(w.employeeId, "clock_in", { projectId: randomUUID() })).toEqual({ ok: false, error: "refused", message: "That project is not available." });
    const p2 = await project(c2);
    expect(await clockForDevice(w.employeeId, "clock_in", { clientId: c, projectId: p2 })).toEqual({ ok: false, error: "refused", message: "That project does not belong to that client." });
  });

  it("switches between projects of the same client, but not to the one already open", async () => {
    const w = await worker();
    const c = await client();
    await assign(w.employeeId, c);
    const p1 = await project(c);
    const p2 = await project(c);
    expect((await clockForDevice(w.employeeId, "clock_in", { projectId: p1 })).ok).toBe(true);
    expect(await clockForDevice(w.employeeId, "switch_client", { projectId: p1 })).toEqual({ ok: false, error: "refused", message: "You are already working on that project." });
    expect((await clockForDevice(w.employeeId, "switch_client", { projectId: p2 })).ok).toBe(true);
    expect(await clockForDevice(w.employeeId, "switch_client", { clientId: c })).toMatchObject({ ok: true }); // the client with no specific project
  });

  it("the database refuses an event whose project is another client's", async () => {
    const w = await worker();
    const c = await client();
    const other = await client();
    const p = await project(other);
    await expect(db.execute(sql`insert into time.clock_events (employee_id, type, client_id, project_id) values (${w.employeeId}, 'clock_in', ${c}, ${p})`)).rejects.toThrow();
    await expect(db.execute(sql`insert into time.clock_events (employee_id, type, project_id) values (${w.employeeId}, 'clock_in', ${p})`)).rejects.toThrow();
  });
});

describe("what the app and the pages show", () => {
  it("clock-state lists the person's clients with their active projects and names the current one", async () => {
    const w = await worker();
    const cName = uniq("Acme ");
    const c = await client(cName);
    const c2 = await client();
    await assign(w.employeeId, c);
    await assign(w.employeeId, c2);
    const p1 = await project(c, "Intake");
    const p2 = await project(c, "Billing");
    const gone = await project(c, "Retired");
    await db.execute(sql`update core.client_projects set archived_at = now() where id = ${gone}`);

    const before = await clockStateFor(w.employeeId);
    expect(before.current).toBeNull();
    const listed = before.clients.find((x) => x.id === c);
    expect(listed?.projects.map((p) => p.name)).toEqual(["Billing", "Intake"]);
    expect(before.clients.find((x) => x.id === c2)?.projects).toEqual([]);

    await clockForDevice(w.employeeId, "clock_in", { projectId: p1 });
    const working = await clockStateFor(w.employeeId);
    expect(working.current).toMatchObject({ clientId: c, clientName: cName, projectId: p1, projectName: "Intake" });
    expect(working.current?.since).toBe(working.workingSince);
    await clockForDevice(w.employeeId, "switch_client", { projectId: p2 });
    const switched = await clockStateFor(w.employeeId);
    expect(switched.current).toMatchObject({ projectId: p2, projectName: "Billing" });
    expect(switched.current?.since).not.toBe(switched.workingSince);
  });

  it("the work log says which client and project, and from when to when", async () => {
    const w = await worker();
    const cName = uniq("Beta ");
    const c = await client(cName);
    await assign(w.employeeId, c);
    const p1 = await project(c, "Intake");
    const p2 = await project(c, "Billing");
    const t = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    for (const [type, at, projectId] of [
      ["clock_in", t(120), p1],
      ["switch_client", t(60), p2],
      ["clock_out", t(10), null],
    ] as const) {
      await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, client_id, project_id) values (${w.employeeId}, ${type}, ${at}, ${type === "clock_out" ? null : c}, ${projectId})`);
    }
    const log = await loadWorkLog(db, w.employeeId, Date.now() - 24 * 3_600_000, Date.now());
    expect(log.map((l) => [l.clientName, l.projectName])).toEqual([[cName, "Intake"], [cName, "Billing"]]);
    expect(log[0].to).toBe(log[1].from);
  });
});

describe("what admins see: hours review and team attendance", () => {
  it("team attendance shows who is working on which client and project, and since when", async () => {
    const w = await worker();
    const cName = uniq("Gamma ");
    const c = await client(cName);
    await assign(w.employeeId, c);
    const p = await project(c, "Intake");
    await clockForDevice(w.employeeId, "clock_in", { projectId: p });
    as(hr);
    const { listWorkingNow } = await import("@/modules/attendance/queries");
    const { rows } = await listWorkingNow();
    const mine = rows.find((r) => r.employeeId === w.employeeId);
    expect(mine?.workingOn).toMatchObject({ client: cName, project: "Intake" });
    expect(Math.abs((mine?.workingOn?.sinceMs ?? 0) - Date.now())).toBeLessThan(60_000);
  });

  it("a person with no client has no 'working on'", async () => {
    const w = await worker();
    await clockForDevice(w.employeeId, "clock_in", {});
    as(hr);
    const { listWorkingNow } = await import("@/modules/attendance/queries");
    const mine = (await listWorkingNow()).rows.find((r) => r.employeeId === w.employeeId);
    expect(mine).toBeDefined();
    expect(mine?.workingOn).toBeNull();
  });

  it("hours review lists, for each day, the client and project with exact times, and the client split stays as it was", async () => {
    const w = await worker();
    const cName = uniq("Delta ");
    const c = await client(cName);
    await assign(w.employeeId, c);
    const p1 = await project(c, "Intake");
    const p2 = await project(c, "Billing");
    const base = Date.now() - 26 * 3_600_000;
    const at = (min: number) => new Date(base + min * 60_000).toISOString();
    for (const [type, min, projectId] of [
      ["clock_in", 0, p1],
      ["switch_client", 60, p2],
      ["clock_out", 120, null],
    ] as const) {
      await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, client_id, project_id) values (${w.employeeId}, ${type}, ${at(min)}, ${type === "clock_out" ? null : c}, ${projectId})`);
    }
    const jobs = await import("@/modules/attendance/jobs");
    await jobs.rebuildAttendanceDays(new Date(), 4, w.employeeId);
    as(hr);
    const { getTeamReview } = await import("@/modules/attendance/hours-queries");
    const review = await getTeamReview(new Date(base).toISOString().slice(0, 10));
    const row = review.rows.find((r) => r.employeeId === w.employeeId);
    const day = row?.days.find((d) => d.work.length > 0);
    expect(day?.work.map((x) => [x.client, x.project])).toEqual([[cName, "Intake"], [cName, "Billing"]]);
    expect(day?.work[0].end).toBe(day?.work[1].start);
    expect(day?.clients.every((x) => x.name === cName || x.name === "No client")).toBe(true);
  });
});

describe("an open session in a wide window", () => {
  it("counts only up to now, never to the end of the window (today's day in hours review and the day pages)", async () => {
    const w = await worker();
    const c = await client();
    await assign(w.employeeId, c);
    const p = await project(c);
    await db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at, client_id, project_id) values (${w.employeeId}, 'clock_in', ${new Date(Date.now() - 30 * 60_000).toISOString()}, ${c}, ${p})`);
    const log = await loadWorkLog(db, w.employeeId, Date.now() - 3_600_000, Date.now() + 12 * 3_600_000);
    expect(log).toHaveLength(1);
    expect(log[0].to).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
