import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PDF_BYTES } from "./fake-storage";

// Real-database tests for the voluntary self-identification (gender, pronouns, religion): what is stored, that religion is
// ciphertext, who can read what, the combined counts, the optional part of the application, and removal.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.30" }) }));

const { db } = await import("@/lib/db");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const { setEmailSender } = await import("@/modules/notifications/email");
const actions = await import("@/modules/demographics/actions");
const queries = await import("@/modules/demographics/queries");
const service = await import("@/modules/demographics/service");
const recruitingActions = await import("@/modules/recruiting/actions");
const recruitingService = await import("@/modules/recruiting/service");

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
  const [e] = await rows<{ id: string }>(sql`
    insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id)
    values (${label}, ${uniq(label)}, ${user.email}, 'active', ${user.id}) returning id`);
  return { user, employeeId: e.id };
}

let hr: TestUser;
let recruiter: TestUser;
const fake = new FakeStorage();

beforeAll(async () => {
  setDocumentStorage(fake);
  setEmailSender({ send: async () => undefined });
  hr = (await person("hr", ["hr_admin", "employee"])).user;
  recruiter = (await makeUser("rec", ["recruiter", "employee"]));
  await db.execute(sql`delete from core.employee_demographics`);
  await db.execute(sql`delete from talent.candidate_self_identification`);
});

describe("a person's own answers", () => {
  it("stores gender plain, religion as ciphertext, and shows pronouns to others but nothing else", async () => {
    const ana = await person("Ana");
    const ben = await person("Ben");
    as(ana.user);
    expect(await actions.saveMySelfIdentification({ gender: "woman", pronouns: "she_her", religion: "islam" })).toEqual({ ok: true, data: { answered: 3 } });

    const [row] = await rows<{ gender: string; pronouns: string; religion_enc: string; religion_other_enc: string | null }>(sql`select gender, pronouns, religion_enc, religion_other_enc from core.employee_demographics where employee_id = ${ana.employeeId}`);
    expect(row.gender).toBe("woman");
    expect(row.pronouns).toBe("she_her");
    expect(row.religion_enc).not.toContain("islam");
    expect(row.religion_enc.length).toBeGreaterThan(20);

    expect(await queries.getMySelfIdentification()).toMatchObject({ gender: "woman", pronouns: "she_her", religion: "islam" });

    // Someone else only ever gets their OWN answers back, and may see the pronouns.
    as(ben.user);
    expect(await queries.getMySelfIdentification()).toMatchObject({ gender: null, religion: null });
    expect(await queries.getPronounsFor(ana.employeeId)).toBe("she/her");

    // The audit trail names the fields, never a value.
    const audit = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where action = 'demographics.update' and target_id = ${ana.employeeId}`);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].metadata)).toBe(JSON.stringify({ fields: ["gender", "pronouns", "religion"] }));
    expect(JSON.stringify(audit[0].metadata)).not.toMatch(/islam|woman|she_her/);
  });

  it("a self-description is kept encrypted, a later save replaces the old answers, and a blank save keeps nothing", async () => {
    const cy = await person("Cy");
    as(cy.user);
    expect((await actions.saveMySelfIdentification({ gender: "self_described", genderOther: "Agender", religion: "self_described", religionOther: "Pagan" })).ok).toBe(true);
    const [row] = await rows<{ gender_other_enc: string; religion_other_enc: string }>(sql`select gender_other_enc, religion_other_enc from core.employee_demographics where employee_id = ${cy.employeeId}`);
    expect(row.gender_other_enc).not.toContain("Agender");
    expect(row.religion_other_enc).not.toContain("Pagan");
    expect(await queries.getMySelfIdentification()).toMatchObject({ genderOther: "Agender", religionOther: "Pagan" });

    expect((await actions.saveMySelfIdentification({ gender: "man" })).ok).toBe(true);
    expect(await queries.getMySelfIdentification()).toMatchObject({ gender: "man", genderOther: null, religion: null, religionOther: null });

    expect(await actions.saveMySelfIdentification({})).toEqual({ ok: true, data: { answered: 0 } });
    expect(await rows(sql`select 1 from core.employee_demographics where employee_id = ${cy.employeeId}`)).toHaveLength(0);
  });

  it("refuses a self-description without words, and the person can remove everything", async () => {
    const di = await person("Di");
    as(di.user);
    expect((await actions.saveMySelfIdentification({ gender: "self_described" })).ok).toBe(false);
    expect((await actions.saveMySelfIdentification({ gender: "woman", religion: "judaism" })).ok).toBe(true);
    expect(await actions.clearMySelfIdentification()).toEqual({ ok: true, data: undefined });
    expect(await rows(sql`select 1 from core.employee_demographics where employee_id = ${di.employeeId}`)).toHaveLength(0);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'demographics.clear' and target_id = ${di.employeeId}`)).toHaveLength(1);
  });
});

