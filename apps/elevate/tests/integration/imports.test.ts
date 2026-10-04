import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { fakeCompany, fakePerson, toCsv } from "../fixtures/talenthr-export";

// Real-database tests for the TalentHR import (Phase 5): staging, preview, commit, reconciliation, re-import, rollback, and what is
// (and is not) stored. All data here is invented; a real export is never used in tests.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const actionsModule = await import("@/modules/imports/actions");
const service = await import("@/modules/imports/service");
const queries = await import("@/modules/imports/queries");
const { parseCsv } = await import("@/modules/imports/csv");
const { defaultMapping } = await import("@/modules/imports/mapping");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
type Res = { ok: boolean; error?: string; data?: Record<string, number> };
const act = actionsModule as unknown as Record<string, (input: unknown) => Promise<Res>>;
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
let hr: TestUser;
let hr2: TestUser;
let lead: TestUser;

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

/** Stages a CSV the way the upload route does. */
async function stage(csv: string, over: Record<string, string> = {}) {
  const parsed = parseCsv(csv);
  if ("error" in parsed) throw new Error(parsed.error);
  return service.stageBatch(hr, { fileName: "test-export.csv", headers: parsed.headers, rows: parsed.rows, mapping: { ...defaultMapping(parsed.headers), ...over }, dateFormat: "mdy" });
}
const employeeByEmail = async (email: string) => (await rows<{ id: string; status: string; archived_at: Date | null; team_id: string | null; manager_id: string | null; position: string | null; end_date: string | null; user_id: string | null }>(sql`select id, status, archived_at, team_id, manager_id, position, end_date::text as end_date, user_id from core.employees where lower(work_email) = ${email}`))[0];

beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin"]);
  hr2 = await makeUser("hr2", ["hr_admin"]);
  lead = await makeUser("lead", ["team_lead"]);
});

describe("staging a file", () => {
  it("previews without creating anyone, and keeps nothing readable in the quarantine", async () => {
    const tag = uniq("stage");
    const { batchId, summary } = await stage(toCsv(fakeCompany(tag)));
    expect(summary).toMatchObject({ total: 5, new: 5, errors: 0, fileTerminated: 1, fileCurrent: 4 });
    expect(await rows(sql`select 1 from core.employees where work_email like ${`${tag}.%`}`)).toHaveLength(0);
    const stored = await rows<{ payload_enc: string; changed_fields: string[] }>(sql`select payload_enc, changed_fields from ops.import_rows where batch_id = ${batchId}`);
    expect(stored).toHaveLength(5);
    for (const r of stored) {
      expect(r.payload_enc).toBeTruthy();
      expect(r.payload_enc).not.toContain("Person");
      expect(r.payload_enc).not.toContain("example.com");
    }
    const issues = JSON.stringify(await rows(sql`select issues from ops.import_rows where batch_id = ${batchId}`));
    expect(issues).not.toContain("example.com");
  });

  it("flags duplicates, bad rows and unknown supervisors by field, not by value", async () => {
    const tag = uniq("bad");
    const company = fakeCompany(tag);
    company.push(fakePerson(2, { "Employee ID *": "2999", "Email *": `${tag}.person2@example.com` })); // same email as person 2
    company.push(fakePerson(7, { "Email *": "nope", "Employee ID *": "2998" }));
    company.push(fakePerson(8, { "Email *": `${tag}.person8@example.com`, "Employee ID *": "2997", "Supervisor ID *": "424242" }));
    const { batchId, summary } = await stage(toCsv(company));
    expect(summary).toMatchObject({ total: 8, errors: 2, new: 6 });
    const text = JSON.stringify(await rows(sql`select issues from ops.import_rows where batch_id = ${batchId}`));
    expect(text).toContain("same work email");
    expect(text).toContain("supervisor");
    expect(text).not.toContain("nope");
  });
});

