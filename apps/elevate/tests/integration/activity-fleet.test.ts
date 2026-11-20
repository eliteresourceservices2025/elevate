import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// The devices list for HR: who needs attention, paging, and signing a computer out.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const queries = await import("@/modules/activity/queries");
const actions = await import("@/modules/activity/actions");

const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
let counter = 0;
async function person(roles: RoleSlug[], first = "Fleet") {
  const id = randomUUID();
  const email = `fl${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id) values (${first}, 'Device', ${email}, 'active', ${id}) returning id`);
  return { user: { id, email, roles }, employeeId: e.id };
}
const device = async (employeeId: string, over: { permissionsOk?: boolean; lastSeenDaysAgo?: number | null; queue?: number } = {}) => {
  const seen = over.lastSeenDaysAgo === null ? null : new Date(Date.now() - (over.lastSeenDaysAgo ?? 0) * 86_400_000 - 60_000);
  const [d] = await rows<{ id: string }>(
    sql`insert into time.tracker_devices (employee_id, name, os, token_hash, permissions_ok, queue_size, last_seen_at) values (${employeeId}, 'PC', 'windows', ${randomUUID()}, ${over.permissionsOk ?? true}, ${over.queue ?? 0}, ${seen?.toISOString() ?? null}) returning id`,
  );
  return d.id;
};

let hr: Awaited<ReturnType<typeof person>>;
let healthy = "";
let noPerm = "";
let stale = "";
let backlog = "";

beforeAll(async () => {
  hr = await person(["hr_admin", "employee"]);
  const a = await person(["employee"], "Healthy");
  const b = await person(["employee"], "Noperm");
  const c = await person(["employee"], "Stale");
  const d = await person(["employee"], "Backlog");
  healthy = await device(a.employeeId);
  noPerm = await device(b.employeeId, { permissionsOk: false });
  stale = await device(c.employeeId, { lastSeenDaysAgo: 3 });
  backlog = await device(d.employeeId, { queue: 500 });
});

describe("listAllDevices", () => {
  it("lists every computer for HR with the person's name", async () => {
    current.user = hr.user;
    const all = await queries.listAllDevices({ filter: "all", page: 1, pageSize: 100 });
    expect(all.total).toBeGreaterThanOrEqual(4);
    expect(all.rows.find((r) => r.id === healthy)?.person).toMatch(/Healthy/);
  });

  it("'attention' shows missing permissions, silence for a day or more, and a big backlog, but not a healthy computer", async () => {
    current.user = hr.user;
    const need = await queries.listAllDevices({ filter: "attention", page: 1, pageSize: 100 });
    const ids = need.rows.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([noPerm, stale, backlog]));
    expect(ids).not.toContain(healthy);
  });

  it("pages the list", async () => {
    current.user = hr.user;
    const first = await queries.listAllDevices({ filter: "all", page: 1, pageSize: 2 });
    const second = await queries.listAllDevices({ filter: "all", page: 2, pageSize: 2 });
    expect(first.rows).toHaveLength(2);
    expect(second.rows.length).toBeGreaterThan(0);
    expect(second.rows.map((r) => r.id)).not.toEqual(expect.arrayContaining(first.rows.map((r) => r.id)));
  });

  it("is refused to everyone but HR and Super Admin", async () => {
    current.user = (await person(["team_lead", "employee"])).user;
    await expect(queries.listAllDevices({ filter: "all", page: 1, pageSize: 25 })).rejects.toThrow();
  });

  it("drops a computer from 'attention' once it is signed out", async () => {
    current.user = hr.user;
    expect((await actions.revokeDevice({ deviceId: noPerm })).ok).toBe(true);
    const need = await queries.listAllDevices({ filter: "attention", page: 1, pageSize: 100 });
    expect(need.rows.map((r) => r.id)).not.toContain(noPerm);
    const all = await queries.listAllDevices({ filter: "all", page: 1, pageSize: 100 });
    expect(all.rows.find((r) => r.id === noPerm)?.status).toBe("revoked");
  });
});
