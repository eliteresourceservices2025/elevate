import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for leave requests, approvals, cancellation, reminders and the team calendar (Phase 2.2).

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const timeoff = await import("@/modules/timeoff/actions");
const actions = await import("@/modules/timeoff/request-actions");
const queries = await import("@/modules/timeoff/request-queries");
const jobs = await import("@/modules/timeoff/request-jobs");
const { addDays } = await import("@/modules/timeoff/service");
const { todayInZone } = await import("@/modules/org/service");
const { isWorkingDay } = await import("@/modules/timeoff/workdays");

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

async function person(label: string, roles: RoleSlug[] = ["employee"], opts: { managerId?: string; teamId?: string; status?: string } = {}) {
  const user = await makeUser(label, roles);
  const n = uniq(label);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, team_id)
    values (${label}, ${n}, ${user.email}, ${opts.status ?? "active"}, ${user.id}, ${opts.managerId ?? null}, ${opts.teamId ?? null}) returning id`);
  return { user, employeeId: e.id, lastName: n };
}

async function makeTeam() {
  const [d] = await rows<{ id: string }>(sql`insert into core.departments (name) values (${uniq("Dept ")}) returning id`);
  const [t] = await rows<{ id: string }>(sql`insert into core.teams (department_id, name) values (${d.id}, ${uniq("Team ")}) returning id`);
  return t.id;
}

const typeId = async (slug: string) => (await rows<{ id: string }>(sql`select id from time.leave_types where slug = ${slug}`))[0].id;
const balanceOf = async (employeeId: string) => (await rows<{ b: number }>(sql`select coalesce(sum(days), 0)::float8 as b from time.leave_ledger where employee_id = ${employeeId}`))[0].b;

// A block of upcoming working days that no holiday touches, one block per call, so tests never overlap each other.
let cursor = addDays(today, 21);
async function workdays(count = 1): Promise<string[]> {
  const holidays = new Set((await rows<{ date: string }>(sql`select date::text as date from time.holidays where calendar = 'PH'`)).map((h) => h.date));
  const out: string[] = [];
  while (out.length < count) {
    if (isWorkingDay(cursor, holidays)) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  cursor = addDays(cursor, 1);
  return out;
}

/** A recent working day in the past (at least `back` days ago), for leave HR files after the fact. */
async function pastWorkday(back: number): Promise<string> {
  const holidays = new Set((await rows<{ date: string }>(sql`select date::text as date from time.holidays where calendar = 'PH'`)).map((h) => h.date));
  let d = addDays(today, -back);
  while (!isWorkingDay(d, holidays)) d = addDays(d, -1);
  return d;
}

let hr: TestUser;
let hr2: TestUser;
let hrEmployeeId: string;
let prize: string;

/** HR (a second admin, since nobody awards themselves) gives a person prize days. */
async function award(employeeId: string, days: number, slugId = prize) {
  as(hr2);
  const result = await timeoff.awardDays({ employeeId, leaveTypeId: slugId, days, reason: "Prize" });
  if (!result.ok) throw new Error(result.error);
}

async function request(actor: TestUser, extra: Record<string, unknown> = {}) {
  as(actor);
  const [day] = extra.startDate ? [extra.startDate as string] : await workdays(1);
  return actions.requestLeave({ leaveTypeId: prize, startDate: day, endDate: (extra.endDate as string) ?? day, ...extra });
}
const idOf = (r: { ok: boolean; data?: { id: string }; error?: string }) => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.data!.id;
};
const decide = (actor: TestUser, requestId: string, decision: "approve" | "decline", note?: string) => {
  as(actor);
  return actions.decideRequest({ requestId, decision, note });
};
const statusOf = async (requestId: string) => (await rows<{ status: string }>(sql`select status from time.leave_requests where id = ${requestId}`))[0].status;
const notes = (userId: string, kind: string) => rows(sql`select 1 from ops.notifications where user_id = ${userId} and kind = ${kind}`);

beforeAll(async () => {
  prize = await typeId("prize_day");
  ({ user: hr, employeeId: hrEmployeeId } = await person("hr", ["hr_admin", "employee"]));
  ({ user: hr2 } = await person("hr2", ["hr_admin", "employee"]));
});

describe("the two-step approval", () => {
  it("goes to the lead, then HR; approval writes the usage row and queues a calendar invite", async () => {
    const lead = await person("Lead", ["team_lead", "employee"]);
    const ana = await person("Ana", ["employee"], { managerId: lead.employeeId });
    await award(ana.employeeId, 2);

    const id = idOf(await request(ana.user));
    expect(await statusOf(id)).toBe("pending_lead");
    expect(await notes(lead.user.id, "timeoff.approval_needed")).toHaveLength(1);
    expect(await balanceOf(ana.employeeId)).toBe(2); // nothing is used until it is fully approved

    // Not HR at the lead step, not the person, not a stranger
    expect(await decide(hr2, id, "approve")).toEqual({ ok: false, error: "This step belongs to the person's lead. If it waits too long it goes to HR." });
    expect(await decide(ana.user, id, "approve")).toEqual({ ok: false, error: "Someone else must decide on your own request." });
    const stranger = await person("Stranger", ["team_lead", "employee"]);
    expect(await decide(stranger.user, id, "approve")).toEqual({ ok: false, error: NO_ACCESS });

    expect((await decide(lead.user, id, "approve")).ok).toBe(true);
    expect(await statusOf(id)).toBe("pending_hr");
    expect(await notes(hr2.id, "timeoff.approval_needed")).toHaveLength(1);
    expect(await notes(ana.user.id, "timeoff.lead_approved")).toHaveLength(1);
    expect(await balanceOf(ana.employeeId)).toBe(2);

    // The lead cannot give the HR step, and HR (not the requester) can
    expect(await decide(lead.user, id, "approve")).toEqual({ ok: false, error: NO_ACCESS });
    expect((await decide(hr2, id, "approve")).ok).toBe(true);
    expect(await statusOf(id)).toBe("approved");

    const [usage] = await rows<{ days: number; effective_on: string; request_id: string; entry_type: string }>(sql`select days::float8 as days, effective_on::text, request_id, entry_type from time.leave_ledger where request_id = ${id}`);
    const [req] = await rows<{ start_date: string }>(sql`select start_date::text from time.leave_requests where id = ${id}`);
    expect(usage).toEqual({ days: -1, effective_on: req.start_date, request_id: id, entry_type: "usage" });
    expect(await balanceOf(ana.employeeId)).toBe(1);

    expect(await notes(ana.user.id, "timeoff.approved")).toHaveLength(1);
    const [invite] = await rows<{ kind: string; attachment: { fileName: string; content: string } }>(sql`select kind, attachment from ops.email_queue where user_id = ${ana.user.id} and dedupe_key = ${`invite-approved:${id}`}`);
    expect(invite.kind).toBe("invite");
    expect(invite.attachment.fileName).toBe("time-off.ics");
    expect(invite.attachment.content).toContain(`DTSTART;VALUE=DATE:${req.start_date.replace(/-/g, "")}`);
    expect(invite.attachment.content).not.toContain("Prize"); // no detail about the leave type

    const approvals = await rows<{ level: string; decision: string }>(sql`select level, decision from time.leave_approvals where request_id = ${id} order by decided_at`);
    expect(approvals).toEqual([{ level: "lead", decision: "approved" }, { level: "hr", decision: "approved" }]);
    await expect(db.execute(sql`update time.leave_approvals set note = 'x' where request_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from time.leave_approvals where request_id = ${id}`)).rejects.toThrow();
    expect(await rows(sql`select 1 from ops.audit_log where action in ('leave.request','leave.approve') and metadata->>'requestId' = ${id}`)).toHaveLength(3);
  });

  it("skips HR for a type marked to skip it, and starts with HR when nobody is above the person", async () => {
    const lead = await person("SkipLead", ["team_lead", "employee"]);
    const ben = await person("Ben", ["employee"], { managerId: lead.employeeId });
    as(hr);
    expect((await timeoff.createLeaveType({ name: uniq("Quick day "), tracksBalance: true, skipHr: true })).ok).toBe(true);
    const [quick] = await rows<{ id: string }>(sql`select id from time.leave_types order by created_at desc limit 1`);
    await award(ben.employeeId, 1, quick.id);
    const id = idOf(await request(ben.user, { leaveTypeId: quick.id }));
    expect((await decide(lead.user, id, "approve")).ok).toBe(true);
    expect(await statusOf(id)).toBe("approved"); // the lead's approval was enough
    expect(await balanceOf(ben.employeeId)).toBe(0);

    const solo = await person("Solo"); // no manager: HR decides alone
    await award(solo.employeeId, 1);
    const soloId = idOf(await request(solo.user));
    expect(await statusOf(soloId)).toBe("pending_hr");
    expect((await decide(hr2, soloId, "approve")).ok).toBe(true);
  });

  it("never lets people decide on their own request, or on one they filed", async () => {
    await award(hrEmployeeId, 1);
    const id = idOf(await request(hr)); // HR asks for their own day: no lead above, so it waits for HR
    expect(await decide(hr, id, "approve")).toEqual({ ok: false, error: "Someone else must decide on your own request." });
    expect((await decide(hr2, id, "approve")).ok).toBe(true);

    const carol = await person("Carol");
    as(hr);
    const [day] = await workdays(1);
    const filed = idOf(await actions.requestLeave({ leaveTypeId: await typeId("unpaid_day"), startDate: day, endDate: day, employeeId: carol.employeeId }));
    expect(await decide(hr, filed, "approve")).toEqual({ ok: false, error: "Someone else must decide on your own request." }); // the filer cannot approve it
    expect((await decide(hr2, filed, "approve")).ok).toBe(true);
  });

  it("declining needs a reason, ends the request, and uses no days", async () => {
    const lead = await person("DeclineLead", ["team_lead", "employee"]);
    const dan = await person("Dan", ["employee"], { managerId: lead.employeeId });
    await award(dan.employeeId, 1);
    const id = idOf(await request(dan.user));

    expect(await decide(lead.user, id, "decline")).toEqual({ ok: false, error: "Give a short reason so the person knows why." });
    expect((await decide(lead.user, id, "decline", "Team is short that day")).ok).toBe(true);
    expect(await statusOf(id)).toBe("declined");
    expect(await balanceOf(dan.employeeId)).toBe(1);
    expect(await notes(dan.user.id, "timeoff.declined")).toHaveLength(1);
    expect(await decide(hr2, id, "approve")).toEqual({ ok: false, error: "That request was already handled." });

    // HR may decline at the lead step (but not approve it)
    const id2 = idOf(await request(dan.user));
    expect((await decide(hr2, id2, "decline", "Blackout period")).ok).toBe(true);
    expect(await statusOf(id2)).toBe("declined");
    const [step] = await rows<{ level: string }>(sql`select level from time.leave_approvals where request_id = ${id2}`);
    expect(step.level).toBe("hr");
  });

  it("checks the balance again at approval time", async () => {
    const lead = await person("RecheckLead", ["team_lead", "employee"]);
    const eve = await person("Eve", ["employee"], { managerId: lead.employeeId });
    await award(eve.employeeId, 1);
    const id = idOf(await request(eve.user));
    expect((await decide(lead.user, id, "approve")).ok).toBe(true);

    as(hr2); // HR removes the day before the final approval
    expect((await timeoff.adjustBalance({ employeeId: eve.employeeId, leaveTypeId: prize, days: -1, reason: "Awarded by mistake" })).ok).toBe(true);
    const result = await decide(hr, id, "approve");
    expect(result).toEqual({ ok: false, error: "There are not enough usable prize days for this request any more. Decline it, or add days first." });
    expect(await statusOf(id)).toBe("pending_hr"); // nothing half-done
    expect(await rows(sql`select 1 from time.leave_ledger where request_id = ${id}`)).toHaveLength(0);
  });
});

describe("making a request", () => {
  it("refuses the wrong dates, amounts and people", async () => {
    const fay = await person("Fay");
    await award(fay.employeeId, 1);
    const [day] = await workdays(1);
    const ask = (over: Record<string, unknown>) => {
      as(fay.user);
      return actions.requestLeave({ leaveTypeId: prize, startDate: day, endDate: day, ...over });
    };

    expect(await ask({ startDate: addDays(today, -3), endDate: addDays(today, -3) })).toEqual({ ok: false, error: "Requests cannot start in the past. Ask HR to file it for you." });
    expect(await ask({ startDate: today, endDate: today })).toEqual({ ok: false, error: "Ask at least one working day ahead." });
    expect((await ask({ endDate: addDays(day, -1) })).ok).toBe(false);
    expect((await ask({ leaveTypeId: randomUUID() })).ok).toBe(false);
    expect((await ask({ halfDay: true, endDate: addDays(day, 1) })).ok).toBe(false);

    const saturday = (() => { let d = addDays(today, 30); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 6) d = addDays(d, 1); return d; })();
    expect(await ask({ startDate: saturday, endDate: saturday })).toEqual({ ok: false, error: "There are no working days in that range." });

    const [two] = await workdays(2);
    const tooMuch = await ask({ startDate: two, endDate: addDays(two, 4) }); // 5 days against a balance of 1
    expect(tooMuch.ok).toBe(false);
    expect(tooMuch.ok ? "" : tooMuch.error).toContain("You have 1 day available");

    // A half day works, and reserves only half
    const [half] = await workdays(1);
    expect((await ask({ startDate: half, endDate: half, halfDay: true })).ok).toBe(true);
    const [next] = await workdays(1);
    const rest = await ask({ startDate: next, endDate: next });
    expect(rest.ok).toBe(false);
    expect(rest.ok ? "" : rest.error).toContain("0.5 days already waiting for approval");

    // A person with no people record, and a separated person filed by HR
    const noProfile = await makeUser("noprofile", ["employee"]);
    as(noProfile);
    expect(await actions.requestLeave({ leaveTypeId: prize, startDate: day, endDate: day })).toEqual({ ok: false, error: "Your people record is not set up yet. Ask HR." });
    const gone = await person("Gone", ["employee"], { status: "separated" });
    as(hr);
    expect(await actions.requestLeave({ leaveTypeId: prize, startDate: day, endDate: day, employeeId: gone.employeeId })).toEqual({ ok: false, error: "That person was not found." });
    // Only HR files for others
    as(fay.user);
    expect(await actions.requestLeave({ leaveTypeId: prize, startDate: day, endDate: day, employeeId: hrEmployeeId })).toEqual({ ok: false, error: NO_ACCESS });
  });

  it("does not count weekends or holidays, and a holiday-only range is refused", async () => {
    const gil = await person("Gil");
    await award(gil.employeeId, 5);
    // Find a Monday-to-Friday week containing a PH holiday inside the seeded years
    const [h] = await rows<{ date: string }>(sql`select date::text as date from time.holidays where calendar = 'PH' and date > ${addDays(today, 30)}::date and extract(dow from date) between 2 and 4 order by date limit 1`);
    const d = new Date(`${h.date}T00:00:00Z`);
    const monday = addDays(h.date, -((d.getUTCDay() + 6) % 7));
    const friday = addDays(monday, 4);
    const preview = async (start: string, end: string) => {
      as(gil.user);
      const r = await actions.previewRequest({ leaveTypeId: prize, startDate: start, endDate: end });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    };
    const week = await preview(monday, friday);
    expect(week.days).toBe(4); // the holiday is not counted
    expect(week.holidays.map((x) => x.date)).toContain(h.date);
    expect(week.balance).toEqual({ balance: 5, reserved: 0, available: 5 });
    const weekend = await preview(addDays(monday, 5), addDays(monday, 6));
    expect(weekend.days).toBe(0);
    const only = await preview(h.date, h.date);
    expect(only.days).toBe(0);
    as(gil.user);
    expect(await actions.requestLeave({ leaveTypeId: prize, startDate: h.date, endDate: h.date })).toEqual({ ok: false, error: "There are no working days in that range." });
  });

  it("refuses overlapping requests, even two made at the same moment, but frees the days after a cancellation", async () => {
    const hal = await person("Hal");
    await award(hal.employeeId, 3);
    const [a, b] = await workdays(2);
    const first = idOf(await request(hal.user, { startDate: a, endDate: b }));
    const clash = await request(hal.user, { startDate: b, endDate: b });
    expect(clash).toEqual({ ok: false, error: "There is already a request covering some of those days." });

    const [c] = await workdays(1);
    const settled = await Promise.all([request(hal.user, { startDate: c, endDate: c }), request(hal.user, { startDate: c, endDate: c })]);
    expect(settled.filter((r) => r.ok)).toHaveLength(1);

    as(hal.user);
    expect((await actions.cancelRequest({ requestId: first })).ok).toBe(true);
    expect((await request(hal.user, { startDate: b, endDate: b })).ok).toBe(true);
  });

  it("lets HR file for someone else, including a past date, still with approval", async () => {
    const lead = await person("FileLead", ["team_lead", "employee"]);
    const ivy = await person("Ivy", ["employee"], { managerId: lead.employeeId });
    const past = await pastWorkday(4);
    as(hr);
    const id = idOf(await actions.requestLeave({ leaveTypeId: await typeId("unpaid_day"), startDate: past, endDate: past, employeeId: ivy.employeeId }));
    expect(await statusOf(id)).toBe("pending_lead");
    expect(await notes(ivy.user.id, "timeoff.filed_for_you")).toHaveLength(1);
    const [row] = await rows<{ filed_by: string }>(sql`select filed_by from time.leave_requests where id = ${id}`);
    expect(row.filed_by).toBe(hr.id);
    // Unpaid leave uses no balance
    expect((await decide(lead.user, id, "approve")).ok).toBe(true);
    expect((await decide(hr2, id, "approve")).ok).toBe(true);
    expect(await rows(sql`select 1 from time.leave_ledger where request_id = ${id}`)).toHaveLength(0);
  });
});

describe("cancelling", () => {
  it("cancels a pending request, and reverses an approved one that has not started", async () => {
    const lead = await person("CancelLead", ["team_lead", "employee"]);
    const jo = await person("Jo", ["employee"], { managerId: lead.employeeId });
    await award(jo.employeeId, 2);

    const pending = idOf(await request(jo.user));
    as(jo.user);
    expect((await actions.cancelRequest({ requestId: pending, reason: "Plans changed" })).ok).toBe(true);
    expect(await statusOf(pending)).toBe("cancelled");
    expect(await actions.cancelRequest({ requestId: pending })).toEqual({ ok: false, error: "That request is already closed." });

    const id = idOf(await request(jo.user));
    await decide(lead.user, id, "approve");
    await decide(hr2, id, "approve");
    expect(await balanceOf(jo.employeeId)).toBe(1);

    as(jo.user);
    expect((await actions.cancelRequest({ requestId: id, reason: "Plans changed" })).ok).toBe(true);
    expect(await balanceOf(jo.employeeId)).toBe(2); // the day is back
    const [start] = await rows<{ start_date: string }>(sql`select start_date::text from time.leave_requests where id = ${id}`);
    const [reversal] = await rows<{ days: number; effective_on: string }>(sql`select days::float8 as days, effective_on::text from time.leave_ledger where request_id = ${id} and entry_type = 'reversal'`);
    expect(reversal).toEqual({ days: 1, effective_on: start.start_date }); // dated with the leave, so the ledger replays it in order
    expect(await rows(sql`select 1 from ops.email_queue where user_id = ${jo.user.id} and dedupe_key = ${`invite-cancel:${id}`}`)).toHaveLength(1);

    // Cancelling twice does not reverse twice
    expect(await actions.cancelRequest({ requestId: id })).toEqual({ ok: false, error: "That request is already closed." });
    expect(await balanceOf(jo.employeeId)).toBe(2);
  });

  it("lets only HR cancel leave that has already started, and only the person or HR cancel at all", async () => {
    const lead = await person("StartedLead", ["team_lead", "employee"]);
    const kim = await person("Kim", ["employee"], { managerId: lead.employeeId });
    // The day was awarded a week ago, before the leave that HR files after the fact
    await db.execute(sql`insert into time.leave_ledger (employee_id, leave_type_id, entry_type, days, effective_on, reason) values (${kim.employeeId}, ${prize}, 'award', 1, ${addDays(today, -7)}, 'Prize')`);

    // File approved leave for a past date through HR, then try to cancel it
    as(hr);
    const past = await pastWorkday(3);
    const id = idOf(await actions.requestLeave({ leaveTypeId: prize, startDate: past, endDate: past, employeeId: kim.employeeId }));
    await decide(lead.user, id, "approve");
    await decide(hr2, id, "approve");
    expect(await balanceOf(kim.employeeId)).toBe(0);

    as(kim.user);
    expect(await actions.cancelRequest({ requestId: id })).toEqual({ ok: false, error: "That leave has started. Ask HR to cancel it." });
    as(lead.user);
    expect(await actions.cancelRequest({ requestId: id })).toEqual({ ok: false, error: NO_ACCESS });
    const other = await person("Other");
    as(other.user);
    expect(await actions.cancelRequest({ requestId: id })).toEqual({ ok: false, error: NO_ACCESS });

    as(hr2);
    expect((await actions.cancelRequest({ requestId: id, reason: "Was actually at work" })).ok).toBe(true);
    expect(await balanceOf(kim.employeeId)).toBe(1);
    const [reversal] = await rows<{ effective_on: string }>(sql`select effective_on::text from time.leave_ledger where request_id = ${id} and entry_type = 'reversal'`);
    expect(reversal.effective_on).toBe(today); // past leave: the reversal is dated today, after the usage
  });
});

describe("reminders and escalation", () => {
  /** A step start date that many working days ago (weekends skipped). */
  const workingDaysAgo = (n: number) => {
    let d = today;
    let left = n;
    while (left > 0) {
      d = addDays(d, -1);
      if (new Date(`${d}T00:00:00Z`).getUTCDay() % 6 !== 0) left -= 1;
    }
    return d;
  };
  const backdate = (id: string, date: string) => db.execute(sql`update time.leave_requests set step_started_on = ${date} where id = ${id}`);

  it("reminds after 2 working days, once, and sends a stale lead step to HR after 4", async () => {
    const lead = await person("RemLead", ["team_lead", "employee"]);
    const late = await person("Late", ["employee"], { managerId: lead.employeeId });
    const stale = await person("Stale", ["employee"], { managerId: lead.employeeId });
    const fresh = await person("Fresh", ["employee"], { managerId: lead.employeeId });
    for (const p of [late, stale, fresh]) await award(p.employeeId, 1);
    const lateId = idOf(await request(late.user));
    const staleId = idOf(await request(stale.user));
    const freshId = idOf(await request(fresh.user));
    await backdate(lateId, workingDaysAgo(2));
    await backdate(staleId, workingDaysAgo(4));

    const first = await jobs.runLeaveRequestReminders(today);
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect(first.escalated).toBeGreaterThanOrEqual(1);

    // Reminded once: the lead was told again about "Late", and it is still with the lead
    expect(await statusOf(lateId)).toBe("pending_lead");
    expect((await rows<{ reminded_at: Date | null }>(sql`select reminded_at from time.leave_requests where id = ${lateId}`))[0].reminded_at).not.toBeNull();
    // Stale escalated to HR, with a system step on record, and everyone told
    expect(await statusOf(staleId)).toBe("pending_hr");
    expect(await rows(sql`select 1 from time.leave_approvals where request_id = ${staleId} and decision = 'escalated' and decided_by is null and level = 'lead'`)).toHaveLength(1);
    expect(await notes(lead.user.id, "timeoff.escalated")).toHaveLength(1);
    expect(await statusOf(freshId)).toBe("pending_lead"); // too new to do anything

    const again = await jobs.runLeaveRequestReminders(today);
    expect(again.escalated).toBe(0);
    expect(await notes(lead.user.id, "timeoff.escalated")).toHaveLength(1);
    expect(await rows(sql`select 1 from time.leave_approvals where request_id = ${staleId} and decision = 'escalated'`)).toHaveLength(1);

    // The escalated request is now HR's to decide, and HR can
    expect((await decide(hr2, staleId, "approve")).ok).toBe(true);
    expect(await statusOf(staleId)).toBe("approved");
  });

  it("reminds HR once when a request waits there, and never escalates further", async () => {
    const mia = await person("Mia");
    await award(mia.employeeId, 1);
    const id = idOf(await request(mia.user)); // no lead: waits for HR
    await backdate(id, workingDaysAgo(5));
    const run = await jobs.runLeaveRequestReminders(today);
    expect(run.escalated).toBe(0);
    const [row] = await rows<{ status: string; reminded_at: Date | null }>(sql`select status, reminded_at from time.leave_requests where id = ${id}`);
    expect(row.status).toBe("pending_hr");
    expect(row.reminded_at).not.toBeNull();
    const again = await jobs.runLeaveRequestReminders(today);
    expect(again.reminded).toBe(0);
  });
});

describe("the approval queue", () => {
  it("shows a lead their downline, HR everything, and marks what each may decide", async () => {
    const lead = await person("QueueLead", ["team_lead", "employee"]);
    const report = await person("QueueReport", ["employee"], { managerId: lead.employeeId });
    const outsider = await person("QueueOutsider");
    await award(report.employeeId, 1);
    await award(outsider.employeeId, 1);
    const mine = idOf(await request(report.user));
    const theirs = idOf(await request(outsider.user)); // no lead: HR's

    as(lead.user);
    const leadQueue = await queries.listApprovalQueue();
    expect(leadQueue.scope).toBe("team");
    expect(leadQueue.items.map((i) => i.id)).toContain(mine);
    expect(leadQueue.items.map((i) => i.id)).not.toContain(theirs);
    expect(leadQueue.items.find((i) => i.id === mine)?.canDecide).toBe(true);

    as(hr2);
    const hrQueue = await queries.listApprovalQueue();
    expect(hrQueue.scope).toBe("all");
    expect(hrQueue.items.find((i) => i.id === theirs)?.canDecide).toBe(true); // the HR step
    expect(hrQueue.items.find((i) => i.id === mine)?.canDecide).toBe(false); // still the lead's step

    as(report.user);
    await expect(queries.listApprovalQueue()).rejects.toThrow("Forbidden");
    expect((await queries.listMyRequests()).map((r) => r.id)).toContain(mine);
    expect((await queries.listMyRequests()).find((r) => r.id === mine)?.canCancel).toBe(true);
    expect((await queries.listMyRequests()).find((r) => r.id === mine)?.canDecide).toBe(false);
    as(hr2);
    expect((await queries.listRequestsFor(report.employeeId)).map((r) => r.id)).toContain(mine);
    as(outsider.user);
    await expect(queries.listRequestsFor(report.employeeId)).rejects.toThrow("Forbidden");
  });
});

describe("the calendar file", () => {
  it("is available for approved time off only, to the person, their lead and HR", async () => {
    const lead = await person("IcsLead", ["team_lead", "employee"]);
    const ned = await person("Ned", ["employee"], { managerId: lead.employeeId });
    await award(ned.employeeId, 1);
    const id = idOf(await request(ned.user));
    as(ned.user);
    expect(await actions.getLeaveInvite({ requestId: id })).toEqual({ ok: false, error: "Only approved time off has a calendar file." });
    await decide(lead.user, id, "approve");
    await decide(hr2, id, "approve");
    for (const viewer of [ned.user, lead.user, hr2]) {
      as(viewer);
      const result = await actions.getLeaveInvite({ requestId: id });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.content).toContain("BEGIN:VCALENDAR");
    }
    as((await person("IcsOther")).user);
    expect(await actions.getLeaveInvite({ requestId: id })).toEqual({ ok: false, error: NO_ACCESS });
  });
});

describe("the team calendar", () => {
  it("shows each role only what it may see", async () => {
    const team = await makeTeam();
    const lead = await person("CalLead", ["team_lead", "employee"], { teamId: team });
    const a = await person("CalA", ["employee"], { managerId: lead.employeeId, teamId: team });
    const b = await person("CalB", ["employee"], { managerId: lead.employeeId, teamId: team });
    const far = await person("CalFar", ["employee"], { teamId: await makeTeam() });
    const exec = await person("CalExec", ["executive", "employee"]);
    for (const p of [a, b, far]) await award(p.employeeId, 1);

    const [day] = await workdays(1);
    // a's leave is approved; b's is still waiting; far's is approved
    const approve = async (p: typeof a, chain: TestUser | null) => {
      const id = idOf(await request(p.user, { startDate: day, endDate: day }));
      if (chain) await decide(chain, id, "approve");
      await decide(hr2, id, "approve");
      return id;
    };
    await approve(a, lead.user);
    await approve(far, null);
    const waiting = idOf(await request(b.user, { startDate: day, endDate: day }));
    expect(await statusOf(waiting)).toBe("pending_lead");

    const month = day.slice(0, 7);
    const names = (view: Awaited<ReturnType<typeof queries.getTeamCalendar>>) => view.entries.map((e) => e.name.split(" ")[0]).sort();
    const entry = (view: Awaited<ReturnType<typeof queries.getTeamCalendar>>, first: string) => view.entries.find((e) => e.name.split(" ")[0] === first);

    as(hr);
    const all = await queries.getTeamCalendar(month);
    expect(all.mode).toBe("all");
    expect(names(all)).toEqual(expect.arrayContaining(["CalA", "CalB", "CalFar"]));
    expect(entry(all, "CalA")).toMatchObject({ leaveType: "Prize day off", pending: false });
    expect(entry(all, "CalB")).toMatchObject({ pending: true });

    as(lead.user);
    const led = await queries.getTeamCalendar(month);
    expect(led.mode).toBe("team");
    expect(names(led)).toEqual(["CalA", "CalB"]);
    expect(led.entries.every((e) => e.leaveType === "Prize day off")).toBe(true);

    as(a.user); // a teammate: sees the team by name, approved only, and no leave type for others
    const peers = await queries.getTeamCalendar(month);
    expect(peers.mode).toBe("peers");
    expect(names(peers)).toEqual(["CalA"]); // b is still pending, far is another team, lead is not a peer's entry
    expect(peers.entries[0].leaveType).toBe("Prize day off"); // their own

    as(b.user);
    const bView = await queries.getTeamCalendar(month);
    expect(names(bView)).toEqual(["CalA"]);
    expect(bView.entries[0].leaveType).toBeNull(); // someone else's type stays hidden

    as(exec.user);
    const counts = await queries.getTeamCalendar(month);
    expect(counts.mode).toBe("counts");
    expect(counts.entries).toEqual([]); // no names for an executive
    expect(new Map(Object.entries(counts.counts)).get(day)).toBeGreaterThanOrEqual(2);

    // Holidays appear on the calendar
    const [holiday] = await rows<{ date: string }>(sql`select date::text as date from time.holidays where calendar = 'PH' order by date desc limit 1`);
    as(a.user);
    expect((await queries.getTeamCalendar(holiday.date.slice(0, 7))).holidays.map((h) => h.date)).toContain(holiday.date);
    expect((await queries.getTeamCalendar("not-a-month")).month).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe("previewing a request", () => {
  it("shows which teammates are already off, by name, and the person's balance with reserved days", async () => {
    const team = await makeTeam();
    const me = await person("PrevMe", ["employee"], { teamId: team });
    const mate = await person("PrevMate", ["employee"], { teamId: team });
    await award(me.employeeId, 2);
    await award(mate.employeeId, 1);
    const [day] = await workdays(1);
    const mateId = idOf(await request(mate.user, { startDate: day, endDate: day }));
    await decide(hr2, mateId, "approve");

    const [other] = await workdays(1);
    idOf(await request(me.user, { startDate: other, endDate: other }));
    as(me.user);
    const preview = await actions.previewRequest({ leaveTypeId: prize, startDate: day, endDate: day });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.data.teammatesOff).toEqual([expect.stringContaining("PrevMate")]);
    expect(preview.data.balance).toEqual({ balance: 2, reserved: 1, available: 1 });
  });
});
