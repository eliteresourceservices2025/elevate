import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for Organization (Phase 1.2): reporting lines, cycle prevention, dated changes,
// team scope for managers, the org chart's per-person access, and the structure guards.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const org = await import("@/modules/org/actions");
const orgQueries = await import("@/modules/org/queries");
const orgService = await import("@/modules/org/service");
const people = await import("@/modules/people/actions");
const peopleQueries = await import("@/modules/people/queries");
const { ensureCoreUser } = await import("@/modules/core/users");

type TestUser = { id: string; email: string; roles: RoleSlug[] };

let counter = 0;
const uniq = (prefix: string) => `${prefix}${Date.now().toString(36)}${counter++}`;

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const role of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  return { id, email, roles };
}
const as = (user: TestUser) => {
  current.user = user;
};
const rows = async <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];

/** A people record straight in the database, optionally linked to a sign-in account. */
async function makeEmployee(label: string, opts: { userId?: string; managerId?: string; status?: string; teamId?: string } = {}) {
  const name = uniq(label);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, team_id)
    values (${label}, ${name}, ${name + "@example.com"}, ${opts.status ?? "active"}, ${opts.userId ?? null}, ${opts.managerId ?? null}, ${opts.teamId ?? null})
    returning id`);
  return e.id;
}

async function makeTeam(label: string) {
  const [d] = await rows<{ id: string }>(sql`insert into core.departments (name) values (${uniq("Dept " + label)}) returning id`);
  const [t] = await rows<{ id: string }>(sql`insert into core.teams (name, department_id) values (${uniq("Team " + label)}, ${d.id}) returning id`);
  return { departmentId: d.id, teamId: t.id };
}

async function errorText(promise: Promise<unknown>) {
  try {
    await promise;
    return "";
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return `${err.message ?? ""} ${err.cause?.message ?? ""}`;
  }
}

const today = orgService.todayInZone();
let hr: TestUser;
let staff: TestUser;

beforeAll(async () => {
  hr = await makeUser("hr", ["employee", "hr_admin"]);
  staff = await makeUser("staff", ["employee"]);
});

describe("cycle prevention (enforced by the database)", () => {
  it("refuses a person reporting to themselves, directly or through a chain", async () => {
    const a = await makeEmployee("Cyc");
    const b = await makeEmployee("Cyc", { managerId: a }); // b reports to a
    const c = await makeEmployee("Cyc", { managerId: b }); // c reports to b

    expect(await errorText(db.execute(sql`update core.employees set manager_id = ${a} where id = ${a}`))).toMatch(/manager_cycle|violates/);
    expect(await errorText(db.execute(sql`update core.employees set manager_id = ${c} where id = ${a}`))).toMatch(/manager_cycle/); // a -> c -> b -> a
    expect(await errorText(db.execute(sql`update core.employees set manager_id = ${c} where id = ${b}`))).toMatch(/manager_cycle/);
    // a legal change is still fine
    await db.execute(sql`update core.employees set manager_id = ${a} where id = ${c}`);
  });

  it("two people changing two managers at the same moment cannot together create a loop", async () => {
    const a = await makeEmployee("Race");
    const b = await makeEmployee("Race");
    const url = process.env.DATABASE_URL!;
    const c1 = postgres(url, { max: 1, onnotice: () => {} });
    const c2 = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const r1 = await c1.reserve();
      const r2 = await c2.reserve();
      await r1.unsafe("begin");
      await r2.unsafe("begin");
      await r1.unsafe(`update core.employees set manager_id = '${b}' where id = '${a}'`); // holds the lock until commit
      const second = r2.unsafe(`update core.employees set manager_id = '${a}' where id = '${b}'`).then(
        () => "ok",
        (e: { message?: string }) => e.message ?? "error",
      );
      await new Promise((r) => setTimeout(r, 300)); // the second change is now waiting for the first
      await r1.unsafe("commit");
      const outcome = await second;
      await r2.unsafe("rollback");
      expect(outcome).toMatch(/manager_cycle/);
      r1.release();
      r2.release();
    } finally {
      await c1.end();
      await c2.end();
    }
    const [row] = await rows<{ both: number }>(sql`select count(*)::int as both from core.employees where id in (${a}, ${b}) and manager_id is not null`);
    expect(row.both).toBe(1);
  });
});

describe("setReporting (dated changes)", () => {
  it("records a manager and team change: dated rows, current columns, history and audit", async () => {
    const mgr = await makeEmployee("Mgr");
    const person = await makeEmployee("Rep");
    const { teamId } = await makeTeam("rep");
    as(hr);

    const r = await org.setReporting({ employeeId: person, managerId: mgr, teamId, effectiveDate: "2026-09-01" });
    expect(r.ok).toBe(true);

    const [e] = await rows<{ manager_id: string; team_id: string }>(sql`select manager_id, team_id from core.employees where id = ${person}`);
    expect(e).toEqual({ manager_id: mgr, team_id: teamId });
    const [line] = await rows<{ manager_id: string; effective_from: string; effective_to: string | null }>(sql`select manager_id, effective_from::text, effective_to::text from core.reporting_lines where employee_id = ${person}`);
    expect(line).toEqual({ manager_id: mgr, effective_from: "2026-09-01", effective_to: null });
    const events = await rows<{ event_type: string }>(sql`select event_type from core.employment_history where employee_id = ${person} order by event_type`);
    expect(events.map((x) => x.event_type)).toEqual(["manager_changed", "team_changed"]);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'org.reporting.update' and target_id = ${person}`)).toHaveLength(1);
  });

  it("a second change closes the first row on the new date and keeps both", async () => {
    const m1 = await makeEmployee("M1");
    const m2 = await makeEmployee("M2");
    const person = await makeEmployee("Mover");
    as(hr);
    await org.setReporting({ employeeId: person, managerId: m1, effectiveDate: "2026-01-10" });
    expect((await org.setReporting({ employeeId: person, managerId: m2, effectiveDate: "2026-03-01" })).ok).toBe(true);

    const lines = await rows<{ manager_id: string; effective_from: string; effective_to: string | null }>(sql`select manager_id, effective_from::text, effective_to::text from core.reporting_lines where employee_id = ${person} order by effective_from`);
    expect(lines).toEqual([
      { manager_id: m1, effective_from: "2026-01-10", effective_to: "2026-03-01" },
      { manager_id: m2, effective_from: "2026-03-01", effective_to: null },
    ]);
  });

  it("refuses future dates, dates before the current assignment, itself, leavers, loops and no-ops", async () => {
    const boss = await makeEmployee("Boss");
    const person = await makeEmployee("Rule", { managerId: boss });
    await db.execute(sql`insert into core.reporting_lines (employee_id, manager_id, effective_from) values (${person}, ${boss}, '2026-06-01')`);
    const gone = await makeEmployee("Gone", { status: "separated" });
    as(hr);

    const nextYear = `${Number(today.slice(0, 4)) + 1}-01-01`;
    expect(await org.setReporting({ employeeId: person, managerId: null, effectiveDate: nextYear })).toMatchObject({ ok: false, error: expect.stringMatching(/future/) });
    expect(await org.setReporting({ employeeId: person, managerId: null, effectiveDate: "2026-05-31" })).toMatchObject({ ok: false, error: expect.stringMatching(/started on 2026-06-01/) });
    expect(await org.setReporting({ employeeId: person, managerId: person, effectiveDate: today })).toMatchObject({ ok: false, error: expect.stringMatching(/loop/) });
    expect(await org.setReporting({ employeeId: person, managerId: gone, effectiveDate: today })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer with ERS/) });
    expect(await org.setReporting({ employeeId: boss, managerId: person, effectiveDate: today })).toMatchObject({ ok: false, error: expect.stringMatching(/loop/) });
    expect(await org.setReporting({ employeeId: person, managerId: boss, effectiveDate: today })).toMatchObject({ ok: false, error: "No changes to save." });
    expect(await org.setReporting({ employeeId: person, effectiveDate: today })).toMatchObject({ ok: false });
  });

  it("only HR may change reporting lines", async () => {
    const person = await makeEmployee("NoAccess");
    as(staff);
    expect(await org.setReporting({ employeeId: person, managerId: null, teamId: null, effectiveDate: today })).toEqual({ ok: false, error: "You do not have access to do that." });
  });
});

