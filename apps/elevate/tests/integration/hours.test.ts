import { randomUUID } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for hours approval and export (Phase 2.5, part C): approving a week (saved as approved), changes after
// approval, approving everyone with no flags, the review view, and the payroll CSV.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const { formatInZone } = await import("@/lib/time");
const actions = await import("@/modules/attendance/hours-actions");
const queries = await import("@/modules/attendance/hours-queries");
const jobs = await import("@/modules/attendance/jobs");
const { addDays, mondayOf } = await import("@/modules/attendance/pay-periods");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
const PHX = "America/Phoenix";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const today = () => formatInZone(Date.now(), PHX, "yyyy-MM-dd");
/** A Monday in the past, a whole week behind this one, so every day of it is finished. */
const lastWeek = () => mondayOf(addDays(today(), -8));
const at = (date: string, time: string) => fromZonedTime(`${date}T${time}:00`, PHX).toISOString();

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
async function person(label: string, opts: { managerId?: string; roles?: RoleSlug[]; lastName?: string } = {}) {
  const user = await makeUser(label, opts.roles ?? ["employee"]);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id)
    values (${label}, ${opts.lastName ?? uniq(label)}, ${user.email}, 'active', ${user.id}, ${opts.managerId ?? null}) returning id`);
  return { user, employeeId: e.id };
}
const event = (employeeId: string, type: string, when: string) => db.execute(sql`insert into time.clock_events (employee_id, type, occurred_at) values (${employeeId}, ${type}, ${when})`);
/** Two normal days (Monday and Tuesday of the week, 9 to 5 with a lunch hour = exactly the scheduled 7 hours) and a schedule that covers only those days. */
async function normalWeek(employeeId: string, weekStart: string, o: { lateOnMonday?: boolean } = {}) {
  await db.execute(sql`insert into time.schedules (employee_id, effective_from, start_time, end_time, weekdays, break_minutes, zone) values (${employeeId}, ${addDays(weekStart, -20)}::date, '09:00', '17:00', array[1,2]::smallint[], 60, ${PHX})`);
  for (const [i, start] of [o.lateOnMonday ? "09:40" : "09:00", "09:00"].entries()) {
    const d = addDays(weekStart, i);
    await event(employeeId, "clock_in", at(d, start));
    await event(employeeId, "break_start", at(d, "12:00"));
    await event(employeeId, "break_end", at(d, "13:00"));
    await event(employeeId, "clock_out", at(d, "17:00"));
  }
}
const approvals = (employeeId: string) => rows<{ date: string; worked_minutes: number; extra_minutes: number }>(sql`select date::text as date, worked_minutes, extra_minutes from time.hours_approvals where employee_id = ${employeeId} order by date, approved_at`);
const notes = (userId: string, kind: string) => rows(sql`select 1 from ops.notifications where user_id = ${userId} and kind = ${kind}`);

let hr: TestUser;
beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin", "employee"]);
});
afterAll(async () => {
  await db.execute(sql`update time.hours_settings set pay_period_kind = 'semi_monthly' where id = 1`);
});

describe("approving a week", () => {
  it("lets the lead approve a finished week, saves what was approved, tells the person, and does nothing the second time", async () => {
    const W = lastWeek();
    const lead = await person("ApLead", { roles: ["team_lead", "employee"] });
    const worker = await person("ApWorker", { managerId: lead.employeeId });
    await normalWeek(worker.employeeId, W);
    as(lead.user);
    expect(await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W, note: "Looks right" })).toEqual({ ok: true, data: { approved: 2 } });
    expect(await approvals(worker.employeeId)).toEqual([
      { date: W, worked_minutes: 420, extra_minutes: 0 },
      { date: addDays(W, 1), worked_minutes: 420, extra_minutes: 0 },
    ]);
    expect(await notes(worker.user.id, "hours.approved")).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'hours.approve' and target_id = ${worker.employeeId}`)).toHaveLength(1);
    expect(await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W })).toEqual({ ok: true, data: { approved: 0 } });
    expect(await approvals(worker.employeeId)).toHaveLength(2); // nothing new was stored
  });

  it("refuses the person themselves, people outside the chain, and everyone who is not a lead or HR", async () => {
    const W = lastWeek();
    const lead = await person("RefLead", { roles: ["team_lead", "employee"] });
    const worker = await person("RefWorker", { managerId: lead.employeeId });
    await normalWeek(worker.employeeId, W);
    as({ ...worker.user, roles: ["team_lead", "employee"] }); // even a lead cannot approve their own hours
    expect(await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W })).toEqual({ ok: false, error: "Someone else must approve your hours." });
    as((await person("RefOutsider", { roles: ["team_lead", "employee"] })).user);
    expect(await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W })).toEqual({ ok: false, error: NO_ACCESS });
    for (const role of ["employee", "recruiter", "executive"] as RoleSlug[]) {
      as(await makeUser("noapprove", [role]));
      expect(await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W })).toEqual({ ok: false, error: NO_ACCESS });
    }
    as(hr);
    expect((await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W })).ok).toBe(true); // HR can approve anyone
    expect(await approvals(worker.employeeId)).toHaveLength(2);
  });

  it("checks the week: a Monday, not too old, finished, and nobody still clocked in", async () => {
    const lead = await person("ChkLead", { roles: ["team_lead", "employee"] });
    const worker = await person("ChkWorker", { managerId: lead.employeeId });
    as(lead.user);
    const ask = (weekStart: string) => actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart });
    expect(await ask(addDays(lastWeek(), 1))).toEqual({ ok: false, error: "A week starts on a Monday." });
    expect((await ask(addDays(lastWeek(), -70))).ok).toBe(false); // ten weeks back
    expect(await ask(addDays(mondayOf(today()), 7))).toEqual({ ok: false, error: "Nothing to approve yet: the first day of that week is not over." });
    expect((await ask("not-a-date")).ok).toBe(false);

    // Still clocked in since yesterday: their hours for that week are not final
    await event(worker.employeeId, "clock_in", at(addDays(today(), -1), "09:00"));
    const result = await ask(mondayOf(addDays(today(), -1)));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain("still clocked in");
  });

  it("shows a day as changed after approval when a correction alters it, and approves again as a new row", async () => {
    const W = lastWeek();
    const lead = await person("ChgLead", { roles: ["team_lead", "employee"] });
    const worker = await person("ChgWorker", { managerId: lead.employeeId });
    await normalWeek(worker.employeeId, W);
    as(lead.user);
    await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W });
    // An approved correction adds a late session on Monday
    await event(worker.employeeId, "clock_in", at(W, "18:00"));
    await event(worker.employeeId, "clock_out", at(W, "19:00"));
    await jobs.rebuildAttendanceDays(new Date(), 12);

    let review = await queries.getTeamReview(W);
    let row = review.rows.find((r) => r.employeeId === worker.employeeId)!;
    expect(row.state).toBe("changed");
    expect(row.days.map((d) => d.state)).toEqual(["changed", "approved"]);
    expect(row.canApprove).toBe(true);

    expect(await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W })).toEqual({ ok: true, data: { approved: 1 } }); // only the changed day
    expect(await approvals(worker.employeeId)).toHaveLength(3); // the old approval is kept, never edited
    review = await queries.getTeamReview(W);
    row = review.rows.find((r) => r.employeeId === worker.employeeId)!;
    expect(row.state).toBe("approved");
    expect(row.days[0].workedMinutes).toBe(480);

    // Approvals are append-only, even for the database owner
    await expect(db.execute(sql`update time.hours_approvals set worked_minutes = 1 where employee_id = ${worker.employeeId}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from time.hours_approvals where employee_id = ${worker.employeeId}`)).rejects.toThrow();
  });
});

