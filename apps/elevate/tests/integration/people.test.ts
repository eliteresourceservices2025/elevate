import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for People records (Phase 1.1): encryption at rest, audit, history,
// approvals and visibility, run against a throwaway Postgres database.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/people/actions");
const queries = await import("@/modules/people/queries");
const { provisionCoreUser } = await import("@/modules/core/users");

type TestUser = { id: string; email: string; roles: RoleSlug[] };

async function makeUser(email: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const role of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  return { id, email, roles };
}
const as = (user: TestUser) => {
  current.user = user;
};
const rows = async <T = Record<string, unknown>>(query: ReturnType<typeof sql>) => (await db.execute(query)) as unknown as T[];

async function dbErrorText(promise: Promise<unknown>) {
  try {
    await promise;
    return "";
  } catch (e) {
    const err = e as { message?: string; cause?: { message?: string } };
    return `${err.message ?? ""} ${err.cause?.message ?? ""}`;
  }
}

const person = (suffix: string, extra: Record<string, unknown> = {}) => ({
  legalFirstName: "Maria",
  legalLastName: `Santos${suffix}`,
  workEmail: `maria.${suffix}@example.com`,
  position: "Healthcare Virtual Assistant",
  startDate: "2026-09-01",
  ...extra,
});

let hr: TestUser;
let hr2: TestUser;
let staff: TestUser;

beforeAll(async () => {
  hr = await makeUser("hr@example.com", ["employee", "hr_admin"]);
  hr2 = await makeUser("hr2@example.com", ["employee", "hr_admin"]);
  staff = await makeUser("staff@example.com", ["employee"]);
});

async function createPerson(suffix: string, extra: Record<string, unknown> = {}) {
  as(hr);
  const r = await actions.createEmployee(person(suffix, extra));
  if (!r.ok) throw new Error(r.error);
  return r.data.id;
}

