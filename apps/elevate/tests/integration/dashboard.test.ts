import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Real-database tests for the dashboard (feed queries with raw SQL, who sees what). Fake people only. The database is shared with
// the other test files, so anything company-wide is checked for "does not fail and respects the scope", not for exact totals.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const feed = await import("@/modules/dashboard/feed-queries");
const queries = await import("@/modules/dashboard/queries");
const search = await import("@/modules/dashboard/search-service");
const { todayInZone } = await import("@/modules/org/service");

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
  for (const r of new Set<RoleSlug>(["employee", ...roles])) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles: [...new Set<RoleSlug>(["employee", ...roles])] };
}

async function person(first: string, opts: { user?: TestUser; manager?: string; start?: string }) {
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, start_date)
    values (${first}, 'Dashboard', ${`${uniq(first.toLowerCase())}@example.com`}, 'active', ${opts.user?.id ?? null}, ${opts.manager ?? null}, ${opts.start ?? null}) returning id`);
  return e.id;
}

let hr: TestUser;
let lead: TestUser;
let otherLead: TestUser;
let exec: TestUser;
let employee: TestUser;
let recruiter: TestUser;
const ANNIVERSARY_FIRST = `Zqanniv${Date.now().toString(36)}`;

beforeAll(async () => {
  hr = await makeUser("dash-hr", ["hr_admin"]);
  lead = await makeUser("dash-lead", ["team_lead"]);
  otherLead = await makeUser("dash-lead2", ["team_lead"]);
  exec = await makeUser("dash-exec", ["executive"]);
  employee = await makeUser("dash-emp", []);
  recruiter = await makeUser("dash-rec", ["recruiter"]);

  const leadEmp = await person("Zqlead", { user: lead });
  await person("Zqother", { user: otherLead });
  // A person under `lead` whose work anniversary (2 years) is today
  const [y, md] = [Number(todayInZone().slice(0, 4)), todayInZone().slice(5)];
  await person(ANNIVERSARY_FIRST, { manager: leadEmp, start: `${y - 2}-${md === "02-29" ? "02-28" : md}` });
});

describe("the feed queries run for every role and respect scope", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: attention, approvals and who-is-out do not fail`, async () => {
      const u = await makeUser(`dash-${role}`, [role]);
      as(u);
      for (const lens of ["admin", "hr", "executive", "team_lead", "recruiter", "my_work"] as const) {
        await expect(feed.getAttention(lens)).resolves.toBeInstanceOf(Array);
        await expect(queries.getKpis(lens)).resolves.toBeInstanceOf(Array);
      }
      await expect(feed.getApprovalQueue()).resolves.toBeInstanceOf(Array);
      await expect(feed.getWhosOut()).resolves.not.toBeUndefined();
    });
  }

  it("an employee has nothing to approve and no key numbers, whatever view is asked for", async () => {
    as(employee);
    expect(await feed.getApprovalQueue()).toEqual([]);
    for (const lens of ["admin", "hr", "executive", "team_lead", "recruiter"] as const) expect(await queries.getKpis(lens)).toEqual([]);
    const items = await feed.getAttention("hr");
    expect(items.filter((i) => ["docs-expired", "docs-soon", "jobs-late", "change-requests"].includes(i.id))).toEqual([]);
  });

  it("the HR view has the headcount cards and the executive gets counts, never names", async () => {
    as(hr);
    expect((await queries.getKpis("hr")).map((k) => k.id)).toEqual(expect.arrayContaining(["people", "onboarding", "clocked-in", "approvals"]));
    as(exec);
    expect((await queries.getKpis("executive")).map((k) => k.id)).toEqual(expect.arrayContaining(["people", "joined", "left"]));
    const out = await feed.getWhosOut();
    expect(out?.mode).toBe("counts");
    expect(out?.days.every((d) => d.names.length === 0)).toBe(true);
    expect(out?.anniversaries).toEqual([]);
  });
});

describe("work anniversaries follow the profile scope", () => {
  it("HR and the person's lead see it, another lead and an employee do not", async () => {
    for (const [who, expected] of [[hr, true], [lead, true], [otherLead, false], [employee, false], [recruiter, false]] as const) {
      as(who);
      const out = await feed.getWhosOut();
      const found = (out?.anniversaries ?? []).some((a) => a.name.includes(ANNIVERSARY_FIRST));
      expect(found, who.email).toBe(expected);
    }
    as(hr);
    expect((await feed.getWhosOut())?.anniversaries.find((a) => a.name.includes(ANNIVERSARY_FIRST))?.years).toBe(2);
  });
});

describe("search follows each source's own rules", () => {
  it("everyone finds a colleague by name; HR gets a profile link, others the directory", async () => {
    as(hr);
    const forHr = await search.runSearch(hr, ANNIVERSARY_FIRST);
    expect(forHr.find((h) => h.kind === "person")?.href).toMatch(/^\/people\/[0-9a-f-]{36}$/);
    as(employee);
    const forEmployee = await search.runSearch(employee, ANNIVERSARY_FIRST);
    expect(forEmployee.find((h) => h.kind === "person")?.href).toMatch(/^\/people\?q=/);
  });

  it("applicants are found by HR and recruiters only", async () => {
    const [opening] = await rows<{ id: string }>(sql`insert into talent.job_openings (title, description, status) values ('Dash search job', 'x', 'closed') returning id`);
    const name = `Zqapplicant ${uniq("x")}`;
    const [c] = await rows<{ id: string }>(sql`insert into talent.candidates (email, full_name) values (${`${uniq("cand")}@example.com`}, ${name}) returning id`);
    await db.execute(sql`insert into talent.applications (opening_id, candidate_id, stage) values (${opening.id}, ${c.id}, 'applied')`);
    for (const [who, expected] of [[hr, true], [recruiter, true], [lead, false], [exec, false], [employee, false]] as const) {
      as(who);
      const hits = await search.runSearch(who, name.slice(0, 20));
      expect(hits.some((h) => h.kind === "applicant"), who.email).toBe(expected);
    }
  });

  it("a query with wildcard characters is treated as plain text", async () => {
    as(hr);
    const hits = await search.runSearch(hr, "%%");
    expect(hits.filter((h) => h.kind === "person")).toEqual([]);
  });
});
