import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for "My data", its downloads and data rights requests (Phase 1.5).
// The first-login gate is tested at the end of announcements.test.ts, because it publishes the privacy notice.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const privacyActions = await import("@/modules/privacy/actions");
const privacyQueries = await import("@/modules/privacy/queries");
const peopleActions = await import("@/modules/people/actions");

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

async function person(label: string, roles: RoleSlug[] = ["employee"]) {
  const user = await makeUser(label, roles);
  const n = uniq(label);
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, mobile, city)
    values (${label}, ${n}, ${user.email}, 'active', ${user.id}, '+63 900 111 2222', 'Makati') returning id`);
  return { user, employeeId: e.id, lastName: n };
}

const decode = (base64: string) => Buffer.from(base64, "base64");

describe("My data", () => {
  it("shows only the signed-in person's own data, with sensitive fields masked and never decrypted", async () => {
    const ana = await person("Ana");
    const ben = await person("Ben");
    // Encrypted columns hold a marker that must never appear anywhere in the output; masks are what is shown
    await db.execute(sql`
      insert into core.employee_sensitive (employee_id, tin_enc, masks)
      values (${ana.employeeId}, 'ENCRYPTED-SECRET-MARKER', ${JSON.stringify({ tin: "***-***-789" })}::jsonb)`);
    await db.execute(sql`insert into core.emergency_contacts (employee_id, name, relationship, phone, is_primary) values (${ana.employeeId}, 'Maria Mother', 'Mother', '0999', true)`);
    await db.execute(sql`insert into core.emergency_contacts (employee_id, name, relationship, phone, is_primary) values (${ben.employeeId}, 'Bob Bystander', 'Brother', '0888', true)`);
    await db.execute(sql`insert into core.employment_history (employee_id, event_type, summary) values (${ana.employeeId}, 'hired', 'Hired as VA')`);

    as(ana.user);
    const { data } = await privacyQueries.getMyData();
    expect(data.profile?.employeeNumber).toMatch(/^ERS-\d{4}$/);
    expect(data.profile?.legalLastName).toBe(ana.lastName);
    expect(data.profile?.mobile).toBe("+63 900 111 2222");
    expect(data.sensitive.find((s) => s.field === "tin")?.masked).toBe("***-***-789");
    expect(data.sensitive.find((s) => s.field === "sss")?.masked).toBeNull();
    expect(data.emergencyContacts.map((c) => c.name)).toEqual(["Maria Mother"]);
    expect(data.history.map((h) => h.summary)).toContain("Hired as VA");

    const everything = JSON.stringify(data);
    expect(everything).not.toContain("ENCRYPTED-SECRET-MARKER");
    expect(everything).not.toContain("Bob Bystander");
    expect(everything).not.toContain(ben.lastName);
  });

  it("works for an account with no people record", async () => {
    const admin = await makeUser("noprofile", ["super_admin"]);
    as(admin);
    const { data } = await privacyQueries.getMyData();
    expect(data.profile).toBeNull();
    expect(data.emergencyContacts).toEqual([]);
    expect(data.account.email).toBe(admin.email);
  });

  it("lists activity without naming other people", async () => {
    const ana = await person("Activity");
    const hr = await makeUser("hr-actor", ["hr_admin"]);
    await db.execute(sql`insert into ops.audit_log (actor_user_id, actor_email, action, target_type, target_id) values (${hr.id}, ${hr.email}, 'employee.update', 'employee', ${ana.employeeId})`);
    await db.execute(sql`insert into ops.audit_log (actor_user_id, actor_email, action, target_type, target_id) values (${ana.user.id}, ${ana.user.email}, 'sensitive.view', 'employee', ${ana.employeeId})`);
    await db.execute(sql`insert into ops.audit_log (actor_user_id, actor_email, action, target_type, target_id) values (${hr.id}, ${hr.email}, 'employee.update', 'employee', ${randomUUID()})`);

    as(ana.user);
    const { data } = await privacyQueries.getMyData();
    expect(data.activity.map((a) => [a.action, a.by]).sort()).toEqual([["employee.update", "HR or system"], ["sensitive.view", "You"]]);
    expect(JSON.stringify(data)).not.toContain(hr.email);
  });
});

describe("downloads", () => {
  it("gives a JSON file and a PDF of the same data, and logs each download", async () => {
    const ana = await person("Download");
    as(ana.user);

    const json = await privacyActions.exportMyData({ format: "json" });
    expect(json.ok).toBe(true);
    if (!json.ok) return;
    expect(json.data.fileName).toMatch(/^my-elevate-data-\d{4}-\d{2}-\d{2}\.json$/);
    expect(json.data.mimeType).toBe("application/json");
    const parsed = JSON.parse(decode(json.data.base64).toString("utf8"));
    expect(parsed.profile.legalLastName).toBe(ana.lastName);
    expect(parsed.account.email).toBe(ana.user.email);

    const pdf = await privacyActions.exportMyData({ format: "pdf" });
    expect(pdf.ok).toBe(true);
    if (!pdf.ok) return;
    expect(pdf.data.mimeType).toBe("application/pdf");
    expect(decode(pdf.data.base64).subarray(0, 5).toString()).toBe("%PDF-");

    const audit = await rows<{ format: string }>(sql`select metadata->>'format' as format from ops.audit_log where action = 'mydata.export' and actor_user_id = ${ana.user.id} order by id`);
    expect(audit.map((a) => a.format)).toEqual(["json", "pdf"]);

    expect((await privacyActions.exportMyData({ format: "xml" })).ok).toBe(false);
  });
});

describe("data rights requests", () => {
  it("goes to HR, blocks a second open one, and approving applies nothing", async () => {
    const hr = await makeUser("hr-rights", ["hr_admin", "employee"]);
    const ana = await person("Rights");
    as(ana.user);

    expect((await peopleActions.requestDataRights({ kind: "correction", details: "x" })).ok).toBe(false); // too short
    const sent = await peopleActions.requestDataRights({ kind: "correction", details: "Please correct my birth date to 4 March 1995." });
    expect(sent.ok).toBe(true);
    expect(await peopleActions.requestDataRights({ kind: "deletion", details: "Please delete everything you hold." })).toEqual({
      ok: false,
      error: "You already have a pending request for this. Wait for HR or cancel it first.",
    });

    expect(await rows(sql`select 1 from ops.notifications where user_id = ${hr.id} and kind = 'privacy.request' and link = '/people/requests'`)).toHaveLength(1);
    const [req] = await rows<{ id: string; category: string; payload: { kind: string } }>(sql`select id, category, payload from core.change_requests where employee_id = ${ana.employeeId}`);
    expect(req.category).toBe("data_rights");
    expect(req.payload.kind).toBe("correction");

    // The person sees it listed as pending; nobody can review their own request
    const { data, openRequest } = await privacyQueries.getMyData();
    expect(openRequest).toBe(true);
    expect(data.requests[0]).toMatchObject({ category: "Data rights request", status: "pending" });
    expect(await peopleActions.reviewChangeRequest({ requestId: req.id, decision: "approve" })).toMatchObject({ ok: false });

    as(hr);
    const before = await rows<{ birth_date: string | null; legal_first_name: string }>(sql`select birth_date::text, legal_first_name from core.employees where id = ${ana.employeeId}`);
    expect((await peopleActions.reviewChangeRequest({ requestId: req.id, decision: "approve", note: "Corrected by phone" })).ok).toBe(true);
    const after = await rows<{ birth_date: string | null; legal_first_name: string }>(sql`select birth_date::text, legal_first_name from core.employees where id = ${ana.employeeId}`);
    expect(after).toEqual(before); // nothing was changed automatically
    expect((await rows<{ status: string }>(sql`select status from core.change_requests where id = ${req.id}`))[0].status).toBe("approved");

    // Handled, so a new one is possible
    as(ana.user);
    expect((await privacyQueries.getMyData()).openRequest).toBe(false);
    expect((await peopleActions.requestDataRights({ kind: "other", details: "Who can see my emergency contacts?" })).ok).toBe(true);
  });

  it("needs a people record", async () => {
    const admin = await makeUser("rights-noprofile", ["super_admin"]);
    as(admin);
    expect(await peopleActions.requestDataRights({ kind: "correction", details: "Please correct my details." })).toEqual({
      ok: false,
      error: "Your people record is not set up yet. Ask HR.",
    });
    void NO_ACCESS;
  });
});