describe("create and update", () => {
  it("creates a person with an ERS number, a 'hired' history row and an audit row", async () => {
    const id = await createPerson("create");
    const [e] = await rows<{ employee_number: string; status: string; worker_type: string }>(sql`select employee_number, status, worker_type from core.employees where id = ${id}`);
    expect(e.employee_number).toMatch(/^ERS-\d{4}$/);
    expect(e).toMatchObject({ status: "onboarding", worker_type: "contractor" });

    const history = await rows<{ event_type: string }>(sql`select event_type from core.employment_history where employee_id = ${id}`);
    expect(history.map((h) => h.event_type)).toEqual(["hired"]);
    const audit = await rows(sql`select 1 from ops.audit_log where action = 'people.create' and target_id = ${id}`);
    expect(audit).toHaveLength(1);
  });

  it("refuses people without the permission, and a duplicate work email", async () => {
    as(staff);
    expect(await actions.createEmployee(person("nope"))).toEqual({ ok: false, error: "You do not have access to do that." });

    await createPerson("dupe");
    as(hr);
    expect(await actions.createEmployee(person("dupe"))).toEqual({ ok: false, error: "Someone with that work email already exists." });
  });

  it("records position and status changes in history and audit, and rejects a no-op", async () => {
    const id = await createPerson("update");
    as(hr);
    const base = { employeeId: id, ...person("update"), status: "onboarding" as const };
    expect(await actions.updateEmployee(base)).toMatchObject({ ok: false, error: "No changes to save." });

    expect((await actions.updateEmployee({ ...base, position: "Senior VA", status: "active" })).ok).toBe(true);
    const events = await rows<{ event_type: string }>(sql`select event_type from core.employment_history where employee_id = ${id} order by created_at`);
    expect(events.map((h) => h.event_type)).toEqual(["hired", "position_changed", "status_changed"]);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'people.update' and target_id = ${id}`)).toHaveLength(1);
  });

  it("requires a last working day for a separated person", async () => {
    const id = await createPerson("sep");
    as(hr);
    const r = await actions.updateEmployee({ employeeId: id, ...person("sep"), status: "separated" });
    expect(r.ok).toBe(false);
  });
});

describe("sensitive fields", () => {
  it("stores ciphertext only, keeps values out of history and audit, and masks", async () => {
    const id = await createPerson("sens");
    as(hr);
    const r = await actions.updateSensitive({
      employeeId: id,
      values: { tin: "123456789012", bankAccountNumber: "0012 3456 7890", payRate: "25000", bankName: "Test Bank" },
    });
    expect(r.ok).toBe(true);

    const [s] = await rows<Record<string, string | Record<string, string>>>(sql`select * from core.employee_sensitive where employee_id = ${id}`);
    expect(String(s.tin_enc)).toMatch(/^v1:/);
    expect(String(s.bank_account_number_enc)).toMatch(/^v1:/);
    expect(s.masks).toMatchObject({ tin: "••••••••9012", bankAccountNumber: "••••••••7890", payRate: "••••••", bankName: "••••••" });

    // No plaintext anywhere in the database for this person.
    const everything = JSON.stringify([
      s,
      await rows(sql`select * from core.employment_history where employee_id = ${id}`),
      await rows(sql`select * from ops.audit_log where target_id = ${id}`),
    ]);
    for (const secret of ["123-456-789-012", "123456789012", "0012 3456 7890", "25000", "Test Bank"]) expect(everything).not.toContain(secret);

    const [h] = await rows<{ summary: string }>(sql`select summary from core.employment_history where employee_id = ${id} and event_type = 'sensitive_changed'`);
    expect(h.summary).toBe("TIN, Bank name, Account number, Pay rate updated");
  });

  it("validates Philippine ID formats", async () => {
    const id = await createPerson("badid");
    as(hr);
    expect(await actions.updateSensitive({ employeeId: id, values: { tin: "12345" } })).toMatchObject({ ok: false });
    expect(await actions.updateSensitive({ employeeId: id, values: { sss: "1234567890" } })).toMatchObject({ ok: true });
  });

  it("clears a value when given null", async () => {
    const id = await createPerson("clear");
    as(hr);
    await actions.updateSensitive({ employeeId: id, values: { sss: "1234567890" } });
    await actions.updateSensitive({ employeeId: id, values: { sss: null } });
    const [s] = await rows<{ sss_enc: string | null; masks: Record<string, string> }>(sql`select sss_enc, masks from core.employee_sensitive where employee_id = ${id}`);
    expect(s.sss_enc).toBeNull();
    expect(s.masks.sss).toBeUndefined();
  });

  it("reveal decrypts for HR and the owner, is audited without the value, and refuses others", async () => {
    const owner = await makeUser("owner@example.com", ["employee"]);
    const id = await createPerson("reveal", { workEmail: "owner@example.com" });
    await db.execute(sql`update core.employees set user_id = ${owner.id} where id = ${id}`);
    as(hr);
    await actions.updateSensitive({ employeeId: id, values: { tin: "123456789012" } });

    as(hr);
    expect(await actions.revealSensitiveField({ employeeId: id, field: "tin" })).toEqual({ ok: true, data: { value: "123-456-789-012" } });
    as(owner);
    expect((await actions.revealSensitiveField({ employeeId: id, field: "tin" })).ok).toBe(true);
    as(staff);
    expect(await actions.revealSensitiveField({ employeeId: id, field: "tin" })).toEqual({ ok: false, error: "You do not have access to do that." });

    const audit = await rows<{ metadata: { field: string }; actor_user_id: string }>(sql`select metadata, actor_user_id from ops.audit_log where action = 'sensitive.view' and target_id = ${id}`);
    expect(audit).toHaveLength(2);
    expect(audit.every((a) => a.metadata.field === "tin")).toBe(true);
    expect(JSON.stringify(audit)).not.toContain("123-456");
    expect(await actions.revealSensitiveField({ employeeId: randomUUID(), field: "tin" })).toMatchObject({ ok: false });
  });

  it("the profile exposes masks only to people allowed to see them", async () => {
    const id = await createPerson("profile");
    as(hr);
    await actions.updateSensitive({ employeeId: id, values: { tin: "123456789012" } });

    const asHr = await queries.getProfile(id);
    expect(asHr.sensitive?.masks.tin).toBe("••••••••9012");

    as(staff);
    await expect(queries.getProfile(id)).rejects.toThrow("Forbidden");
  });
});

describe("change requests", () => {
  async function linkedEmployee(email: string, roles: RoleSlug[] = ["employee"]) {
    const user = await makeUser(email, roles);
    const id = await createPerson(email.split("@")[0], { workEmail: email });
    await db.execute(sql`update core.employees set user_id = ${user.id} where id = ${id}`);
    return { user, id };
  }

  it("bank request stays encrypted while pending, and approval applies it, clears it and records a marker", async () => {
    const { user, id } = await linkedEmployee("bankreq@example.com");
    as(user);
    const bank = { bankName: "New Bank", bankAccountName: "Bank Req", bankAccountNumber: "9988 7766 5544" };
    expect((await actions.requestBankChange(bank)).ok).toBe(true);
    expect(await actions.requestBankChange(bank)).toMatchObject({ ok: false }); // one pending at a time

    const [req] = await rows<{ id: string; payload: unknown; payload_enc: string }>(sql`select id, payload, payload_enc from core.change_requests where employee_id = ${id}`);
    expect(req.payload).toBeNull();
    expect(req.payload_enc).toMatch(/^v1:/);
    expect(JSON.stringify(req)).not.toContain("9988");

    as(staff);
    expect(await actions.reviewChangeRequest({ requestId: req.id, decision: "approve" })).toEqual({ ok: false, error: "You do not have access to do that." });

    as(hr);
    expect(await queries.viewBankChangeRequest(req.id)).toEqual(bank);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'sensitive.view' and target_id = ${id}`)).toHaveLength(1);
    expect((await actions.reviewChangeRequest({ requestId: req.id, decision: "approve" })).ok).toBe(true);

    const [after] = await rows<{ status: string; payload_enc: string | null }>(sql`select status, payload_enc from core.change_requests where id = ${req.id}`);
    expect(after).toEqual({ status: "approved", payload_enc: null });
    as(hr);
    expect(await actions.revealSensitiveField({ employeeId: id, field: "bankAccountNumber" })).toEqual({ ok: true, data: { value: "9988 7766 5544" } });
    const [h] = await rows<{ summary: string }>(sql`select summary from core.employment_history where employee_id = ${id} and event_type = 'sensitive_changed'`);
    expect(h.summary).toBe("Bank details updated, approved request");
    expect(JSON.stringify(await rows(sql`select * from ops.audit_log where target_id = ${id}`))).not.toContain("9988");
  });

  it("nobody approves a request on their own record", async () => {
    const { user, id } = await linkedEmployee("selfapprove@example.com", ["employee", "hr_admin"]);
    as(user);
    await actions.requestBankChange({ bankName: "B", bankAccountName: "Self", bankAccountNumber: "123456789" });
    const [req] = await rows<{ id: string }>(sql`select id from core.change_requests where employee_id = ${id}`);
    expect(await actions.reviewChangeRequest({ requestId: req.id, decision: "approve" })).toEqual({ ok: false, error: "Another admin must review your own request." });
    as(hr2);
    expect((await actions.reviewChangeRequest({ requestId: req.id, decision: "reject", note: "Please send a bank letter" })).ok).toBe(true);
    const [after] = await rows<{ status: string; payload_enc: string | null; review_note: string }>(sql`select status, payload_enc, review_note from core.change_requests where id = ${req.id}`);
    expect(after).toEqual({ status: "rejected", payload_enc: null, review_note: "Please send a bank letter" });
  });

  it("contact change: only changed fields are requested; approval applies them with before/after history", async () => {
    const { user, id } = await linkedEmployee("contactreq@example.com");
    as(user);
    expect(await actions.requestContactChange({})).toMatchObject({ ok: false });
    expect((await actions.requestContactChange({ mobile: "+63 917 123 4567", city: "Cebu" })).ok).toBe(true);
    const [req] = await rows<{ id: string; payload: Record<string, string> }>(sql`select id, payload from core.change_requests where employee_id = ${id}`);
    expect(req.payload).toEqual({ mobile: "+63 917 123 4567", city: "Cebu" });

    as(hr);
    expect((await actions.reviewChangeRequest({ requestId: req.id, decision: "approve" })).ok).toBe(true);
    const [e] = await rows<{ mobile: string; city: string }>(sql`select mobile, city from core.employees where id = ${id}`);
    expect(e).toEqual({ mobile: "+63 917 123 4567", city: "Cebu" });
    const [h] = await rows<{ before: Record<string, unknown>; after: Record<string, unknown> }>(sql`select before, after from core.employment_history where employee_id = ${id} and event_type = 'profile_changed'`);
    expect(h.before).toEqual({ mobile: null, city: null });
    expect(h.after).toEqual({ mobile: "+63 917 123 4567", city: "Cebu" });
  });

  it("emergency contacts replace the old list on approval", async () => {
    const { user, id } = await linkedEmployee("emergency@example.com");
    as(user);
    const contacts = [
      { name: "Ana Reyes", relationship: "Sister", phone: "0917 123 4567", isPrimary: true },
      { name: "Luis Reyes", relationship: "Father", phone: "0918 765 4321", isPrimary: false },
    ];
    expect((await actions.requestEmergencyContactsChange({ contacts })).ok).toBe(true);
    const [req] = await rows<{ id: string }>(sql`select id from core.change_requests where employee_id = ${id}`);
    as(hr);
    expect((await actions.reviewChangeRequest({ requestId: req.id, decision: "approve" })).ok).toBe(true);
    const saved = await rows<{ name: string; is_primary: boolean }>(sql`select name, is_primary from core.emergency_contacts where employee_id = ${id} and archived_at is null order by name`);
    expect(saved).toEqual([{ name: "Ana Reyes", is_primary: true }, { name: "Luis Reyes", is_primary: false }]);
  });

  it("an employee can cancel their own pending request but not someone else's", async () => {
    const a = await linkedEmployee("cancel.a@example.com");
    const b = await linkedEmployee("cancel.b@example.com");
    as(a.user);
    await actions.requestContactChange({ city: "Davao" });
    const [req] = await rows<{ id: string }>(sql`select id from core.change_requests where employee_id = ${a.id}`);
    as(b.user);
    expect(await actions.cancelChangeRequest({ requestId: req.id })).toMatchObject({ ok: false });
    as(a.user);
    expect((await actions.cancelChangeRequest({ requestId: req.id })).ok).toBe(true);
  });
});

