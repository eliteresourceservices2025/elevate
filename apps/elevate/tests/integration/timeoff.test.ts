import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for prize days, the append-only ledger, expiry and holidays (Phase 2.1).

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/timeoff/actions");
const queries = await import("@/modules/timeoff/queries");
const jobs = await import("@/modules/timeoff/jobs");
const { addDays } = await import("@/modules/timeoff/service");
const { todayInZone } = await import("@/modules/org/service");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
const today = todayInZone();

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

async function person(label: string, roles: RoleSlug[] = ["employee"], opts: { managerId?: string; status?: string } = {}) {
  const user = await makeUser(label, roles);
  const n = uniq(label);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id)
    values (${label}, ${n}, ${user.email}, ${opts.status ?? "active"}, ${user.id}, ${opts.managerId ?? null}) returning id`);
  return { user, employeeId: e.id };
}

const typeId = async (slug: string) => (await rows<{ id: string }>(sql`select id from time.leave_types where slug = ${slug}`))[0].id;

/** Writes a ledger row directly (the job and the future request flow write rows without going through HR's forms). */
async function ledger(employeeId: string, entryType: string, days: number, effectiveOn: string, extra: { expiresOn?: string; reason?: string; slug?: string } = {}) {
  const [row] = await rows<{ id: string }>(sql`
    insert into time.leave_ledger (employee_id, leave_type_id, entry_type, days, effective_on, expires_on, reason)
    values (${employeeId}, ${await typeId(extra.slug ?? "prize_day")}, ${entryType}, ${days}, ${effectiveOn}, ${extra.expiresOn ?? null}, ${extra.reason ?? null}) returning id`);
  return row.id;
}

const balanceOf = async (employeeId: string) => (await rows<{ b: number | null }>(sql`select coalesce(sum(days), 0)::float8 as b from time.leave_ledger where employee_id = ${employeeId}`))[0].b;

let hr: TestUser;
let hrEmployeeId: string;
let prize: string;

beforeAll(async () => {
  ({ user: hr, employeeId: hrEmployeeId } = await person("hr", ["hr_admin", "employee"]));
  prize = await typeId("prize_day");
});

describe("awarding prize days", () => {
  it("adds a ledger row, notifies the person, and is audited", async () => {
    const ana = await person("Ana");
    as(hr);
    const result = await actions.awardDays({ employeeId: ana.employeeId, leaveTypeId: prize, days: "1.5", reason: "Trivia night winner", expiresOn: addDays(today, 30) });
    expect(result.ok).toBe(true);

    expect(await balanceOf(ana.employeeId)).toBe(1.5);
    const [row] = await rows<{ entry_type: string; reason: string; expires_on: string; effective_on: string }>(sql`select entry_type, reason, expires_on::text, effective_on::text from time.leave_ledger where employee_id = ${ana.employeeId}`);
    expect(row).toEqual({ entry_type: "award", reason: "Trivia night winner", expires_on: addDays(today, 30), effective_on: today });
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${ana.user.id} and kind = 'timeoff.awarded' and link = '/time-off'`)).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'leave.award' and target_id = ${ana.employeeId}`)).toHaveLength(1);

    as(ana.user);
    const mine = await queries.getMyTimeOff();
    expect(mine?.cards.find((c) => c.leaveTypeName === "Prize day off")).toMatchObject({ balance: 1.5, expiring: [{ expiresOn: addDays(today, 30), days: 1.5 }] });
    expect(mine?.lines[0]).toMatchObject({ entryType: "award", days: 1.5, by: "HR", reason: "Trivia night winner" });
  });

  it("refuses bad input, wrong people and wrong types", async () => {
    const ana = await person("Refuse");
    const separated = await person("Gone", ["employee"], { status: "separated" });
    as(hr);
    const award = (over: Record<string, unknown>) => actions.awardDays({ employeeId: ana.employeeId, leaveTypeId: prize, days: 1, reason: "Contest prize", ...over });

    for (const days of [0, 0.25, 5.5, -1, "abc"]) expect((await award({ days })).ok, String(days)).toBe(false);
    expect((await award({ reason: "x" })).ok).toBe(false);
    expect(await award({ expiresOn: today })).toEqual({ ok: false, error: "The expiry date must be after today." });
    expect(await award({ leaveTypeId: await typeId("unpaid_day") })).toEqual({ ok: false, error: "Choose a leave type that has a balance." });
    expect(await award({ employeeId: separated.employeeId })).toEqual({ ok: false, error: "That person was not found." });
    expect(await award({ employeeId: randomUUID() })).toEqual({ ok: false, error: "That person was not found." });
    expect(await balanceOf(ana.employeeId)).toBe(0);

    // Nobody awards themselves: another admin must
    expect(await award({ employeeId: hrEmployeeId })).toEqual({ ok: false, error: "Another admin must award your own days." });

    // Only HR
    for (const role of ["team_lead", "recruiter", "executive", "employee"] as RoleSlug[]) {
      as(await makeUser("nope", [role]));
      expect(await award({})).toEqual({ ok: false, error: NO_ACCESS });
    }
  });

  it("refuses an archived leave type", async () => {
    const ana = await person("Archived");
    as(hr);
    expect((await actions.createLeaveType({ name: uniq("Bonus "), tracksBalance: true })).ok).toBe(true);
    const [t] = await rows<{ id: string }>(sql`select id from time.leave_types order by created_at desc limit 1`);
    expect((await actions.archiveLeaveType({ leaveTypeId: t.id })).ok).toBe(true);
    expect(await actions.awardDays({ employeeId: ana.employeeId, leaveTypeId: t.id, days: 1, reason: "Old type" })).toEqual({ ok: false, error: "Choose a leave type that has a balance." });
  });
});

describe("the ledger is append-only", () => {
  it("cannot be edited, deleted or truncated, even directly in the database", async () => {
    const ana = await person("Evidence");
    await ledger(ana.employeeId, "award", 1, today, { reason: "Prize" });
    await expect(db.execute(sql`update time.leave_ledger set days = 5 where employee_id = ${ana.employeeId}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from time.leave_ledger where employee_id = ${ana.employeeId}`)).rejects.toThrow();
    await expect(db.execute(sql`truncate time.leave_ledger`)).rejects.toThrow();
    expect(await balanceOf(ana.employeeId)).toBe(1);
  });

  it("rejects rows with the wrong sign or a missing reason", async () => {
    const ana = await person("Signs");
    await expect(ledger(ana.employeeId, "award", -1, today, { reason: "x" })).rejects.toThrow();
    await expect(ledger(ana.employeeId, "usage", 1, today)).rejects.toThrow();
    await expect(ledger(ana.employeeId, "award", 1, today)).rejects.toThrow(); // an award needs a reason
    await expect(ledger(ana.employeeId, "adjustment", 0, today, { reason: "x" })).rejects.toThrow();
    await expect(ledger(ana.employeeId, "usage", -1, today, { expiresOn: addDays(today, 3) })).rejects.toThrow(); // only awards expire
  });
});

describe("corrections", () => {
  it("adjusts up and down but never below zero, even with two at once", async () => {
    const ana = await person("Adjust");
    as(hr);
    expect((await actions.awardDays({ employeeId: ana.employeeId, leaveTypeId: prize, days: 1, reason: "Prize" })).ok).toBe(true);
    const adjust = (days: number) => actions.adjustBalance({ employeeId: ana.employeeId, leaveTypeId: prize, days, reason: "Entered by mistake" });

    expect((await adjust(0.5)).ok).toBe(true);
    expect(await balanceOf(ana.employeeId)).toBe(1.5);
    expect(await adjust(-5)).toEqual({ ok: false, error: "That would take the balance below zero. The balance is 1.5 days." });
    expect((await adjust(0)).ok).toBe(false);
    expect((await adjust(6)).ok).toBe(false);

    // Two removals of 1 day when only 1.5 remain: exactly one can win
    const results = await Promise.all([adjust(-1), adjust(-1)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await balanceOf(ana.employeeId)).toBe(0.5);

    expect(await rows(sql`select 1 from ops.audit_log where action = 'leave.adjust' and target_id = ${ana.employeeId}`)).toHaveLength(2); // only the two that succeeded
    expect(await actions.adjustBalance({ employeeId: hrEmployeeId, leaveTypeId: prize, days: 1, reason: "Fix my own" })).toEqual({ ok: false, error: "Another admin must adjust your own days." });
  });
});

describe("expiry job", () => {
  const notes = (userId: string, kind: string) => rows(sql`select 1 from ops.notifications where user_id = ${userId} and kind = ${kind}`);

  it("writes off unused days once, and only what is left", async () => {
    const unused = await person("Unused");
    const partly = await person("Partly");
    const allUsed = await person("AllUsed");
    const yesterday = addDays(today, -1);
    for (const p of [unused, partly, allUsed]) await ledger(p.employeeId, "award", 2, addDays(today, -30), { expiresOn: yesterday, reason: "Old prize" });
    await ledger(partly.employeeId, "usage", -0.5, addDays(today, -10));
    await ledger(allUsed.employeeId, "usage", -2, addDays(today, -10));

    const first = await jobs.runLeaveExpiry(today);
    expect(first.expired).toBeGreaterThanOrEqual(3);

    expect(await balanceOf(unused.employeeId)).toBe(0);
    expect(await balanceOf(partly.employeeId)).toBe(0);
    expect(await balanceOf(allUsed.employeeId)).toBe(0);
    const expiry = (employeeId: string) => rows<{ days: number; effective_on: string; reason: string; created_by: string | null }>(sql`select days::float8 as days, effective_on::text, reason, created_by from time.leave_ledger where employee_id = ${employeeId} and entry_type = 'expiry'`);
    expect(await expiry(unused.employeeId)).toEqual([{ days: -2, effective_on: today, reason: "Expired unused", created_by: null }]);
    expect((await expiry(partly.employeeId))[0].days).toBe(-1.5);
    expect(await expiry(allUsed.employeeId)).toEqual([{ days: 0, effective_on: today, reason: "Expired, nothing left", created_by: null }]);

    expect(await notes(unused.user.id, "timeoff.expired")).toHaveLength(1);
    expect(await notes(allUsed.user.id, "timeoff.expired")).toHaveLength(0); // nothing was lost: no message

    // Running again changes nothing
    const again = await jobs.runLeaveExpiry(today);
    expect(again.expired).toBe(0);
    expect(await expiry(unused.employeeId)).toHaveLength(1);
    expect(await notes(unused.user.id, "timeoff.expired")).toHaveLength(1);
  });

  it("days used before they expire do not come out of a later award", async () => {
    const p = await person("Order");
    await ledger(p.employeeId, "award", 1, addDays(today, -40), { expiresOn: addDays(today, -1), reason: "Soon prize" });
    await ledger(p.employeeId, "award", 1, addDays(today, -39), { reason: "Never expires" });
    await ledger(p.employeeId, "usage", -1, addDays(today, -20)); // draws from the one that expires first
    await jobs.runLeaveExpiry(today);
    expect(await balanceOf(p.employeeId)).toBe(1); // the never-expiring day is still there
  });

  it("reminds once when unused days expire within 7 days, and not when nothing is left", async () => {
    const soon = await person("Soon");
    const usedUp = await person("UsedUp");
    const far = await person("Far");
    await ledger(soon.employeeId, "award", 1, today, { expiresOn: addDays(today, 5), reason: "Prize" });
    await ledger(usedUp.employeeId, "award", 1, today, { expiresOn: addDays(today, 5), reason: "Prize" });
    await ledger(usedUp.employeeId, "usage", -1, today);
    await ledger(far.employeeId, "award", 1, today, { expiresOn: addDays(today, 30), reason: "Prize" });

    await jobs.runLeaveExpiry(today);
    await jobs.runLeaveExpiry(today);
    expect(await notes(soon.user.id, "timeoff.expiring")).toHaveLength(1);
    expect(await notes(usedUp.user.id, "timeoff.expiring")).toHaveLength(0);
    expect(await notes(far.user.id, "timeoff.expiring")).toHaveLength(0);
    expect(await balanceOf(soon.employeeId)).toBe(1); // not expired yet
  });
});

describe("who can see balances", () => {
  it("shows a person their own, a Team Lead their downline, HR everyone, and nobody else", async () => {
    const lead = await person("Lead", ["team_lead", "employee"]);
    const report = await person("Report", ["employee"], { managerId: lead.employeeId });
    const stranger = await person("Stranger");
    for (const p of [report, stranger]) await ledger(p.employeeId, "award", 1, today, { reason: "Prize" });

    as(report.user);
    expect((await queries.getMyTimeOff())?.employeeId).toBe(report.employeeId);
    expect((await queries.getPersonTimeOff(report.employeeId))?.employeeId).toBe(report.employeeId);
    await expect(queries.getPersonTimeOff(stranger.employeeId)).rejects.toThrow("Forbidden");
    await expect(queries.listBalances()).rejects.toThrow("Forbidden");

    as(lead.user);
    expect((await queries.getPersonTimeOff(report.employeeId))?.cards[0].balance).toBe(1);
    await expect(queries.getPersonTimeOff(stranger.employeeId)).rejects.toThrow("Forbidden");
    const team = await queries.listBalances();
    expect(team.scope).toBe("team");
    expect(team.rows.map((r) => r.employeeId)).toEqual([report.employeeId]);

    as(hr);
    const all = await queries.listBalances();
    expect(all.scope).toBe("all");
    const ids = all.rows.map((r) => r.employeeId);
    expect(ids).toContain(report.employeeId);
    expect(ids).toContain(stranger.employeeId);
    expect((await queries.getPersonTimeOff(stranger.employeeId))?.lines).toHaveLength(1);
    expect(await queries.getPersonTimeOff(randomUUID())).toBeNull();

    for (const role of ["recruiter", "executive"] as RoleSlug[]) {
      as(await makeUser("blind", [role]));
      await expect(queries.getPersonTimeOff(report.employeeId)).rejects.toThrow("Forbidden");
      await expect(queries.listBalances()).rejects.toThrow("Forbidden");
    }
  });

  it("names the viewer's own entries as theirs and never names another person", async () => {
    const ana = await person("Names");
    as(hr);
    await actions.awardDays({ employeeId: ana.employeeId, leaveTypeId: prize, days: 1, reason: "Prize" });
    expect((await queries.getPersonTimeOff(ana.employeeId))?.lines[0].by).toBe("You");
    const other = await makeUser("hr2", ["hr_admin", "employee"]);
    as(other);
    expect((await queries.getPersonTimeOff(ana.employeeId))?.lines[0].by).toBe("HR");
  });
});

describe("holidays", () => {
  it("ships 2026 and 2027 calendars: US verified, Philippines to be checked", async () => {
    const seeded = await rows<{ calendar: string; verified: boolean; n: number }>(sql`select calendar, verified, count(*)::int as n from time.holidays where date between '2026-01-01' and '2027-12-31' group by calendar, verified order by calendar`);
    const of = (c: string, v: boolean) => seeded.find((s) => s.calendar === c && s.verified === v)?.n ?? 0;
    expect(of("US", true)).toBeGreaterThanOrEqual(20);
    expect(of("PH", false)).toBeGreaterThanOrEqual(25);
    expect(await rows(sql`select 1 from time.holidays where calendar = 'US' and date = '2026-11-26' and name = 'Thanksgiving Day'`)).toHaveLength(1);
    expect(await rows(sql`select 1 from time.holidays where calendar = 'PH' and date = '2026-12-25' and name = 'Christmas Day'`)).toHaveLength(1);
  });

  it("shows each person the calendars that apply: the Philippines plus their clients'", async () => {
    const plain = await person("NoClient");
    const withUs = await person("UsClient");
    const withPh = await person("PhClient");
    const [us] = await rows<{ id: string }>(sql`insert into core.clients (name, holiday_calendar) values (${uniq("US Clinic ")}, 'US') returning id`);
    const [ph] = await rows<{ id: string }>(sql`insert into core.clients (name, holiday_calendar) values (${uniq("PH Firm ")}, 'PH') returning id`);
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${withUs.employeeId}, ${us.id}, ${today})`);
    await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${withPh.employeeId}, ${ph.id}, ${today})`);

    as(plain.user);
    const a = await queries.getHolidays(2026);
    expect(a.calendars).toEqual(["PH"]);
    expect(a.rows.every((h) => h.calendar === "PH")).toBe(true);
    expect(a.canManage).toBe(false);

    as(withUs.user);
    const b = await queries.getHolidays(2026);
    expect([...b.calendars].sort()).toEqual(["PH", "US"]);
    expect(b.rows.some((h) => h.calendar === "US" && h.name === "Thanksgiving Day")).toBe(true);

    as(withPh.user);
    expect((await queries.getHolidays(2026)).calendars).toEqual(["PH"]);

    // An ended assignment stops counting
    await db.execute(sql`update core.client_assignments set end_date = ${today} where employee_id = ${withUs.employeeId}`);
    as(withUs.user);
    expect((await queries.getHolidays(2026)).calendars).toEqual(["PH"]);

    as(hr);
    const all = await queries.getHolidays(2026);
    expect([...all.calendars].sort()).toEqual(["PH", "US"]);
    expect(all.canManage).toBe(true);
    expect(all.rows.every((h) => h.date.startsWith("2026"))).toBe(true);
  });

  it("lets HR add, correct, verify and remove holidays, refusing duplicates", async () => {
    as(hr);
    const holiday = { calendar: "PH", date: "2031-06-12", name: uniq("Test holiday "), kind: "special_working", verified: false };
    expect((await actions.createHoliday(holiday)).ok).toBe(true);
    expect(await actions.createHoliday(holiday)).toEqual({ ok: false, error: "That holiday is already on the calendar." });
    const [h] = await rows<{ id: string }>(sql`select id from time.holidays where name = ${holiday.name}`);

    expect((await actions.updateHoliday({ ...holiday, holidayId: h.id, verified: true, date: "2031-06-13" })).ok).toBe(true);
    expect((await rows<{ verified: boolean; date: string }>(sql`select verified, date::text from time.holidays where id = ${h.id}`))[0]).toEqual({ verified: true, date: "2031-06-13" });
    expect((await queries.getHolidays(2031)).rows.map((r) => r.name)).toContain(holiday.name);

    expect((await actions.archiveHoliday({ holidayId: h.id })).ok).toBe(true);
    expect((await queries.getHolidays(2031)).rows.map((r) => r.name)).not.toContain(holiday.name);
    expect(await actions.archiveHoliday({ holidayId: h.id })).toEqual({ ok: false, error: "That holiday was not found." });
    expect((await actions.createHoliday({ ...holiday, calendar: "MX" })).ok).toBe(false);
    expect(await rows(sql`select 1 from ops.audit_log where action in ('holiday.create','holiday.update','holiday.archive') and target_id = ${h.id}`)).toHaveLength(3);
  });
});

describe("leave types", () => {
  it("starts with a prize day type and an unpaid type, and refuses duplicate names", async () => {
    as(hr);
    const types = await queries.listLeaveTypes();
    expect(types.find((t) => t.slug === "prize_day")).toMatchObject({ name: "Prize day off", tracksBalance: true });
    expect(types.find((t) => t.slug === "unpaid_day")).toMatchObject({ name: "Unpaid day off", tracksBalance: false });
    expect(await actions.createLeaveType({ name: "prize DAY off", tracksBalance: true })).toEqual({ ok: false, error: "A leave type with that name already exists." });

    const name = uniq("Wellness ");
    expect((await actions.createLeaveType({ name, tracksBalance: false, skipHr: true })).ok).toBe(true);
    const made = (await queries.listLeaveTypes()).find((t) => t.name === name)!;
    expect(made).toMatchObject({ tracksBalance: false, skipHr: true, archived: false });
    expect((await actions.updateLeaveType({ leaveTypeId: made.id, name: `${name} 2`, skipHr: false })).ok).toBe(true);
    expect((await queries.listLeaveTypes()).find((t) => t.id === made.id)).toMatchObject({ name: `${name} 2`, skipHr: false });
  });
});