describe("committing", () => {
  it("creates people, teams, positions, managers, pay, contacts and custom fields", async () => {
    const tag = uniq("commit");
    const { batchId } = await stage(toCsv(fakeCompany(tag)));
    as(hr);
    const res = await act.commitImport({ batchId });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ created: 5, updated: 0, skipped: 0, managersSet: 4, managerWarnings: 0 });

    const p3 = await employeeByEmail(`${tag}.person3@example.com`);
    const p2 = await employeeByEmail(`${tag}.person2@example.com`);
    const p1 = await employeeByEmail(`${tag}.person1@example.com`);
    expect(p3.status).toBe("active");
    expect(p3.manager_id).toBe(p2.id);
    expect(p2.manager_id).toBe(p1.id);
    expect(p1.manager_id).toBeNull();
    expect(p3.team_id).not.toBeNull();
    expect(p3.position).toBe("Medical Scribe");
    const p5 = await employeeByEmail(`${tag}.person5@example.com`);
    expect(p5).toMatchObject({ status: "separated", end_date: "2026-03-24" });

    // Pay is encrypted, with its currency, and masked
    const [sens] = await rows<{ pay_rate_enc: string; pay_currency: string }>(sql`select pay_rate_enc, pay_currency from core.employee_sensitive where employee_id = ${(await employeeByEmail(`${tag}.person4@example.com`)).id}`);
    expect(sens.pay_rate_enc).toBeTruthy();
    expect(sens.pay_rate_enc).not.toContain("12000");
    expect(sens.pay_currency).toBe("HNL");
    // Emergency contact and HR-only custom fields; the left-out columns were never saved
    expect(await rows(sql`select 1 from core.emergency_contacts where employee_id = ${p3.id}`)).toHaveLength(1);
    const customs = await rows<{ key: string; value: string }>(sql`select d.key, v.value from core.custom_field_values v join core.custom_field_defs d on d.id = v.field_def_id where v.employee_id = ${p3.id}`);
    expect(customs.map((c) => c.key)).toEqual(expect.arrayContaining(["imp_location", "imp_division", "imp_shirt_size"]));
    expect(JSON.stringify(customs)).not.toContain("Should never be imported");
    expect(await rows(sql`select 1 from core.custom_field_defs where visibility <> 'hr_only' and key like 'imp_%'`)).toHaveLength(0);

    // Quarantine wiped, history and audit written without values
    expect((await rows<{ n: number }>(sql`select count(payload_enc)::int as n from ops.import_rows where batch_id = ${batchId}`))[0].n).toBe(0);
    expect(await rows(sql`select 1 from core.employment_history where employee_id = ${p3.id} and summary = 'Imported from TalentHR'`)).toHaveLength(1);
    const audit = JSON.stringify(await rows(sql`select before, after from ops.audit_log where action in ('import.stage','import.commit') and target_id = ${batchId}`));
    expect(audit).not.toContain("example.com");
    expect(audit).not.toContain("12000");
    // Nobody got an account or an email
    expect(p3.user_id).toBeNull();
  });

  it("refuses a second commit, and refuses errors unless they are skipped", async () => {
    const tag = uniq("errs");
    const company = fakeCompany(tag);
    company.push(fakePerson(9, { "Email *": "broken", "Employee ID *": "3001" }));
    const { batchId } = await stage(toCsv(company));
    as(hr);
    const refused = await act.commitImport({ batchId });
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/error/);
    const ok = await act.commitImport({ batchId, skipErrors: true });
    expect(ok.ok).toBe(true);
    expect(ok.data).toMatchObject({ created: 5, skipped: 1 });
    expect((await act.commitImport({ batchId })).ok).toBe(false);
  });

  it("matches by email on the next dry run: unchanged, then changed, with an account left alone", async () => {
    const tag = uniq("rerun");
    const first = await stage(toCsv(fakeCompany(tag)));
    as(hr);
    await act.commitImport({ batchId: first.batchId });

    const again = await stage(toCsv(fakeCompany(tag)));
    expect(again.summary).toMatchObject({ new: 0, unchanged: 5, changed: 0 });

    const edited = fakeCompany(tag);
    edited[2] = { ...edited[2], "First Name *": "Renamed", "custom_fields:City": "Makati" };
    // Person 4 has signed in: status and dates must not be changed by a file
    const p4 = await employeeByEmail(`${tag}.person4@example.com`);
    const account = await makeUser("acct", ["employee"]);
    await db.execute(sql`update core.employees set user_id = ${account.id} where id = ${p4.id}`);
    edited[3] = { ...edited[3], "Employment Status": "Terminated", "Termination Date": "05/05/2026" };
    const changed = await stage(toCsv(edited));
    expect(changed.summary).toMatchObject({ new: 0, changed: 1, unchanged: 4 });
    const res = await act.commitImport({ batchId: changed.batchId });
    expect(res.data).toMatchObject({ created: 0, updated: 5 });
    const p3 = await employeeByEmail(`${tag}.person3@example.com`);
    expect((await rows<{ legal_first_name: string; city: string }>(sql`select legal_first_name, city from core.employees where id = ${p3.id}`))[0]).toMatchObject({ legal_first_name: "Renamed", city: "Makati" });
    expect((await employeeByEmail(`${tag}.person4@example.com`)).status).toBe("active"); // had an account: untouched
  });
});