describe("approving everyone without flags", () => {
  it("approves the clean weeks, leaves people with flags for a person to look at, and skips people still clocked in", async () => {
    const W = lastWeek();
    const lead = await person("BulkLead", { roles: ["team_lead", "employee"] });
    const clean = await person("BulkClean", { managerId: lead.employeeId });
    const late = await person("BulkLate", { managerId: lead.employeeId });
    const open = await person("BulkOpen", { managerId: lead.employeeId });
    await normalWeek(clean.employeeId, W);
    await normalWeek(late.employeeId, W, { lateOnMonday: true });
    await normalWeek(open.employeeId, W);
    await event(open.employeeId, "clock_in", at(addDays(today(), -1), "09:00")); // clocked in since yesterday, never out

    as(lead.user);
    await jobs.rebuildAttendanceDays(new Date(), 12);
    const result = await actions.approveCleanWeeks({ weekStart: W });
    expect(result.ok).toBe(true);
    const data = result.ok ? result.data : null;
    expect(data?.approved).toBeGreaterThanOrEqual(1);
    expect(data?.withFlags).toBeGreaterThanOrEqual(1);
    expect(await approvals(clean.employeeId)).toHaveLength(2);
    expect(await approvals(late.employeeId)).toHaveLength(0); // late on Monday: a lead must look
    expect((await queries.getTeamReview(W)).rows.find((r) => r.employeeId === late.employeeId)?.flags).toContain("late");
    expect(await actions.approveCleanWeeks({ weekStart: W })).toMatchObject({ ok: true, data: { approved: 0 } }); // nothing left that is clean

    // The person with a flag can still be approved by hand
    expect((await actions.approveHoursWeek({ employeeId: late.employeeId, weekStart: W })).ok).toBe(true);
    for (const role of ["employee", "recruiter", "executive"] as RoleSlug[]) {
      as(await makeUser("nobulk", [role]));
      expect(await actions.approveCleanWeeks({ weekStart: W })).toEqual({ ok: false, error: NO_ACCESS });
    }
  });
});

