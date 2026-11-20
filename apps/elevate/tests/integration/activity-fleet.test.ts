import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { nextVersion } from "./release-test-helpers";

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
const device = async (employeeId: string, over: { permissionsOk?: boolean; lastSeenDaysAgo?: number | null; queue?: number; appVersion?: string } = {}) => {
  const seen = over.lastSeenDaysAgo === null ? null : new Date(Date.now() - (over.lastSeenDaysAgo ?? 0) * 86_400_000 - 60_000);
  const [d] = await rows<{ id: string }>(
    sql`insert into time.tracker_devices (employee_id, name, os, token_hash, permissions_ok, queue_size, last_seen_at, app_version) values (${employeeId}, 'PC', 'windows', ${randomUUID()}, ${over.permissionsOk ?? true}, ${over.queue ?? 0}, ${seen?.toISOString() ?? null}, ${over.appVersion ?? "999.0.0"}) returning id`,
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

  it("snaps a page past the end to the last page instead of showing an empty list", async () => {
    current.user = hr.user;
    const far = await queries.listAllDevices({ filter: "all", page: 99, pageSize: 2 });
    expect(far.rows.length).toBeGreaterThan(0);
    expect(far.page).toBe(Math.ceil(far.total / 2));
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

describe("devices that are behind the newest release", () => {
  const publishDirect = (version: string, status: "published" | "withdrawn") =>
    db.execute(sql`insert into time.tracker_releases (version, status, notes_added, created_by, published_at, published_by, withdrawn_at) values (${version}, ${status}, array['x'], ${randomUUID()}, now(), ${randomUUID()}, ${status === "withdrawn" ? sql`now()` : null})`);

  it("marks a computer on an older version as behind, includes it under 'attention', and ignores a withdrawn newer release", async () => {
    current.user = hr.user;
    const newest = await nextVersion();
    await publishDirect(newest, "published");
    await publishDirect(`${newest.split(".")[0]}.${Number(newest.split(".")[1]) + 1}.0`, "withdrawn");
    // A computer can report anything: an absurdly large number and a zero-padded one must neither crash the list nor count as behind.
    const huge = await device((await person(["employee"], "Hugever")).employeeId, { appVersion: "99999999999.0.0" });
    const padded = await device((await person(["employee"], "Padver")).employeeId, { appVersion: "0.01.0" });
    const old = await person(["employee"], "Oldver");
    const same = await person(["employee"], "Samever");
    const sim = await person(["employee"], "Simver");
    const behind = await device(old.employeeId, { appVersion: "0.0.1" }); // lower than any release the helper can make
    const upToDate = await device(same.employeeId, { appVersion: newest });
    const odd = await device(sim.employeeId, { appVersion: "0.0.0-sim" });

    const all = await queries.listAllDevices({ filter: "all", page: 1, pageSize: 100 });
    expect(all.latestVersion).toBe(newest);
    expect(all.rows.find((r) => r.id === huge)?.behind).toBe(false);
    expect(all.rows.find((r) => r.id === padded)?.behind).toBe(false);
    expect(all.rows.find((r) => r.id === behind)?.behind).toBe(true);
    expect(all.rows.find((r) => r.id === upToDate)?.behind).toBe(false);
    expect(all.rows.find((r) => r.id === odd)?.behind).toBe(false);

    const need = await queries.listAllDevices({ filter: "attention", page: 1, pageSize: 100 });
    const ids = need.rows.map((r) => r.id);
    expect(ids).toContain(behind);
    expect(ids).not.toContain(upToDate);
    expect(ids).not.toContain(odd);
    expect(ids).not.toContain(huge);
    expect(ids).not.toContain(padded);
  });
});