describe("reconciliation and sign-off", () => {
  it("shows matching counts for a clean commit and records the sign-off", async () => {
    const tag = uniq("rec");
    const { batchId } = await stage(toCsv(fakeCompany(tag)));
    as(hr);
    await act.commitImport({ batchId });
    const rec = await queries.getReconciliation(batchId);
    expect(rec.clean).toBe(true);
    expect(rec.checks.find((c) => c.label.startsWith("Terminated"))).toMatchObject({ expected: 1, actual: 1 });
    expect((await act.signOffImport({ batchId })).ok).toBe(true);
    expect((await queries.getReconciliation(batchId)).signedOffAt).not.toBeNull();
    // A preview cannot be signed off
    const preview = await stage(toCsv(fakeCompany(uniq("rec2"))));
    expect((await act.signOffImport({ batchId: preview.batchId })).ok).toBe(false);
  });

  it("shows a mismatch when a person was skipped", async () => {
    const tag = uniq("recbad");
    const company = fakeCompany(tag);
    company.push(fakePerson(9, { "Email *": "broken", "Employee ID *": "3001" }));
    const { batchId } = await stage(toCsv(company));
    as(hr);
    await act.commitImport({ batchId, skipErrors: true });
    const rec = await queries.getReconciliation(batchId);
    expect(rec.clean).toBe(false);
    expect(rec.checks.find((c) => c.label.startsWith("Rows skipped"))).toMatchObject({ expected: 0, actual: 1 });
  });
});

describe("rolling back and discarding", () => {
  it("archives the people a batch created, keeps anyone who signed in, and a re-import restores them", async () => {
    const tag = uniq("roll");
    const { batchId } = await stage(toCsv(fakeCompany(tag)));
    as(hr);
    await act.commitImport({ batchId });
    const p3 = await employeeByEmail(`${tag}.person3@example.com`);
    const account = await makeUser("acct2", ["employee"]);
    await db.execute(sql`update core.employees set user_id = ${account.id} where id = ${p3.id}`);

    const rolled = await act.rollbackImport({ batchId });
    expect(rolled.ok).toBe(true);
    expect(rolled.data).toMatchObject({ archived: 4, kept: 1 });
    expect((await employeeByEmail(`${tag}.person2@example.com`)).archived_at).not.toBeNull();
    expect((await employeeByEmail(`${tag}.person3@example.com`)).archived_at).toBeNull();
    expect((await act.rollbackImport({ batchId })).ok).toBe(false);

    // The same file again brings the archived people back instead of duplicating them
    const again = await stage(toCsv(fakeCompany(tag)));
    expect(again.summary.new).toBe(0);
    const res = await act.commitImport({ batchId: again.batchId });
    expect(res.data).toMatchObject({ created: 0, restored: 4 });
    expect((await employeeByEmail(`${tag}.person2@example.com`)).archived_at).toBeNull();
  });

  it("discards a preview and wipes its rows, and the clean-up job discards old ones", async () => {
    as(hr);
    const { batchId } = await stage(toCsv(fakeCompany(uniq("disc"))));
    expect((await act.discardImport({ batchId })).ok).toBe(true);
    expect((await rows<{ n: number }>(sql`select count(payload_enc)::int as n from ops.import_rows where batch_id = ${batchId}`))[0].n).toBe(0);
    expect((await act.discardImport({ batchId })).ok).toBe(false);

    const old = await stage(toCsv(fakeCompany(uniq("old"))));
    await db.execute(sql`update ops.import_batches set created_at = now() - interval '15 days' where id = ${old.batchId}`);
    expect(await service.discardStaleBatches()).toBeGreaterThanOrEqual(1);
    expect((await rows<{ status: string }>(sql`select status from ops.import_batches where id = ${old.batchId}`))[0].status).toBe("discarded");
  });
});

describe("who may import", () => {
  it("refuses everyone but HR and Super Admin", async () => {
    const { batchId } = await stage(toCsv(fakeCompany(uniq("perm"))));
    as(lead);
    expect((await act.commitImport({ batchId })).error).toBe(NO_ACCESS);
    expect((await act.rollbackImport({ batchId })).error).toBe(NO_ACCESS);
    expect((await act.discardImport({ batchId })).error).toBe(NO_ACCESS);
    expect((await act.signOffImport({ batchId })).error).toBe(NO_ACCESS);
    await expect(queries.listBatches()).rejects.toMatchObject({ name: "ForbiddenError" });
    as(hr2);
    expect((await act.discardImport({ batchId })).ok).toBe(true);
  });
});