describe("append-only tables", () => {
  it("employment history and the audit log refuse update, delete and truncate", async () => {
    const id = await createPerson("append");
    for (const statement of [
      sql`update core.employment_history set summary = 'x' where employee_id = ${id}`,
      sql`delete from core.employment_history where employee_id = ${id}`,
      sql`truncate core.employment_history`,
      sql`update ops.audit_log set action = 'x'`,
      sql`delete from ops.audit_log`,
      sql`truncate ops.audit_log`,
    ]) {
      expect(await dbErrorText(db.execute(statement))).toMatch(/append-only|insert-only/);
    }
  });
});

describe("directory, clients and assignments", () => {
  it("hides client names and archived people from staff, shows them to HR", async () => {
    const id = await createPerson("dir", { legalFirstName: "Directoria" });
    as(hr);
    expect((await actions.createClient({ name: "Test Clinic (fake)", timeZone: "America/Phoenix" })).ok).toBe(true);
    const [client] = await rows<{ id: string }>(sql`select id from core.clients where name = 'Test Clinic (fake)'`);
    expect((await actions.assignClient({ employeeId: id, clientId: client.id, startDate: "2026-09-01", hoursPerWeek: 20 })).ok).toBe(true);
    expect(await actions.assignClient({ employeeId: id, clientId: client.id, startDate: "2026-09-02" })).toMatchObject({ ok: false }); // already open

    const hrView = await queries.listDirectory({ q: "Directoria" });
    expect(hrView.rows).toHaveLength(1);
    expect(hrView.rows[0].clientNames).toBe("Test Clinic (fake)");

    as(staff);
    const staffView = await queries.listDirectory({ q: "Directoria", client: client.id });
    expect(staffView.rows).toHaveLength(1);
    expect(staffView.rows[0].clientNames).toBeNull();
    expect(staffView.seesClients).toBe(false);
    expect(Object.keys(staffView.rows[0]).sort()).not.toContain("personalEmail");

    as(hr);
    expect((await actions.archiveEmployee({ employeeId: id })).ok).toBe(true);
    as(staff);
    expect((await queries.listDirectory({ q: "Directoria", archived: "1" })).rows).toHaveLength(0);
    as(hr);
    expect((await queries.listDirectory({ q: "Directoria" })).rows).toHaveLength(0);
    expect((await queries.listDirectory({ q: "Directoria", archived: "1" })).rows).toHaveLength(1);
  });

  it("ends an assignment once and keeps the history", async () => {
    const id = await createPerson("endasg");
    as(hr);
    await actions.createClient({ name: "Second Client (fake)", timeZone: "America/New_York" });
    const [client] = await rows<{ id: string }>(sql`select id from core.clients where name = 'Second Client (fake)'`);
    await actions.assignClient({ employeeId: id, clientId: client.id, startDate: "2026-09-10" });
    const [a] = await rows<{ id: string }>(sql`select id from core.client_assignments where employee_id = ${id}`);
    expect(await actions.endAssignment({ assignmentId: a.id, endDate: "2026-09-01" })).toMatchObject({ ok: false });
    expect((await actions.endAssignment({ assignmentId: a.id, endDate: "2026-10-01" })).ok).toBe(true);
    expect(await actions.endAssignment({ assignmentId: a.id, endDate: "2026-10-02" })).toMatchObject({ ok: false });
    const events = await rows<{ event_type: string }>(sql`select event_type from core.employment_history where employee_id = ${id} order by created_at`);
    expect(events.map((x) => x.event_type)).toEqual(["hired", "client_assigned", "client_ended"]);
  });
});