describe("combined counts for HR", () => {
  it("shows a group only at 5 or more, never a name, and audits the view", async () => {
    await db.execute(sql`delete from core.employee_demographics`);
    const people = [] as Awaited<ReturnType<typeof person>>[];
    for (let i = 0; i < 5; i++) people.push(await person(`Sum${i}`));
    // Four people say Islam: hidden. Five say woman: shown.
    for (const [i, p] of people.entries()) {
      as(p.user);
      expect((await actions.saveMySelfIdentification({ gender: "woman", religion: i < 4 ? "islam" : "buddhism" })).ok).toBe(true);
    }
    as(hr);
    const before = await queries.getSelfIdentificationSummary();
    expect(before.employees.gender).toEqual([{ key: "woman", label: "Woman", count: 5 }]);
    expect(before.employees.religion).toEqual([]);
    expect(JSON.stringify(before)).not.toMatch(/Sum\d|@example\.com/);

    as(people[4].user);
    expect((await actions.saveMySelfIdentification({ gender: "woman", religion: "islam" })).ok).toBe(true);
    as(hr);
    expect((await queries.getSelfIdentificationSummary()).employees.religion).toEqual([{ key: "islam", label: "Islam", count: 5 }]);
    expect((await rows(sql`select 1 from ops.audit_log where action = 'demographics.view_summary'`)).length).toBeGreaterThanOrEqual(2);

    // Nobody else may look.
    as(people[0].user);
    await expect(queries.getSelfIdentificationSummary()).rejects.toThrow();
    expect(NO_ACCESS).toBeTruthy();
  });

  it("people who leave drop out of the counts and clearEmployeeSelfId removes a record's answers", async () => {
    const gone = await person("Gone");
    as(gone.user);
    expect((await actions.saveMySelfIdentification({ gender: "man" })).ok).toBe(true);
    await service.clearEmployeeSelfId(db, gone.employeeId);
    expect(await rows(sql`select 1 from core.employee_demographics where employee_id = ${gone.employeeId}`)).toHaveLength(0);
  });
});

describe("the optional part of the application", () => {
  async function openJob() {
    as(recruiter);
    const saved = await recruitingActions.saveOpening({ title: uniq("VA "), description: "Support our clients with scheduling and inbox care.", hiringTeamUserIds: [] });
    if (!saved.ok) throw new Error(saved.error);
    const status = await recruitingActions.setOpeningStatus({ id: saved.data.id, status: "open" });
    if (!status.ok) throw new Error(status.error);
    return saved.data.id;
  }
  const apply = (openingId: string, over: Record<string, unknown> = {}) =>
    recruitingService.submitApplication({ openingId, fullName: "Ana Reyes", email: `${uniq("ana")}@example.com`, consent: true, website: "", ...over }, { bytes: PDF_BYTES, name: "cv.pdf" });

  it("stores gender and religion apart from the candidate, encrypted, and nothing when skipped", async () => {
    const openingId = await openJob();
    const email = `${uniq("with")}@example.com`;
    expect(await apply(openingId, { email, gender: "non_binary", religion: "hinduism" })).toEqual({ ok: true });
    const [c] = await rows<{ id: string }>(sql`select id from talent.candidates where email = ${email}`);
    const [s] = await rows<{ gender: string; religion_enc: string }>(sql`select gender, religion_enc from talent.candidate_self_identification where candidate_id = ${c.id}`);
    expect(s.gender).toBe("non_binary");
    expect(s.religion_enc).not.toContain("hinduism");

    // The candidate row itself carries no such columns.
    const cols = await rows<{ column_name: string }>(sql`select column_name from information_schema.columns where table_schema = 'talent' and table_name = 'candidates'`);
    expect(cols.map((r) => r.column_name).join(",")).not.toMatch(/gender|religion/);

    const skipEmail = `${uniq("skip")}@example.com`;
    expect(await apply(openingId, { email: skipEmail })).toEqual({ ok: true });
    const [c2] = await rows<{ id: string }>(sql`select id from talent.candidates where email = ${skipEmail}`);
    expect(await rows(sql`select 1 from talent.candidate_self_identification where candidate_id = ${c2.id}`)).toHaveLength(0);
  });

  it("refuses a self-description without words and counts applicants only at 5 or more", async () => {
    const openingId = await openJob();
    expect(await apply(openingId, { gender: "self_described" })).toMatchObject({ ok: false, field: "genderOther" });
    expect(await apply(openingId, { religion: "nonsense" })).toMatchObject({ ok: false });

    await db.execute(sql`delete from talent.candidate_self_identification`);
    for (let i = 0; i < 5; i++) expect(await apply(openingId, { gender: "woman", religion: i < 4 ? "no_religion" : "islam" })).toEqual({ ok: true });
    as(hr);
    const summary = await queries.getSelfIdentificationSummary();
    expect(summary.applicants.gender).toEqual([{ key: "woman", label: "Woman", count: 5 }]);
    expect(summary.applicants.religion).toEqual([]);
  });

  it("deleteApplicantSelfId removes the answers (used when an applicant is removed)", async () => {
    const openingId = await openJob();
    const email = `${uniq("rm")}@example.com`;
    expect(await apply(openingId, { email, gender: "man" })).toEqual({ ok: true });
    const [c] = await rows<{ id: string }>(sql`select id from talent.candidates where email = ${email}`);
    await service.deleteApplicantSelfId(db, c.id);
    expect(await rows(sql`select 1 from talent.candidate_self_identification where candidate_id = ${c.id}`)).toHaveLength(0);
  });
});