describe("managers who still have reports", () => {
  it("blocks leaving or archiving until the reports are reassigned, then allows it", async () => {
    const boss = await makeEmployee("LeavingBoss");
    const r1 = await makeEmployee("Rep1", { managerId: boss });
    const r2 = await makeEmployee("Rep2", { managerId: boss });
    const newBoss = await makeEmployee("NewBoss");
    as(hr);

    const archive = await people.archiveEmployee({ employeeId: boss });
    expect(archive).toMatchObject({ ok: false, error: expect.stringMatching(/2 people report to them/) });

    const [b] = await rows<Record<string, unknown>>(sql`select * from core.employees where id = ${boss}`);
    const leave = await people.updateEmployee({
      employeeId: boss,
      legalFirstName: b.legal_first_name,
      legalLastName: b.legal_last_name,
      workEmail: b.work_email,
      status: "separated",
      endDate: today,
      workerType: "contractor",
      country: "PH",
    });
    expect(leave).toMatchObject({ ok: false, error: expect.stringMatching(/Reassign their reports first/) });

    const moved = await org.reassignReports({ fromManagerId: boss, toManagerId: newBoss, effectiveDate: today });
    expect(moved).toEqual({ ok: true, data: { moved: 2 } });
    const after = await rows<{ manager_id: string }>(sql`select manager_id from core.employees where id in (${r1}, ${r2})`);
    expect(after.every((x) => x.manager_id === newBoss)).toBe(true);
    expect(await org.reassignReports({ fromManagerId: boss, toManagerId: newBoss, effectiveDate: today })).toMatchObject({ ok: false });

    expect((await people.archiveEmployee({ employeeId: boss })).ok).toBe(true);
  });
});

