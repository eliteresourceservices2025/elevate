import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for People analytics (Phase 4.3): the nightly build from the source tables (backfill, idempotence, self-heal),
// the dated team and downline history, who sees what, small groups staying hidden, and the audited CSV export. Fake people only.
// The database is shared with the other test files, so company-wide numbers are checked as differences, not absolutes.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.77" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const build = await import("@/modules/analytics/build");
const queries = await import("@/modules/analytics/queries");
const actions = await import("@/modules/analytics/actions");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};

// "Now" for the job: the evening of 2026-06-15 in Phoenix, so the last finished day is 2026-06-14.
const NOW = new Date("2026-06-15T20:00:00Z");
const LAST = "2026-06-14";

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

let teamA: string;
let teamB: string;
let clientX: string;
let clientY: string;
let hr: TestUser;
let exec: TestUser;
let lead: TestUser;
let lead2: TestUser;
let recruiter: TestUser;
let employee: TestUser;
let leadEmp: string;
let b1: string;
let a6: string;
const fakeNames: string[] = [];

async function person(first: string, opts: { team: string; manager?: string; start: string; end?: string; user?: TestUser }) {
  first = `Zq${first}`;
  fakeNames.push(first);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, team_id, start_date, end_date)
    values (${first}, 'Analytics', ${`${uniq(first.toLowerCase())}@example.com`}, ${opts.end ? "separated" : "active"}, ${opts.user?.id ?? null}, ${opts.manager ?? null}, ${opts.team}, ${opts.start}, ${opts.end ?? null}) returning id`);
  return e.id;
}

async function application(openingId: string, label: string, stage: "screening" | "hired", appliedAt: string, hiredAt?: string) {
  const [c] = await rows<{ id: string }>(sql`insert into talent.candidates (email, full_name) values (${`${uniq(label)}@example.com`}, ${label}) returning id`);
  const [a] = await rows<{ id: string }>(sql`insert into talent.applications (opening_id, candidate_id, stage, applied_at, stage_changed_at, closed_at)
    values (${openingId}, ${c.id}, ${stage}, ${appliedAt}::timestamptz, ${appliedAt}::timestamptz, ${hiredAt ?? null}) returning id`);
  await db.execute(sql`insert into talent.application_stage_history (application_id, from_stage, to_stage, at) values (${a.id}, null, 'applied', ${appliedAt}::timestamptz)`);
  if (stage === "hired" && hiredAt) await db.execute(sql`insert into talent.application_stage_history (application_id, from_stage, to_stage, at) values (${a.id}, 'applied', 'hired', ${hiredAt}::timestamptz)`);
}

beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin"]);
  exec = await makeUser("exec", ["executive"]);
  lead = await makeUser("lead", ["team_lead"]);
  lead2 = await makeUser("lead2", ["team_lead"]);
  recruiter = await makeUser("recruiter", ["recruiter"]);
  employee = await makeUser("employee", ["employee"]);

  const [d] = await rows<{ id: string }>(sql`insert into core.departments (name) values (${uniq("Dept ")}) returning id`);
  [{ id: teamA }] = await rows<{ id: string }>(sql`insert into core.teams (department_id, name) values (${d.id}, ${uniq("Alpha team ")}) returning id`);
  [{ id: teamB }] = await rows<{ id: string }>(sql`insert into core.teams (department_id, name) values (${d.id}, ${uniq("Secret small team ")}) returning id`);
  [{ id: clientX }] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Client Xray ")}) returning id`);
  [{ id: clientY }] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Client Secret Yankee ")}) returning id`);

  // Team Alpha: a lead and six reports (one leaves on 2026-05-12). Secret small team: a lead and two reports.
  leadEmp = await person("Lena", { team: teamA, start: "2026-01-05", user: lead });
  const lead2Emp = await person("Lorenzo", { team: teamB, start: "2026-01-05", user: lead2 });
  const reports: string[] = [];
  for (const n of ["Ana", "Ben", "Cora", "Dino", "Elsa"]) reports.push(await person(n, { team: teamA, manager: leadEmp, start: "2026-01-05" }));
  a6 = await person("Fe", { team: teamA, manager: leadEmp, start: "2026-01-05", end: "2026-05-12" });
  b1 = await person("Gio", { team: teamA, manager: lead2Emp, start: "2026-02-01" }); // moves from the small team to Alpha on 2026-04-01
  await person("Hana", { team: teamB, manager: lead2Emp, start: "2026-02-01" });
  await db.execute(sql`insert into core.team_memberships (employee_id, team_id, effective_from, effective_to) values (${b1}, ${teamB}, '2026-02-01', '2026-03-31'), (${b1}, ${teamA}, '2026-04-01', null)`);
  for (const id of [...reports, a6]) await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${id}, ${clientX}, '2026-01-05')`);
  await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${b1}, ${clientY}, '2026-02-01')`);

  // Prize days used and attendance flags
  const [type] = await rows<{ id: string }>(sql`select id from time.leave_types limit 1`);
  await db.execute(sql`insert into time.leave_ledger (employee_id, leave_type_id, entry_type, days, effective_on) values (${reports[0]}, ${type.id}, 'usage', -1, '2026-03-10'), (${b1}, ${type.id}, 'usage', -0.5, '2026-03-11')`);
  await db.execute(sql`insert into time.attendance_days (employee_id, date, sessions, flags) values
    (${reports[0]}, '2026-03-09', 1, array['late']), (${reports[1]}, '2026-03-09', 0, array['absent']), (${reports[2]}, '2026-03-09', 1, array[]::text[]),
    (${reports[3]}, '2026-03-09', 1, array['extra_hours','unapproved_extra']), (${reports[4]}, '2026-03-09', 1, array[]::text[]), (${leadEmp}, '2026-03-09', 1, array['late'])`);

  // Hiring: two jobs with at least 5 applicants, two small ones; one hire (so time to hire stays hidden)
  const job = async (title: string) => (await rows<{ id: string }>(sql`insert into talent.job_openings (title, description, status) values (${uniq(title)}, 'Fake job', 'open') returning id`))[0].id;
  const j1 = await job("Big job one ");
  const j2 = await job("Big job two ");
  const j3 = await job("Tiny job three ");
  const j4 = await job("Tiny job four ");
  for (let i = 0; i < 5; i++) await application(j1, `Cand1-${i}`, "screening", "2026-03-03T12:00:00Z");
  await application(j1, "Cand1-hired", "hired", "2026-03-02T12:00:00Z", "2026-03-22T12:00:00Z");
  for (let i = 0; i < 6; i++) await application(j2, `Cand2-${i}`, "screening", "2026-04-06T12:00:00Z");
  for (let i = 0; i < 3; i++) await application(j3, `Cand3-${i}`, "screening", "2026-04-07T12:00:00Z");
  for (let i = 0; i < 2; i++) await application(j4, `Cand4-${i}`, "screening", "2026-04-08T12:00:00Z");
});

