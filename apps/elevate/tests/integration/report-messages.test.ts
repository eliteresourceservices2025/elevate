import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// A message thread on each report (owner request 2026-11-25): the person who reported and whoever handles it can talk on the report itself.
// Kept with the report, encrypted, append-only; notifications and the audit log never carry the text.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/reports/actions");
const queries = await import("@/modules/reports/queries");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
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
async function person(label: string, opts: { managerId?: string; roles?: RoleSlug[] } = {}) {
  const user = await makeUser(label, opts.roles ?? ["employee"]);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id) values (${label}, ${uniq(label)}, ${user.email}, 'active', ${user.id}, ${opts.managerId ?? null}) returning id`);
  return { user, employeeId: e.id };
}
const notices = (userId: string) => rows<{ kind: string; title: string; body: string | null; link: string | null }>(sql`select kind, title, body, link from ops.notifications where user_id = ${userId} and kind = 'report.message'`);

let hr: TestUser;
let lead: { user: TestUser; employeeId: string };
let otherLead: { user: TestUser; employeeId: string };
let va: { user: TestUser; employeeId: string };
let stranger: { user: TestUser; employeeId: string };
let issueId: string;

beforeAll(async () => {
  hr = await makeUser("rmHr", ["hr_admin"]);
  lead = await person("rmLead", { roles: ["team_lead", "employee"] });
  otherLead = await person("rmOtherLead", { roles: ["team_lead", "employee"] });
  va = await person("rmVa", { managerId: lead.employeeId });
  stranger = await person("rmStranger");
  [{ id: issueId }] = await rows<{ id: string }>(sql`insert into time.tech_issue_reports (employee_id, reported_by, kind, happened_at, details) values (${va.employeeId}, ${va.user.id}, 'other', now(), 'It would not load') returning id`);
});

const post = (type: string, id: string, body: string) => actions.postReportMessage({ type, id, body });
const thread = (type: string, id: string) => queries.getReportThread({ type, id });

describe("talking on a report", () => {
  it("lets the reporter and the lead exchange messages, oldest first, with who wrote each", async () => {
    as(lead.user);
    expect((await post("tech_issue", issueId, "Can you send the router log?")).ok).toBe(true);
    as(va.user);
    expect((await post("tech_issue", issueId, "Sent it just now.")).ok).toBe(true);
    const t = await thread("tech_issue", issueId);
    expect(t.messages.map((m) => [m.authorKind, m.body])).toEqual([["handler", "Can you send the router log?"], ["reporter", "Sent it just now."]]);
    expect(t.messages.map((m) => m.mine)).toEqual([false, true]);
    expect(t.canPost).toBe(true);
  });

  it("lets HR in on it too, and tells the other side without any of the text", async () => {
    const secret = `SECRET-${uniq("txt")}`;
    as(hr);
    expect((await post("tech_issue", issueId, `Please look at ${secret}`)).ok).toBe(true);
    const mine = await notices(va.user.id);
    expect(mine.length).toBeGreaterThan(0);
    expect(JSON.stringify(mine)).not.toContain(secret);
    expect(mine.at(-1)!.link).toContain(issueId);
    const audit = await rows(sql`select metadata, before, after from ops.audit_log where action = 'report.message'`);
    expect(audit.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain(secret);
  });

  it("notifies the lead (or HR) when the reporter writes", async () => {
    const before = (await notices(lead.user.id)).length;
    as(va.user);
    await post("tech_issue", issueId, "Anything else you need?");
    expect((await notices(lead.user.id)).length).toBe(before + 1);
  });

  it("keeps the text encrypted in the database", async () => {
    const secret = `PLAIN-${uniq("txt")}`;
    as(va.user);
    await post("tech_issue", issueId, secret);
    const raw = await rows<{ body_enc: string }>(sql`select body_enc from ops.report_messages where report_id = ${issueId}`);
    expect(raw.length).toBeGreaterThan(0);
    expect(JSON.stringify(raw)).not.toContain(secret);
  });

  it("is closed to anyone who may not handle or own the report", async () => {
    for (const who of [stranger.user, otherLead.user]) {
      as(who);
      expect(await post("tech_issue", issueId, "hello"), who.email).toEqual({ ok: false, error: NO_ACCESS });
      await expect(thread("tech_issue", issueId)).rejects.toThrow();
    }
  });

  it("refuses an empty message, a very long one, an unknown type and a report that does not exist", async () => {
    as(va.user);
    expect((await post("tech_issue", issueId, "   ")).ok).toBe(false);
    expect((await post("tech_issue", issueId, "x".repeat(1001))).ok).toBe(false);
    expect((await post("wizard", issueId, "hi")).ok).toBe(false);
    expect((await post("tech_issue", randomUUID(), "hi")).ok).toBe(false);
  });

  it("is append-only: a message can never be changed or deleted", async () => {
    await expect(db.execute(sql`update ops.report_messages set author_kind = 'handler' where report_id = ${issueId}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from ops.report_messages where report_id = ${issueId}`)).rejects.toThrow();
  });

  it("counts the messages of several reports for a list", async () => {
    as(lead.user);
    const counts = await queries.reportThreadCounts("tech_issue", [issueId, randomUUID()]);
    expect(counts.get(issueId)).toBeGreaterThanOrEqual(4);
  });
});

describe("the other kinds of report", () => {
  it("support: the person and HR can talk, another person cannot", async () => {
    const [s] = await rows<{ id: string }>(sql`insert into ops.support_requests (user_id, email, topic, subject, message) values (${va.user.id}, ${va.user.email}, 'other', 'Help', 'It is stuck') returning id`);
    as(hr);
    expect((await post("support", s.id, "We are looking into it.")).ok).toBe(true);
    as(va.user);
    expect((await thread("support", s.id)).messages).toHaveLength(1);
    expect((await post("support", s.id, "Thanks")).ok).toBe(true);
    as(lead.user); // a team lead has no support access
    expect(await post("support", s.id, "hi")).toEqual({ ok: false, error: NO_ACCESS });
  });

  it("time correction: the person and their lead", async () => {
    const [c] = await rows<{ id: string }>(sql`insert into time.clock_corrections (employee_id, requested_by, reason, proposed) values (${va.employeeId}, ${va.user.id}, 'Forgot to clock out', '[]'::jsonb) returning id`);
    as(lead.user);
    expect((await post("correction", c.id, "Which time did you stop?")).ok).toBe(true);
    as(va.user);
    expect((await thread("correction", c.id)).messages).toHaveLength(1);
    as(otherLead.user);
    expect((await post("correction", c.id, "hi")).ok).toBe(false);
  });

  it("make-up hours and extra hours and time off follow their own handlers", async () => {
    const [m] = await rows<{ id: string }>(sql`insert into time.makeup_requests (employee_id, absence_date, missed_minutes, window_start, window_end, minutes, reason) values (${va.employeeId}, current_date - 3, 120, now() + interval '1 day', now() + interval '1 day 2 hours', 120, 'Was away') returning id`);
    as(lead.user);
    expect((await post("makeup", m.id, "Which evening?")).ok).toBe(true);
    as(stranger.user);
    expect((await post("makeup", m.id, "hi")).ok).toBe(false);

    const [client] = await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Thread Client ")}) returning id`);
    const [x] = await rows<{ id: string }>(sql`insert into time.extra_hours_requests (employee_id, client_id, source, status, window_start, window_end, minutes, contact_name, reason, filed_by) values (${va.employeeId}, ${client.id}, 'va', 'pending_lead', now() + interval '1 day', now() + interval '1 day 2 hours', 120, 'Pat', 'Client asked', ${va.user.id}) returning id`);
    as(lead.user);
    expect((await post("extra_hours", x.id, "Is the client confirmed?")).ok).toBe(true);
    as(va.user);
    expect((await post("extra_hours", x.id, "Yes by email.")).ok).toBe(true);

    const [type] = await rows<{ id: string }>(sql`select id from time.leave_types limit 1`);
    const [l] = await rows<{ id: string }>(sql`insert into time.leave_requests (employee_id, leave_type_id, start_date, end_date, half_day, days, status, filed_by, step_started_on) values (${va.employeeId}, ${type.id}, current_date + 30, current_date + 30, false, 1, 'pending_lead', ${va.user.id}, current_date) returning id`);
    as(lead.user);
    expect((await post("time_off", l.id, "Covered by someone?")).ok).toBe(true);
    as(stranger.user);
    expect((await post("time_off", l.id, "hi")).ok).toBe(false);
  });
});