describe("team access for managers", () => {
  it("knows who is above someone in the chain, nearest first", async () => {
    const u1 = await makeUser("chain1", ["employee"]);
    const u2 = await makeUser("chain2", ["employee"]);
    const top = await makeEmployee("Top", { userId: u2.id });
    const mid = await makeEmployee("Mid", { userId: u1.id, managerId: top });
    const low = await makeEmployee("Low", { managerId: mid });
    expect(await orgService.managerChainUserIds(db, low)).toEqual([u1.id, u2.id]);
    expect(await orgService.managerChainUserIds(db, top)).toEqual([]);
  });

  it("a Team Lead sees everyone below them, with private details hidden, and nobody else", async () => {
    const lead = await makeUser("lead", ["employee", "team_lead"]);
    const boss = await makeEmployee("LeadBoss");
    const leadEmp = await makeEmployee("Lead", { userId: lead.id, managerId: boss });
    const direct = await makeEmployee("Direct", { managerId: leadEmp });
    const indirect = await makeEmployee("Indirect", { managerId: direct });
    const outsider = await makeEmployee("Outsider");
    await db.execute(sql`update core.employees set birth_date = '1995-05-05', personal_email = 'private@example.com', address_line = '1 Private Road', mobile = '+63 900 111 2222' where id = ${direct}`);
    await db.execute(sql`insert into core.employee_sensitive (employee_id, tin_enc, masks) values (${direct}, 'v1:x', '{"tin":"••••1234"}')`);

    as(lead);
    for (const id of [direct, indirect]) expect((await peopleQueries.getProfile(id)).employee.id).toBe(id);

    const p = await peopleQueries.getProfile(direct);
    expect(p.access.limitedView).toBe(true);
    expect(p.employee).toMatchObject({ birthDate: null, personalEmail: null, addressLine: null, civilStatus: null, mobile: "+63 900 111 2222" });
    expect(p.sensitive).toBeNull();
    expect(p.access.canViewSensitive).toBe(false);
    expect(p.access.canEdit).toBe(false);
    expect(p.access.canViewHistory).toBe(true);

    await expect(peopleQueries.getProfile(outsider)).rejects.toThrow("Forbidden");
    await expect(peopleQueries.getProfile(boss)).rejects.toThrow("Forbidden"); // upwards is not "team"

    as(hr);
    const full = await peopleQueries.getProfile(direct);
    expect(full.employee).toMatchObject({ birthDate: "1995-05-05", personalEmail: "private@example.com", addressLine: "1 Private Road" });
    expect(full.access.limitedView).toBe(false);
  });
});

describe("org chart and directory", () => {
  it("canOpen is decided per person for each viewer", async () => {
    const lead = await makeUser("chartlead", ["employee", "team_lead"]);
    const staffUser = await makeUser("chartstaff", ["employee"]);
    const top = await makeEmployee("ChartTop");
    const leadEmp = await makeEmployee("ChartLead", { userId: lead.id, managerId: top });
    const report = await makeEmployee("ChartReport", { managerId: leadEmp });
    const staffEmp = await makeEmployee("ChartStaff", { userId: staffUser.id, managerId: top });
    const gone = await makeEmployee("ChartGone", { status: "separated" });

    const canOpen = async (viewer: TestUser) => {
      as(viewer);
      const chart = await orgQueries.getOrgChart();
      return new Map(chart.map((n) => [n.id, n.canOpen]));
    };

    const asLead = await canOpen(lead);
    expect([asLead.get(leadEmp), asLead.get(report)]).toEqual([true, true]);
    expect([asLead.get(top), asLead.get(staffEmp)]).toEqual([false, false]);

    const asStaff = await canOpen(staffUser);
    expect(asStaff.get(staffEmp)).toBe(true);
    expect([asStaff.get(top), asStaff.get(leadEmp), asStaff.get(report)]).toEqual([false, false, false]);

    const asHr = await canOpen(hr);
    expect([asHr.get(top), asHr.get(leadEmp), asHr.get(report), asHr.get(staffEmp)]).toEqual([true, true, true, true]);

    expect(asHr.has(gone)).toBe(false); // people who left are not on the chart
    as(staff);
    const nodes = await orgQueries.getOrgChart();
    expect(Object.keys(nodes[0]).sort()).toEqual(["canOpen", "id", "managerId", "name", "position", "status", "team"]); // directory fields only
  });

  it("the directory shows team and manager to everyone and filters by team", async () => {
    const { teamId } = await makeTeam("dir");
    const boss = await makeEmployee("DirBoss");
    const person = await makeEmployee("DirPerson", { managerId: boss, teamId });
    await makeEmployee("DirOther");

    as(staff);
    const view = await peopleQueries.listDirectory({ team: teamId });
    expect(view.rows.map((r) => r.id)).toEqual([person]);
    expect(view.rows[0].team).toMatch(/^Team dir/);
    expect(view.rows[0].managerName).toMatch(/^DirBoss/);
  });
});

