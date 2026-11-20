import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for a person's own dashboard layout (hide and reorder): save, read back, replace, reset, audit, and nobody else's row.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/dashboard/layout-actions");
const service = await import("@/modules/dashboard/layout-service");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
let counter = 0;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${label}${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

describe("dashboard layout", () => {
  it("saves, reads back, replaces and resets a person's own layout, one view at a time", async () => {
    const lead = await makeUser("lead", ["team_lead"]);
    as(lead);
    expect(await service.getLayout(lead, "team_lead")).toBeNull();

    expect((await actions.saveDashboardLayout({ view: "team_lead", hidden: ["team-flags"], order: ["reviews-goals", "decisions"] })).ok).toBe(true);
    expect(await service.getLayout(lead, "team_lead")).toEqual({ hidden: ["team-flags"], order: ["reviews-goals", "decisions"] });
    expect(await service.getLayout(lead, "my_work")).toBeNull();

    expect((await actions.saveDashboardLayout({ view: "team_lead", hidden: [], order: ["decisions"] })).ok).toBe(true);
    expect(await service.getLayout(lead, "team_lead")).toEqual({ hidden: [], order: ["decisions"] });
    expect((await rows(sql`select 1 from core.dashboard_layouts where user_id = ${lead.id}`)).length).toBe(1);

    expect((await actions.resetDashboardLayout({ view: "team_lead" })).ok).toBe(true);
    expect(await service.getLayout(lead, "team_lead")).toBeNull();
  });

  it("never touches another person's layout and writes audit entries with ids only", async () => {
    const a = await makeUser("a", ["employee"]);
    const b = await makeUser("b", ["employee"]);
    as(b);
    await actions.saveDashboardLayout({ view: "my_work", hidden: ["birthdays"], order: [] });
    as(a);
    expect(await service.getLayout(a, "my_work")).toBeNull();
    await actions.saveDashboardLayout({ view: "my_work", hidden: ["todo"], order: [] });
    await actions.resetDashboardLayout({ view: "my_work" });

    expect(await service.getLayout(b, "my_work")).toEqual({ hidden: ["birthdays"], order: [] });
    const audit = await rows<{ action: string; after: Record<string, unknown> }>(sql`select action, after from ops.audit_log where actor_user_id = ${a.id} and action like 'dashboard.layout_%' order by id`);
    expect(audit.map((r) => r.action)).toEqual(["dashboard.layout_save", "dashboard.layout_reset"]);
    expect(Object.keys(audit[0].after).sort()).toEqual(["hidden", "order", "view"]);
  });

  it("refuses a layout that is not valid and saves nothing", async () => {
    const u = await makeUser("bad", ["employee"]);
    as(u);
    expect((await actions.saveDashboardLayout({ view: "my_work", hidden: ["Bad Id"], order: [] })).ok).toBe(false);
    expect((await rows(sql`select 1 from core.dashboard_layouts where user_id = ${u.id}`)).length).toBe(0);
  });
});