const company = async (date: string) => (await rows<{ headcount: number }>(sql`select headcount from ops.analytics_headcount_daily where date = ${date}::date and dim_kind = 'company'`))[0]?.headcount;
const dim = async (kind: string, id: string, date: string) => (await rows<{ headcount: number }>(sql`select headcount from ops.analytics_headcount_daily where date = ${date}::date and dim_kind = ${kind} and dim_id = ${id}`))[0]?.headcount ?? 0;
const tableCounts = async () => (await rows<{ n: number }>(sql`select (select count(*) from ops.analytics_headcount_daily)::int + (select count(*) from ops.analytics_movement_monthly)::int + (select count(*) from ops.analytics_leave_monthly)::int + (select count(*) from ops.analytics_attendance_weekly)::int + (select count(*) from ops.analytics_funnel_monthly)::int + (select count(*) from ops.analytics_time_to_hire_monthly)::int as n`))[0].n;

describe("the nightly build", () => {
  it("backfills a year the first time, from the dates and dated history in the source tables", async () => {
    const result = await build.runAnalyticsNightly(NOW);
    expect(result.from).toBe("2025-06-14");
    expect(result.to).toBe(LAST);
    // The leaver's last day counts; the day after does not
    expect((await company("2026-05-12"))! - (await company("2026-05-13"))!).toBe(1);
    // Gio sits in the small team until March 31 and in Alpha from April 1 (dated history, not the current column)
    expect(await dim("team", teamA, "2026-03-15")).toBe(7); // Lena + five reports + Fe (Fe leaves in May)
    expect(await dim("team", teamA, "2026-04-15")).toBe(8);
    expect(await dim("team", teamB, "2026-03-15")).toBe(3);
    expect(await dim("team", teamB, "2026-04-15")).toBe(2);
    expect(await dim("client", clientX, "2026-03-15")).toBe(6);
    expect(await dim("downline", leadEmp, "2026-05-13")).toBe(5);
    const [mar] = await rows<{ days_used: string; group_size: number }>(sql`select days_used, group_size from ops.analytics_leave_monthly where month = '2026-03-01' and dim_kind = 'team' and dim_id = ${teamA}`);
    expect(Number(mar.days_used)).toBe(1.5 - 0.5); // Ana (team Alpha) used 1 day; Gio was still in the other team on March 11
    expect(mar.group_size).toBeGreaterThanOrEqual(5);
    const [wk] = await rows<{ day_count: number; late: number; absent: number; extra_hours: number; unapproved_extra: number }>(sql`select day_count, late, absent, extra_hours, unapproved_extra from ops.analytics_attendance_weekly where week_start = '2026-03-09' and dim_kind = 'downline' and dim_id = ${leadEmp}`);
    expect(wk).toMatchObject({ day_count: 5, late: 1, absent: 1, extra_hours: 1, unapproved_extra: 1 });
    const [may] = await rows<{ leavers: number }>(sql`select leavers from ops.analytics_movement_monthly where month = '2026-05-01' and dim_kind = 'team' and dim_id = ${teamA}`);
    expect(may.leavers).toBe(1);
  });

  it("is idempotent and self-healing: a second run changes nothing, a missed night is filled in", async () => {
    const before = await tableCounts();
    await build.runAnalyticsNightly(NOW);
    expect(await tableCounts()).toBe(before);
    await db.execute(sql`delete from ops.analytics_headcount_daily where date between '2026-06-01' and '2026-06-09'`);
    expect(await company("2026-06-05")).toBeUndefined();
    const healed = await build.runAnalyticsNightly(NOW);
    expect(healed.from).toBe("2026-06-01");
    expect(await company("2026-06-05")).toBeGreaterThan(0);
    expect(await tableCounts()).toBe(before);
  });

  it("can rebuild any past range on demand (the backfill function) and writes no stale rows", async () => {
    await db.execute(sql`update ops.analytics_headcount_daily set headcount = 999 where date = '2026-04-15' and dim_kind = 'team' and dim_id = ${teamA}`);
    await build.rebuildRange("2026-04-10", "2026-04-20");
    expect(await dim("team", teamA, "2026-04-15")).toBe(8);
  });
});