describe("the review view", () => {
  it("shows a lead their team's week, HR everyone, and nobody else anything", async () => {
    const W = lastWeek();
    const lead = await person("ViewLead", { roles: ["team_lead", "employee"] });
    const mine = await person("ViewMine", { managerId: lead.employeeId });
    const other = await person("ViewOther");
    await normalWeek(mine.employeeId, W);
    await normalWeek(other.employeeId, W);
    await jobs.rebuildAttendanceDays(new Date(), 12);

    as(lead.user);
    const review = await queries.getTeamReview(W);
    expect(review.scope).toBe("team");
    expect(review.weekStart).toBe(W);
    expect(review.rows.map((r) => r.employeeId)).toEqual([mine.employeeId]);
    expect(review.rows[0]).toMatchObject({ scheduledMinutes: 840, workedMinutes: 840, extraMinutes: 0, state: "none", canApprove: true });
    expect(review.pending).toBe(1);

    as(hr);
    expect((await queries.getTeamReview(W)).rows.map((r) => r.employeeId)).toEqual(expect.arrayContaining([mine.employeeId, other.employeeId]));
    // Any date in the week gives that week; the default is last week
    expect((await queries.getTeamReview(addDays(W, 3))).weekStart).toBe(W);
    expect((await queries.getTeamReview()).weekStart).toBe(mondayOf(addDays(today(), -7)));

    for (const role of ["employee", "recruiter", "executive"] as RoleSlug[]) {
      as(await makeUser("noview", [role]));
      await expect(queries.getTeamReview(W)).rejects.toThrow();
    }
  });
});