describe("positions catalog", () => {
  it("creating a person with a position, team and manager sets the title and the dated rows; renaming follows", async () => {
    const { teamId } = await makeTeam("create");
    const boss = await makeEmployee("CreateBoss");
    as(hr);
    expect((await org.createPosition({ title: uniq("Analyst ") })).ok).toBe(true);
    const [pos] = await rows<{ id: string; title: string }>(sql`select id, title from core.positions order by created_at desc limit 1`);

    const r = await people.createEmployee({
      legalFirstName: "Nina",
      legalLastName: uniq("Create"),
      workEmail: `${uniq("nina")}@example.com`,
      positionId: pos.id,
      teamId,
      managerId: boss,
      startDate: "2026-09-01",
    });
    expect(r.ok).toBe(true);
    const id = (r as { data: { id: string } }).data.id;

    const [e] = await rows<{ position: string; position_id: string; team_id: string; manager_id: string }>(sql`select position, position_id, team_id, manager_id from core.employees where id = ${id}`);
    expect(e).toEqual({ position: pos.title, position_id: pos.id, team_id: teamId, manager_id: boss });
    expect(await rows(sql`select 1 from core.reporting_lines where employee_id = ${id} and effective_from = '2026-09-01' and effective_to is null`)).toHaveLength(1);

    expect((await org.updatePosition({ positionId: pos.id, title: pos.title + " II" })).ok).toBe(true);
    const [renamed] = await rows<{ position: string }>(sql`select position from core.employees where id = ${id}`);
    expect(renamed.position).toBe(pos.title + " II");
  });

  it("a failed reporting change while creating rolls the whole person back", async () => {
    as(hr);
    const workEmail = `${uniq("rollback")}@example.com`;
    const r = await people.createEmployee({ legalFirstName: "Rolled", legalLastName: "Back", workEmail, managerId: randomUUID() });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/manager was not found/) });
    expect(await rows(sql`select 1 from core.employees where work_email = ${workEmail}`)).toHaveLength(0);
  });
});

describe("structure guards", () => {
  it("does not archive a team with people, a department with teams, or a position someone holds", async () => {
    const { departmentId, teamId } = await makeTeam("guard");
    await makeEmployee("InTeam", { teamId });
    as(hr);
    expect(await org.archiveTeam({ teamId })).toMatchObject({ ok: false, error: expect.stringMatching(/still in this team/) });
    expect(await org.archiveDepartment({ departmentId })).toMatchObject({ ok: false, error: expect.stringMatching(/active team/) });

    const [pos] = await rows<{ id: string }>(sql`insert into core.positions (title) values (${uniq("Held ")}) returning id`);
    await db.execute(sql`update core.employees set position_id = ${pos.id} where team_id = ${teamId}`);
    expect(await org.archivePosition({ positionId: pos.id })).toMatchObject({ ok: false, error: expect.stringMatching(/hold this position|holds this position/) });

    // empty things can go
    const empty = await makeTeam("empty");
    expect((await org.archiveTeam({ teamId: empty.teamId })).ok).toBe(true);
    expect((await org.archiveDepartment({ departmentId: empty.departmentId })).ok).toBe(true);
  });

  it("refuses duplicate names", async () => {
    as(hr);
    const name = uniq("Dup Dept ");
    expect((await org.createDepartment({ name })).ok).toBe(true);
    expect(await org.createDepartment({ name: name.toUpperCase() })).toEqual({ ok: false, error: "A department with that name already exists." });
  });
});

describe("account set-up", () => {
  it("ensureCoreUser sets an account up once and is a plain read afterwards", async () => {
    const id = randomUUID();
    const email = `${uniq("ensure")}@example.com`;
    const first = await ensureCoreUser({ id, email });
    expect(first.roles).toEqual(["employee"]);
    const second = await ensureCoreUser({ id, email });
    expect(second.roles).toEqual(["employee"]);
    const roleRows = await rows(sql`select 1 from core.user_roles where user_id = ${id}`);
    expect(roleRows).toHaveLength(1);
  });
});