describe("custom fields", () => {
  it("HR sees all fields, the person sees only employee-visible ones, and values are validated", async () => {
    const owner = await makeUser("custom@example.com", ["employee"]);
    const id = await createPerson("custom", { workEmail: "custom@example.com" });
    await db.execute(sql`update core.employees set user_id = ${owner.id} where id = ${id}`);
    as(hr);
    expect((await actions.createCustomFieldDef({ key: "shirt_size", label: "Shirt size", fieldType: "select", options: ["S", "M", "L"], visibility: "employee_visible" })).ok).toBe(true);
    expect((await actions.createCustomFieldDef({ key: "hr_note", label: "HR note", fieldType: "text", visibility: "hr_only" })).ok).toBe(true);
    const defs = await rows<{ id: string; key: string }>(sql`select id, key from core.custom_field_defs`);
    const shirt = defs.find((d) => d.key === "shirt_size")!;
    const note = defs.find((d) => d.key === "hr_note")!;

    expect(await actions.setCustomFieldValues({ employeeId: id, values: { [shirt.id]: "XXL" } })).toMatchObject({ ok: false });
    expect((await actions.setCustomFieldValues({ employeeId: id, values: { [shirt.id]: "M", [note.id]: "Prefers mornings" } })).ok).toBe(true);

    expect((await queries.getProfile(id)).customFields.map((f) => f.key).sort()).toEqual(["hr_note", "shirt_size"]);
    as(owner);
    const own = await queries.getProfile(id);
    expect(own.customFields.map((f) => f.key)).toEqual(["shirt_size"]);
    expect(own.customFields[0].value).toBe("M");
  });
});

describe("linking a sign-in account to a people record", () => {
  it("links by exact email on first sign-in, and never guesses when two records match", async () => {
    const id = await createPerson("link", { workEmail: "linkme@example.com" });
    const userId = randomUUID();
    await provisionCoreUser({ id: userId, email: "LinkMe@Example.com" });
    const [e] = await rows<{ user_id: string }>(sql`select user_id from core.employees where id = ${id}`);
    expect(e.user_id).toBe(userId);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'people.link_user' and target_id = ${id}`)).toHaveLength(1);

    const a = await createPerson("amb1", { workEmail: "amb1@example.com", personalEmail: "shared@example.com" });
    const b = await createPerson("amb2", { workEmail: "amb2@example.com", personalEmail: "shared@example.com" });
    await provisionCoreUser({ id: randomUUID(), email: "shared@example.com" });
    const linked = await rows(sql`select 1 from core.employees where id in (${a}, ${b}) and user_id is not null`);
    expect(linked).toHaveLength(0);
  });
});