describe("the payroll export", () => {
  async function approvedWeek(label: string, lastName?: string) {
    const W = lastWeek();
    const lead = await person(`${label}Lead`, { roles: ["team_lead", "employee"] });
    const worker = await person(label, { managerId: lead.employeeId, lastName });
    await normalWeek(worker.employeeId, W);
    as(lead.user);
    await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W });
    return { W, lead, worker };
  }
  const csvRows = (csv: string) => csv.trim().split("\r\n").map((line) => line.split(","));

  it("includes only approved days by default, with the numbers that were approved, and audits the export", async () => {
    const { W, worker } = await approvedWeek("ExpA");
    const other = await person("ExpUnapproved");
    await normalWeek(other.employeeId, W);
    await jobs.rebuildAttendanceDays(new Date(), 12);
    as(hr);
    expect(await actions.savePayPeriod({ kind: "weekly" })).toEqual({ ok: true, data: undefined });
    const out = await actions.exportHours({ periodStart: W, kind: "daily", includeUnapproved: false });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.fileName).toBe(`hours-daily-${W}_to_${addDays(W, 6)}.csv`);
    const table = csvRows(out.data.csv);
    expect(table[0]).toEqual(expect.arrayContaining(["Person", "Date", "Worked hours", "Regular hours", "Extra hours (approved)", "Extra hours (not approved)", "Approval", "Approved by", "Approved on"]));
    const mine = table.filter((r) => r[1] === worker.user.email);
    expect(mine).toHaveLength(2);
    const col = (name: string) => table[0].indexOf(name);
    expect(mine.map((r) => r[col("Date")])).toEqual([W, addDays(W, 1)]);
    expect(mine[0][col("Worked hours")]).toBe("7");
    expect(mine[0][col("Approval")]).toBe("Approved");
    expect(mine[0][col("Shift")]).toContain("9:00 AM - 5:00 PM");
    expect(table.some((r) => r[1] === other.user.email)).toBe(false); // not approved: left out
    expect(await rows(sql`select 1 from ops.audit_log where action = 'hours.export' and actor_user_id = ${hr.id}`)).not.toHaveLength(0);

    // With the unapproved days included they are labelled
    const all = await actions.exportHours({ periodStart: W, kind: "daily", includeUnapproved: true });
    const allTable = csvRows(all.ok ? all.data.csv : "");
    expect(allTable.filter((r) => r[1] === other.user.email).map((r) => r[allTable[0].indexOf("Approval")])).toEqual(["Not approved", "Not approved"]);
  });

  it("leaves out a day that was corrected after approval until it is approved again", async () => {
    const { W, lead, worker } = await approvedWeek("ExpChanged");
    await event(worker.employeeId, "clock_in", at(W, "18:00"));
    await event(worker.employeeId, "clock_out", at(W, "19:00"));
    await jobs.rebuildAttendanceDays(new Date(), 12);
    as(hr);
    await actions.savePayPeriod({ kind: "weekly" });
    const before = await actions.exportHours({ periodStart: W, kind: "daily", includeUnapproved: false });
    expect(csvRows(before.ok ? before.data.csv : "").filter((r) => r[1] === worker.user.email)).toHaveLength(1); // only Tuesday
    const labelled = await actions.exportHours({ periodStart: W, kind: "daily", includeUnapproved: true });
    const t = csvRows(labelled.ok ? labelled.data.csv : "");
    expect(t.filter((r) => r[1] === worker.user.email).map((r) => r[t[0].indexOf("Approval")])).toEqual(["Changed after approval", "Approved"]);
    as(lead.user);
    await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W });
    as(hr);
    const after = await actions.exportHours({ periodStart: W, kind: "daily", includeUnapproved: false });
    const rowsAfter = csvRows(after.ok ? after.data.csv : "").filter((r) => r[1] === worker.user.email);
    expect(rowsAfter).toHaveLength(2);
    expect(rowsAfter[0][csvRows(after.ok ? after.data.csv : "")[0].indexOf("Worked hours")]).toBe("8");
  });

  it("totals a person's period in the summary, with approved leave days", async () => {
    const { W, worker } = await approvedWeek("ExpSum");
    const [type] = await rows<{ id: string }>(sql`select id from time.leave_types where slug = 'unpaid_day'`);
    const leaveDay = addDays(W, 1); // Tuesday: a scheduled day
    await db.execute(sql`insert into time.leave_requests (employee_id, leave_type_id, start_date, end_date, half_day, days, status, filed_by, step_started_on)
      values (${worker.employeeId}, ${type.id}, ${leaveDay}::date, ${leaveDay}::date, false, 1, 'approved', ${worker.user.id}, current_date)`);
    as(hr);
    await actions.savePayPeriod({ kind: "weekly" });
    const out = await actions.exportHours({ periodStart: W, kind: "summary", includeUnapproved: false });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const t = csvRows(out.data.csv);
    const me = t.find((r) => r[1] === worker.user.email)!;
    const col = (name: string) => t[0].indexOf(name);
    expect(me[col("Days included")]).toBe("2");
    expect(me[col("Worked hours")]).toBe("14");
    expect(me[col("Scheduled hours")]).toBe("14");
    expect(me[col("Extra hours (approved)")]).toBe("0");
    expect(me[col("Approved leave days")]).toBe("1");
  });

  it("makes names safe for a spreadsheet, and only HR can export or change the pay periods", async () => {
    const { W, worker } = await approvedWeek("ExpSafe");
    await db.execute(sql`update core.employees set legal_first_name = '=HYPERLINK(bad)' where id = ${worker.employeeId}`);
    as(hr);
    await actions.savePayPeriod({ kind: "weekly" });
    const out = await actions.exportHours({ periodStart: W, kind: "daily", includeUnapproved: false });
    expect(out.ok && out.data.csv).toContain("'=HYPERLINK(bad)"); // a name that starts with = is never run as a formula
    expect(out.ok && out.data.csv).not.toMatch(/(^|,)=HYPERLINK/m);

    expect(await actions.exportHours({ periodStart: addDays(W, 1), kind: "daily", includeUnapproved: false })).toEqual({ ok: false, error: "That is not the first day of a pay period." });
    expect((await actions.exportHours({ periodStart: W, kind: "yearly", includeUnapproved: false })).ok).toBe(false);
    for (const role of ["team_lead", "recruiter", "executive", "employee"] as RoleSlug[]) {
      as(await makeUser("noexport", [role]));
      expect(await actions.exportHours({ periodStart: W, kind: "daily", includeUnapproved: false })).toEqual({ ok: false, error: NO_ACCESS });
      expect(await actions.savePayPeriod({ kind: "weekly" })).toEqual({ ok: false, error: NO_ACCESS });
      await expect(queries.getHoursSettings()).rejects.toThrow();
    }
  });

  it("lets HR pick how pay periods are cut, and the export follows", async () => {
    as(hr);
    expect(await actions.savePayPeriod({ kind: "biweekly", biweeklyAnchor: "2026-01-06" })).toEqual({ ok: false, error: "The first day of a two-week period must be a Monday." });
    expect((await actions.savePayPeriod({ kind: "biweekly", biweeklyAnchor: "2026-01-05" })).ok).toBe(true);
    const settings = await queries.getHoursSettings();
    expect(settings.kind).toBe("biweekly");
    expect(settings.periods).toHaveLength(8);
    expect(new Date(`${settings.periods[0].start}T00:00:00Z`).getUTCDay()).toBe(1);
    expect((await actions.exportHours({ periodStart: settings.periods[1].start, kind: "summary", includeUnapproved: false })).ok).toBe(true);
    await actions.savePayPeriod({ kind: "semi_monthly" });
    expect((await queries.getHoursSettings()).periods[0].start.slice(8)).toMatch(/^(01|16)$/);
  });
});

