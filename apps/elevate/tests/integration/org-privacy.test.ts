import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// A contractor/VA (the Employee role) does not browse other people: no People list, no name search, and the org chart shows only the
// line above them (top of the organization down to their team lead) and themselves. Everyone above that role is unchanged.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { db } = await import("@/lib/db");
const orgQueries = await import("@/modules/org/queries");
const peopleQueries = await import("@/modules/people/queries");
const { runSearch } = await import("@/modules/dashboard/search-service");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
async function person(label: string, roles: RoleSlug[], managerId: string | null) {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  const last = uniq("Zeta");
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id) values (${label}, ${last}, ${email}, 'active', ${id}, ${managerId}) returning id`);
  return { user: { id, email, roles } satisfies TestUser, employeeId: e.id, last };
}

let top: Awaited<ReturnType<typeof person>>;
let middle: Awaited<ReturnType<typeof person>>;
let lead: Awaited<ReturnType<typeof person>>;
let me: Awaited<ReturnType<typeof person>>;
let sibling: Awaited<ReturnType<typeof person>>;
let otherBranch: Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  top = await person("OrgTop", ["executive", "employee"], null);
  middle = await person("OrgMid", ["employee"], top.employeeId);
  lead = await person("OrgLead", ["team_lead", "employee"], middle.employeeId);
  me = await person("OrgMe", ["employee"], lead.employeeId);
  sibling = await person("OrgSib", ["employee"], lead.employeeId);
  otherBranch = await person("OrgOther", ["employee"], top.employeeId);
});

const chartIds = async () => (await orgQueries.getOrgChart()).map((n) => n.id);

describe("the org chart", () => {
  it("shows a VA only the line above them and themselves, never teammates or other branches", async () => {
    current.user = me.user;
    const ids = await chartIds();
    expect(ids.sort()).toEqual([top.employeeId, middle.employeeId, lead.employeeId, me.employeeId].sort());
    expect(ids).not.toContain(sibling.employeeId);
    expect(ids).not.toContain(otherBranch.employeeId);
  });

  it("keeps the line connected: each person in the chart points at the one above, and the top has no manager", async () => {
    current.user = me.user;
    const chart = await orgQueries.getOrgChart();
    const byId = new Map(chart.map((n) => [n.id, n]));
    expect(byId.get(me.employeeId)!.managerId).toBe(lead.employeeId);
    expect(byId.get(lead.employeeId)!.managerId).toBe(middle.employeeId);
    expect(byId.get(top.employeeId)!.managerId).toBeNull();
  });

  it("still shows a team lead, an executive and HR the whole chart", async () => {
    for (const u of [lead.user, top.user]) {
      current.user = u;
      const ids = await chartIds();
      expect(ids).toEqual(expect.arrayContaining([sibling.employeeId, otherBranch.employeeId, me.employeeId]));
    }
  });

  it("shows a VA with no manager just themselves", async () => {
    const alone = await person("OrgAlone", ["employee"], null);
    current.user = alone.user;
    expect(await chartIds()).toEqual([alone.employeeId]);
  });
});

describe("the People list and name search", () => {
  it("is closed to a VA", async () => {
    current.user = me.user;
    await expect(peopleQueries.listDirectory({})).rejects.toThrow();
    expect(await runSearch(me.user, sibling.last)).toEqual([]);
  });

  it("stays open to everyone above the VA role", async () => {
    for (const u of [lead.user, top.user]) {
      current.user = u;
      const { rows: list } = await peopleQueries.listDirectory({ q: sibling.last });
      expect(list.map((r: { id: string }) => r.id)).toContain(sibling.employeeId);
      expect((await runSearch(u, sibling.last)).some((h) => h.kind === "person")).toBe(true);
    }
  });
});
