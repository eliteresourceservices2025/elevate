import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Who can pick a project: with no people on a project, everyone assigned to its client sees it (as before); with people on it, only
// them, on the clock, in the app's clock state, and on the server when they clock in.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.91, 10.0.0.1" }) }));

const { db } = await import("@/lib/db");
const people = await import("@/modules/people/actions");
const { listClientProjectPeopleForAdmin } = await import("@/modules/people/queries");
const { clockForDevice } = await import("@/modules/activity/device-clock");
const { clockStateFor } = await import("@/modules/activity/ingest");

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
async function client() {
  const [c] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Client ")}) returning id`);
  return c.id;
}
const assign = (employeeId: string, clientId: string) => db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${employeeId}, ${clientId}, current_date - 1)`);
async function project(clientId: string, name = uniq("Proj ")) {
  const [p] = await rows<{ id: string }>(sql`insert into core.client_projects (client_id, name) values (${clientId}, ${name}) returning id`);
  return p.id;
}
const projectNames = async (employeeId: string, clientId: string) => (await clockStateFor(employeeId)).clients.find((c) => c.id === clientId)?.projects.map((p) => p.name) ?? [];

let hr: TestUser;
beforeEach(async () => {
  hr = await makeUser("hr", ["hr_admin"]);
  as(hr);
});

describe("choosing who can pick a project", () => {
  it("a project with nobody listed is open to everyone assigned to the client", async () => {
    const [a, b] = [await worker(), await worker()];
    const c = await client();
    await assign(a.employeeId, c);
    await assign(b.employeeId, c);
    await project(c, "Open");
    expect(await projectNames(a.employeeId, c)).toEqual(["Open"]);
    expect(await projectNames(b.employeeId, c)).toEqual(["Open"]);
  });

  it("once people are listed, only they see it; the clock refuses everyone else", async () => {
    const [a, b] = [await worker(), await worker()];
    const c = await client();
    await assign(a.employeeId, c);
    await assign(b.employeeId, c);
    const p = await project(c, "Intake");
    const r = await people.setClientProjectPeople({ projectId: p, employeeIds: [a.employeeId] });
    expect(r.ok).toBe(true);
    expect(await projectNames(a.employeeId, c)).toEqual(["Intake"]);
    expect(await projectNames(b.employeeId, c)).toEqual([]);
    expect(await clockForDevice(b.employeeId, "clock_in", { clientId: c, projectId: p })).toEqual({ ok: false, error: "refused", message: "That project is not available." });
    expect((await clockForDevice(a.employeeId, "clock_in", { clientId: c, projectId: p })).ok).toBe(true);
  });

  it("clearing the list opens the project to everyone on the client again", async () => {
    const [a, b] = [await worker(), await worker()];
    const c = await client();
    await assign(a.employeeId, c);
    await assign(b.employeeId, c);
    const p = await project(c, "Intake");
    await people.setClientProjectPeople({ projectId: p, employeeIds: [a.employeeId] });
    expect(await projectNames(b.employeeId, c)).toEqual([]);
    expect((await people.setClientProjectPeople({ projectId: p, employeeIds: [] })).ok).toBe(true);
    expect(await projectNames(b.employeeId, c)).toEqual(["Intake"]);
  });

  it("replaces the list (not adds to it) and the admin view shows who is on each project", async () => {
    const [a, b] = [await worker(), await worker()];
    const c = await client();
    await assign(a.employeeId, c);
    await assign(b.employeeId, c);
    const p = await project(c, "Intake");
    await people.setClientProjectPeople({ projectId: p, employeeIds: [a.employeeId] });
    await people.setClientProjectPeople({ projectId: p, employeeIds: [b.employeeId] });
    const view = await listClientProjectPeopleForAdmin();
    expect(view.members[p]).toEqual([b.employeeId]);
    expect(view.clientPeople[c].map((x) => x.id).sort()).toEqual([a.employeeId, b.employeeId].sort());
  });

  it("only people assigned to the project's client can be listed, only active people, and not on an archived project", async () => {
    const a = await worker();
    const stranger = await worker();
    const c = await client();
    await assign(a.employeeId, c);
    const p = await project(c, "Intake");
    expect(await people.setClientProjectPeople({ projectId: p, employeeIds: [stranger.employeeId] })).toEqual({ ok: false, error: "Only people assigned to this client can be added." });
    await db.execute(sql`update core.client_projects set archived_at = now() where id = ${p}`);
    expect(await people.setClientProjectPeople({ projectId: p, employeeIds: [a.employeeId] })).toEqual({ ok: false, error: "That project was not found." });
  });

  it("is for HR and Super Admin only, and the audit row carries ids and a count, never names", async () => {
    const a = await worker();
    const c = await client();
    await assign(a.employeeId, c);
    const p = await project(c, "Intake");
    as(a.user);
    expect(await people.setClientProjectPeople({ projectId: p, employeeIds: [a.employeeId] })).toEqual({ ok: false, error: NO_ACCESS });
    as(await makeUser("tl", ["team_lead"]));
    expect(await people.setClientProjectPeople({ projectId: p, employeeIds: [a.employeeId] })).toEqual({ ok: false, error: NO_ACCESS });
    as(await makeUser("sa", ["super_admin"]));
    expect((await people.setClientProjectPeople({ projectId: p, employeeIds: [a.employeeId] })).ok).toBe(true);
    const [row] = await rows<{ after: Record<string, unknown> }>(sql`select after from ops.audit_log where action = 'client.project.people' and target_id = ${p}`);
    expect(row.after).toEqual({ clientId: c, count: 1 });
  });
});