describe("so payroll is not short: reminders and progress", () => {
  const mondayMorning = (weekStart: string) => new Date(`${addDays(weekStart, 7)}T08:00:00+08:00`); // Monday 8 AM Manila, the week after

  it("reminds each lead about their people's unapproved hours, HR about people with no lead, and stops once approved", async () => {
    const W = lastWeek();
    await db.execute(sql`delete from ops.notifications where kind = 'hours.approval_reminder'`);
    const lead = await person("RemLead", { roles: ["team_lead", "employee"] });
    const worker = await person("RemWorker", { managerId: lead.employeeId });
    const solo = await person("RemSolo");
    await normalWeek(worker.employeeId, W);
    await normalWeek(solo.employeeId, W);
    await jobs.rebuildAttendanceDays(new Date(), 14);

    const run = await jobs.runLeadApprovalReminders(mondayMorning(W));
    expect(run.leads).toBeGreaterThanOrEqual(1);
    const [n] = await rows<{ title: string; link: string }>(sql`select title, link from ops.notifications where user_id = ${lead.user.id} and kind = 'hours.approval_reminder'`);
    expect(n.title).toBe("1 person has hours waiting for your approval");
    expect(n.link).toBe(`/attendance?tab=review&rweek=${W}`);
    expect((await rows<{ title: string }>(sql`select title from ops.notifications where user_id = ${hr.id} and kind = 'hours.approval_reminder'`)).some((r) => r.title.includes("no lead"))).toBe(true);

    as(lead.user);
    await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W });
    await db.execute(sql`delete from ops.notifications where kind = 'hours.approval_reminder'`);
    await jobs.runLeadApprovalReminders(mondayMorning(W));
    expect(await notes(lead.user.id, "hours.approval_reminder")).toHaveLength(0); // nothing left for this lead
  });

  it("tells HR on Wednesday who is still holding up last week's hours", async () => {
    const W = lastWeek();
    await db.execute(sql`delete from ops.notifications where kind = 'hours.approval_summary'`);
    const lead = await person("SumLead", { roles: ["team_lead", "employee"] });
    for (const label of ["SumA", "SumB", "SumC"]) {
      const w = await person(label, { managerId: lead.employeeId });
      await normalWeek(w.employeeId, W);
    }
    await jobs.rebuildAttendanceDays(new Date(), 14);
    const run = await jobs.runHrApprovalSummary(new Date(`${addDays(W, 9)}T08:00:00+08:00`)); // Wednesday
    expect(run.people).toBeGreaterThanOrEqual(3);
    const [n] = await rows<{ title: string; body: string }>(sql`select title, body from ops.notifications where user_id = ${hr.id} and kind = 'hours.approval_summary'`);
    expect(n.title).toContain("not approved");
    expect(n.body).toContain("Unapproved days are left out of the payroll export.");
    expect(n.body).toContain("SumLead");
  });

  it("shows HR how much of a period is approved, by team, and warns when an export leaves days out", async () => {
    const W = lastWeek();
    const period = { start: W, end: addDays(W, 6), label: "last week" };
    const lead = await person("ProgLead", { roles: ["team_lead", "employee"] });
    const worker = await person("ProgWorker", { managerId: lead.employeeId });
    await normalWeek(worker.employeeId, W);
    await jobs.rebuildAttendanceDays(new Date(), 14);
    const before = await queries.periodProgress(period);
    expect(before.pendingDays).toBeGreaterThanOrEqual(2);
    expect(before.teams.length).toBeGreaterThan(0);

    as(lead.user);
    await actions.approveHoursWeek({ employeeId: worker.employeeId, weekStart: W });
    const after = await queries.periodProgress(period);
    expect(after.totalDays).toBe(before.totalDays);
    expect(after.pendingDays).toBe(before.pendingDays - 2);

    as(hr);
    await actions.savePayPeriod({ kind: "weekly" });
    const out = await actions.exportHours({ periodStart: W, kind: "daily", includeUnapproved: false });
    expect(out.ok && out.data.unapprovedDays).toBe(after.pendingDays);
    const settings = await queries.getHoursSettings();
    expect(settings.progress).toHaveLength(3);
    expect(settings.progress[0]).toMatchObject({ start: settings.periods[0].start });
  });
});