describe("the dashboards", () => {
  it("shows HR and the Executive the company, with small teams and clients combined and never named", async () => {
    for (const u of [hr, exec]) {
      as(u);
      const d = await queries.getDashboard({ range: "12" });
      expect(d.asOf).toBe(LAST);
      expect(d.people?.hidden).toBe(false);
      expect(d.people?.headcountNow).toBeGreaterThanOrEqual(5);
      const json = JSON.stringify(d);
      expect(json).not.toContain("Secret small team");
      expect(json).not.toContain("Client Secret Yankee");
      for (const name of fakeNames) expect(json).not.toContain(name);
      expect(json).not.toContain("Analytics"); // the fake people's last name
      expect(d.hiring).not.toBeNull();
    }
  });

  it("hides a small group chosen by address, and treats a made-up group the same way", async () => {
    as(hr);
    for (const scope of [`team:${teamB}`, `client:${clientY}`, `team:${randomUUID()}`]) {
      const d = await queries.getDashboard({ scope });
      expect(d.people?.hidden).toBe(true);
      expect(d.people?.headcount).toEqual([]);
      expect(d.scope.label).not.toContain("Secret");
    }
  });

  it("shows a team lead only their own downline, and hides it when it is under 5", async () => {
    as(lead);
    const d = await queries.getDashboard({ scope: `team:${teamB}`, range: "6" });
    expect(d.scope.label).toMatch(/your team/i); // the address cannot widen a lead's view
    expect(d.people?.headcountNow).toBe(5);
    expect(d.teams).toBeNull();
    expect(d.clients).toBeNull();
    expect(d.hiring).toBeNull();
    expect(d.people?.movement.find((m) => m.month === "2026-05-01")).toMatchObject({ leavers: 1 });
    as(lead2);
    const small = await queries.getDashboard({});
    expect(small.people?.hidden).toBe(true);
    expect(small.people?.headcountNow).toBeNull();
    expect(small.people?.movement.every((m) => m.leavers === null)).toBe(true);
  });

  it("shows a recruiter hiring only, and an employee nothing", async () => {
    as(recruiter);
    const d = await queries.getDashboard({});
    expect(d.people).toBeNull();
    expect(d.hiring).not.toBeNull();
    as(employee);
    await expect(queries.getDashboard({})).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("builds the hiring funnel, hides small jobs and time to hire for fewer than 5 hires", async () => {
    as(hr);
    const d = await queries.getDashboard({ range: "12" });
    const h = d.hiring!;
    expect(h.funnel.find((f) => f.stage === "applied")?.applications).toBeGreaterThanOrEqual(17);
    expect(h.funnel.find((f) => f.stage === "hired")?.applications).toBeGreaterThanOrEqual(1);
    const json = JSON.stringify(h);
    expect(json).not.toContain("Tiny job");
    expect(h.byJob.some((j) => j.title.startsWith("Big job"))).toBe(true);
    expect(h.otherJobs?.jobs).toBeGreaterThanOrEqual(2);
    expect(h.timeToHire.find((t) => t.month === "2026-03-01")).toMatchObject({ hires: 1, avgDays: null, medianDays: null });
  });
});

describe("the CSV export", () => {
  it("is audited, holds only aggregates, and is for HR only", async () => {
    as(exec);
    const refused = await actions.exportAnalytics({ range: 12, scope: "company" });
    expect(refused).toEqual({ ok: false, error: "You do not have access to do that." });
    as(hr);
    const ok = await actions.exportAnalytics({ range: 12, scope: "company" });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.data.csv.startsWith("Section,Period,Group,Metric,Value")).toBe(true);
    expect(ok.data.csv).toContain("fewer than 5");
    for (const name of fakeNames) expect(ok.data.csv).not.toContain(name);
    expect(ok.data.csv).not.toContain("Secret");
    const audit = await rows<{ metadata: { rangeMonths: number } }>(sql`select metadata from ops.audit_log where action = 'analytics.export' and actor_user_id = ${hr.id}`);
    expect(audit.length).toBe(1);
    expect(audit[0].metadata.rangeMonths).toBe(12);
    expect(await actions.exportAnalytics({ range: 5, scope: "company" })).toMatchObject({ ok: false });
  });
});

describe("what the tables hold", () => {
  it("has row level security on and no column that names a person", async () => {
    const t = await rows<{ relname: string; relrowsecurity: boolean }>(sql`select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ops' and c.relname like 'analytics\_%' and c.relkind = 'r'`);
    expect(t.length).toBe(6);
    expect(t.every((x) => x.relrowsecurity)).toBe(true);
    const cols = await rows<{ column_name: string }>(sql`select column_name from information_schema.columns where table_schema = 'ops' and table_name like 'analytics\_%'`);
    expect(cols.some((c) => /employee|user|person|name|email/.test(c.column_name))).toBe(false);
  });
});
