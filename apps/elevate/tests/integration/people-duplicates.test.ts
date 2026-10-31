import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { companyId, fakeCompany, toCsv } from "../fixtures/talenthr-export";

// Real-database tests for the doubled-person bug: a person whose work email or name changed must never end up with a second record,
// and an existing double can be merged, with the sign-in account following the person. All people here are invented.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { db } = await import("@/lib/db");
const people = await import("@/modules/people/actions");
const merging = await import("@/modules/people/duplicates-actions");
// loosely typed so the tests can read .error on a failure and .data on a success
const m = merging as unknown as Record<string, (input: unknown) => Promise<{ ok: boolean; error?: string; data?: unknown }>>;
const report = await import("@/modules/people/duplicates-queries");
const orgQueries = await import("@/modules/org/queries");
const importService = await import("@/modules/imports/service");
const { parseCsv } = await import("@/modules/imports/csv");
const { defaultMapping } = await import("@/modules/imports/mapping");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};

let hr: TestUser;
let hr2: TestUser;
let superAdmin: TestUser;
let staff: TestUser;

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

/** A people record, optionally linked to an account; `age` is how many days ago it was added. */
async function makeRecord(first: string, last: string, over: { email?: string; userId?: string | null; age?: number; personalEmail?: string; managerId?: string; status?: string } = {}) {
  const email = over.email ?? `${uniq("rec")}@example.com`;
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, personal_email, status, user_id, manager_id, created_at)
    values (${first}, ${last}, ${email}, ${over.personalEmail ?? null}, ${over.status ?? "active"}, ${over.userId ?? null}, ${over.managerId ?? null}, now() - make_interval(days => ${over.age ?? 0})) returning id`);
  return { id: e.id, email };
}
const record = async (id: string) => (await rows<{ work_email: string; user_id: string | null; archived_at: Date | null; manager_id: string | null }>(sql`select work_email, user_id, archived_at, manager_id from core.employees where id = ${id}`))[0];

const person = (first: string, last: string, email: string, extra: Record<string, unknown> = {}) => ({ legalFirstName: first, legalLastName: last, workEmail: email, position: "Virtual Assistant", startDate: "2026-09-01", ...extra });

beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin"]);
  hr2 = await makeUser("hr2", ["hr_admin"]);
  superAdmin = await makeUser("sa", ["super_admin"]);
  staff = await makeUser("staff", ["employee"]);
});

describe("adding a person who is already here", () => {
  it("refuses the same name with a shared signal, asks about the same name alone, and allows a confirmed different person", async () => {
    const last = uniq("Dizon");
    await makeRecord("Carla", last, { personalEmail: "carla.shared@gmail.com" });
    as(hr);
    const same = await people.createEmployee(person("Carla", last, `${uniq("n")}@example.com`, { personalEmail: "Carla.Shared@gmail.com" }));
    expect(same).toMatchObject({ ok: false, error: expect.stringContaining("Looks like Carla") });
    expect((same as { error: string }).error).toContain("the same email");

    const nameOnly = await people.createEmployee(person("Carla", last, `${uniq("n")}@example.com`));
    expect(nameOnly).toMatchObject({ ok: false, error: expect.stringMatching(/^Possible duplicate/) });
    expect(await rows(sql`select 1 from core.employees where legal_last_name = ${last}`)).toHaveLength(1);

    const confirmed = await people.createEmployee(person("Carla", last, `${uniq("n")}@example.com`, { confirmDifferentPerson: true }));
    expect(confirmed.ok).toBe(true);
    expect(await rows(sql`select 1 from core.employees where legal_last_name = ${last}`)).toHaveLength(2);
    // a person with another name is not asked anything
    expect((await people.createEmployee(person("Dario", uniq("Lopez"), `${uniq("n")}@example.com`))).ok).toBe(true);
  });

  it("keeps the plain message for a repeated work email, and refuses your own second record", async () => {
    const last = uniq("Evans");
    const email = `${uniq("same")}@example.com`;
    await makeRecord("Eli", last, { email });
    as(hr);
    expect(await people.createEmployee(person("Eli", last, email))).toEqual({ ok: false, error: "Someone with that work email already exists." });
    // an HR account with no record yet, whose name is on another record (made before their email changed), is not given a second one
    const me = await makeUser("owner", ["hr_admin"]);
    await makeRecord("Olive", last, { email: `${uniq("old")}@example.com` });
    as(me);
    // not allowed to create a record without first confirming that none of the existing ones is theirs
    expect(await people.createMyProfile({ firstName: "Zed", lastName: uniq("Nobody") })).toMatchObject({ ok: false, error: expect.stringContaining("Look through the list") });
    expect(await people.createMyProfile({ firstName: "Olive", lastName: last, confirmNotListed: true })).toMatchObject({ ok: false, error: expect.stringContaining("already a people record with your name") });
    expect(await rows(sql`select 1 from core.employees where user_id = ${me.id}`)).toHaveLength(0);
  });
});

describe("merging two records of the same person", () => {
  it("keeps the older record, moves the sign-in account and the new email to it, copies roles, archives the duplicate, and the org chart shows one", async () => {
    const last = uniq("Reyes");
    const oldUser = await makeUser("old", ["team_lead"]); // roles held by the account used before the email changed
    const newUser = await makeUser("new", []);
    const manager = await makeRecord("Mona", uniq("Boss"));
    const keep = await makeRecord("Ana", last, { email: oldUser.email, userId: oldUser.id, age: 300, managerId: manager.id });
    const dup = await makeRecord("Ana", last, { email: newUser.email, userId: newUser.id, age: 3 });
    const report1 = null as unknown;
    void report1;

    as(hr);
    const found = await report.getDuplicateReport();
    const group = found.groups.find((g) => g.people.some((p) => p.id === keep.id));
    expect(group?.people.map((p) => p.id)).toEqual([keep.id, dup.id]); // older first (the default choice)

    expect(await m.mergeDuplicate({ keepId: keep.id, duplicateId: dup.id, adoptEmail: true })).toEqual({ ok: true, data: { accountMoved: true, rolesCopied: 1, reportsMoved: 0, emailAdopted: true, learning: { assignmentsMoved: 0, assignmentsSkipped: 0, certificatesMoved: 0 } } });
    const kept = await record(keep.id);
    const gone = await record(dup.id);
    expect(kept).toMatchObject({ user_id: newUser.id, work_email: newUser.email });
    expect(gone.archived_at).not.toBeNull();
    expect(gone.user_id).toBeNull();
    expect(gone.work_email).toBe(`merged-${dup.id}@merged.invalid`);
    // the account now in use got the roles the old one held
    expect((await rows<{ role_slug: string }>(sql`select role_slug from core.user_roles where user_id = ${newUser.id}`)).map((r) => r.role_slug)).toContain("team_lead");
    // history on both, one audit row, and the org chart has one Ana
    expect((await rows<{ event_type: string }>(sql`select event_type from core.employment_history where employee_id = ${keep.id}`)).map((h) => h.event_type)).toContain("merged");
    expect(await rows(sql`select 1 from ops.audit_log where action = 'people.merge' and target_id = ${keep.id}`)).toHaveLength(1);
    const chart = await orgQueries.getOrgChart();
    expect(chart.filter((n) => n.name.includes(last))).toHaveLength(1);
    // the two are no longer listed as possible duplicates
    expect((await report.getDuplicateReport()).groups.some((g) => g.people.some((p) => p.id === keep.id))).toBe(false);
  });

  it("moves the duplicate's direct reports to the record that stays", async () => {
    const last = uniq("Cruz");
    const keep = await makeRecord("Ben", last, { age: 100 });
    const dup = await makeRecord("Ben", last, { age: 1 });
    const report1 = await makeRecord("Rita", uniq("Report"), { managerId: dup.id });
    as(hr);
    expect(await m.mergeDuplicate({ keepId: keep.id, duplicateId: dup.id, adoptEmail: false })).toMatchObject({ ok: true, data: { reportsMoved: 1, emailAdopted: false } });
    expect((await record(report1.id)).manager_id).toBe(keep.id);
    expect((await record(keep.id)).work_email).toBe(keep.email); // the email was not adopted
  });

  it("is for HR only, and refuses nonsense: the same record, an archived one, or your own account's record", async () => {
    const last = uniq("Lim");
    const a = await makeRecord("Dina", last, { age: 50 });
    const b = await makeRecord("Dina", last, { age: 2 });
    as(staff);
    expect(await m.mergeDuplicate({ keepId: a.id, duplicateId: b.id })).toEqual({ ok: false, error: NO_ACCESS });
    as(hr);
    expect((await m.mergeDuplicate({ keepId: a.id, duplicateId: a.id })).error).toMatch(/two different records/);
    // a record the actor signs in with cannot be merged away by them
    const mine = await makeRecord("Hal", last, { userId: hr2.id, age: 1 });
    const other = await makeRecord("Hal", last, { age: 60 });
    as(hr2);
    expect((await m.mergeDuplicate({ keepId: other.id, duplicateId: mine.id })).error).toMatch(/your own account/);
    as(hr);
    expect((await m.mergeDuplicate({ keepId: a.id, duplicateId: b.id })).ok).toBe(true);
    expect((await m.mergeDuplicate({ keepId: a.id, duplicateId: b.id })).error).toMatch(/current \(not archived\)/);
  });

  it("copies the Super Admin role only when a Super Admin merges", async () => {
    const last = uniq("Gil");
    const oldUser = await makeUser("oldsa2", ["super_admin"]);
    const newUser = await makeUser("newsa2", []);
    const keep = await makeRecord("Ria", last, { userId: oldUser.id, email: oldUser.email, age: 90 });
    const dup = await makeRecord("Ria", last, { userId: newUser.id, email: newUser.email, age: 1 });
    as(superAdmin);
    expect(await m.mergeDuplicate({ keepId: keep.id, duplicateId: dup.id, adoptEmail: true })).toMatchObject({ ok: true, data: { rolesCopied: 1 } });
    expect((await rows<{ role_slug: string }>(sql`select role_slug from core.user_roles where user_id = ${newUser.id}`)).map((r) => r.role_slug)).toContain("super_admin");
  });

  it("does not copy the Super Admin role unless a Super Admin merges", async () => {
    const last = uniq("Tan");
    const oldUser = await makeUser("oldsa", ["super_admin"]);
    const newUser = await makeUser("newsa", []);
    const keep = await makeRecord("Sol", last, { userId: oldUser.id, email: oldUser.email, age: 90 });
    const dup = await makeRecord("Sol", last, { userId: newUser.id, email: newUser.email, age: 1 });
    as(hr);
    expect(await m.mergeDuplicate({ keepId: keep.id, duplicateId: dup.id, adoptEmail: true })).toMatchObject({ ok: true, data: { rolesCopied: 0 } });
    expect((await rows<{ role_slug: string }>(sql`select role_slug from core.user_roles where user_id = ${newUser.id}`)).map((r) => r.role_slug)).not.toContain("super_admin");
  });
});

describe("a sign-in account with no people record", () => {
  it("is listed, and HR links it to the person's existing record (replacing the old account only when confirmed)", async () => {
    const last = uniq("Santos");
    const oldUser = await makeUser("oldacct", []);
    const stray = await makeUser("stray", []);
    const rec = await makeRecord("Mia", last, { userId: oldUser.id, email: oldUser.email });
    as(hr);
    expect((await report.getDuplicateReport()).accounts.some((a) => a.userId === stray.id)).toBe(true);
    expect((await m.relinkSignInAccount({ userId: stray.id, employeeId: rec.id })).error).toMatch(/already has a sign-in account/);
    expect(await m.relinkSignInAccount({ userId: stray.id, employeeId: rec.id, replaceExisting: true })).toEqual({ ok: true, data: { replaced: true } });
    expect((await record(rec.id)).user_id).toBe(stray.id);
    // linked: no longer listed; and an account that already has a record cannot be linked again
    expect((await report.getDuplicateReport()).accounts.some((a) => a.userId === stray.id)).toBe(false);
    const other = await makeRecord("Nia", uniq("Other"));
    expect((await m.relinkSignInAccount({ userId: stray.id, employeeId: other.id })).error).toMatch(/already belongs/);
    as(staff);
    expect(await m.relinkSignInAccount({ userId: stray.id, employeeId: other.id })).toEqual({ ok: false, error: NO_ACCESS });
  });
});

describe("an HR or Super Admin whose sign-in lost their record (changed email or name)", () => {
  it("claims the existing record instead of making a second one, replacing the old account only when confirmed", async () => {
    const oldAcct = await makeUser("hrold", ["hr_admin"]);
    const me = await makeUser("hrnew", ["hr_admin"]); // the account they sign in with now
    const rec = await makeRecord("Helena", uniq("Director"), { userId: oldAcct.id, email: oldAcct.email, age: 500 });
    as(me);
    const listed = await report.listRecordsToClaim();
    expect(listed.find((r) => r.id === rec.id)).toMatchObject({ hasAccount: true });
    expect((await m.claimMyProfile({ employeeId: rec.id })).error).toMatch(/already has a sign-in account/);
    expect(await m.claimMyProfile({ employeeId: rec.id, replaceExisting: true })).toEqual({ ok: true, data: { replaced: true } });
    expect((await record(rec.id)).user_id).toBe(me.id);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'people.relink_account' and target_id = ${rec.id}`)).toHaveLength(1);
    // now they have a record: no second one, and no second claim
    expect(await people.createMyProfile({ firstName: "Helena", lastName: "New", confirmNotListed: true })).toEqual({ ok: false, error: "You already have a people record." });
    expect((await m.claimMyProfile({ employeeId: rec.id, replaceExisting: true })).error).toMatch(/already belongs/);
    // people without HR reach cannot claim or list
    as(staff);
    expect(await m.claimMyProfile({ employeeId: rec.id, replaceExisting: true })).toEqual({ ok: false, error: NO_ACCESS });
    await expect(report.listRecordsToClaim()).rejects.toThrow();
  });
});

describe("a person who changed their name AND email is still found", () => {
  it("lists two records with different names that share a mobile number, and merges them by hand", async () => {
    const tag = uniq("Avila");
    const oldUser = await makeUser("cong", ["super_admin"]);
    const newUser = await makeUser("victor", []);
    const keep = await makeRecord("Cong", tag, { userId: oldUser.id, email: oldUser.email, age: 400 });
    const dup = await makeRecord("Victor", `Ormita ${tag}`, { userId: newUser.id, email: newUser.email, age: 5 });
    await db.execute(sql`update core.employees set mobile = '+63 917 222 3333' where id in (${keep.id}, ${dup.id})`);
    as(hr);
    const found = (await report.getDuplicateReport()).groups.find((g) => g.people.some((p) => p.id === keep.id));
    expect(found?.people.map((p) => p.id).sort()).toEqual([keep.id, dup.id].sort());
    expect(found?.signals).toEqual(["the same mobile number"]);
    expect(await m.mergeDuplicate({ keepId: keep.id, duplicateId: dup.id, adoptEmail: true })).toMatchObject({ ok: true, data: { accountMoved: true, emailAdopted: true } });
    expect((await record(keep.id)).user_id).toBe(newUser.id);
    expect((await orgQueries.getOrgChart()).filter((n) => n.name.includes(tag))).toHaveLength(1);
  });
});

describe("the import no longer splits a person whose email or name changed here", () => {
  const stage = async (csv: string) => {
    const parsed = parseCsv(csv);
    if ("error" in parsed) throw new Error(parsed.error);
    return importService.stageBatch(hr, { fileName: "export.csv", headers: parsed.headers, rows: parsed.rows, mapping: defaultMapping(parsed.headers), dateFormat: "mdy" });
  };

  it("matches on the TalentHR id, keeps the email changed here, and never creates a second record", async () => {
    const tag = uniq("dup");
    const csv = toCsv(fakeCompany(tag));
    const first = await stage(csv);
    await importService.commitBatch(hr, first.batchId, { skipErrors: true });
    const ids = await rows<{ id: string; talenthr_id: string }>(sql`select id, talenthr_id from core.employees where work_email like ${`${tag}.%`}`);
    expect(ids).toHaveLength(5);
    expect(ids.map((r) => r.talenthr_id).sort()).toEqual([1, 2, 3, 4, 5].map((n) => companyId(tag, n)).sort());

    // HR changes person 3's work email and name on the record (what the owner and others did)
    await db.execute(sql`update core.employees set work_email = ${`${tag}.renamed3@example.com`}, legal_last_name = 'Newname' where work_email = ${`${tag}.person3@example.com`}`);

    // The same export again: person 3 is found by TalentHR id; nobody is "new"
    const again = await stage(csv);
    expect(again.summary.new).toBe(0);
    expect(again.summary.errors).toBe(0);
    const preview = await rows<{ issues: { field: string; message: string }[] }>(sql`select issues from ops.import_rows where batch_id = ${again.batchId}`);
    expect(JSON.stringify(preview)).toContain("Matched by TalentHR ID");
    await importService.commitBatch(hr, again.batchId, { skipErrors: true });
    expect(await rows(sql`select 1 from core.employees where work_email like ${`${tag}.%`}`)).toHaveLength(5); // still five, not six
    // the email HR set is kept
    expect(await rows(sql`select 1 from core.employees where work_email = ${`${tag}.renamed3@example.com`}`)).toHaveLength(1);
    expect(await rows(sql`select 1 from core.employees where work_email = ${`${tag}.person3@example.com`}`)).toHaveLength(0);
  });

  it("after a merge, the import acts on the record that stayed: the archived duplicate is not brought back and its TalentHR id follows the person", async () => {
    const tag = uniq("merged");
    const csv = toCsv(fakeCompany(tag));
    const first = await stage(csv);
    await importService.commitBatch(hr, first.batchId, { skipErrors: true });
    const imported = (await rows<{ id: string }>(sql`select id from core.employees where work_email = ${`${tag}.person3@example.com`}`))[0];
    // the same human was also added by hand earlier, under their old email: that record stays, the imported one is the duplicate
    const keeper = await makeRecord("Test3", `Person3 ${tag}`, { age: 400 });
    as(hr);
    expect(await m.mergeDuplicate({ keepId: keeper.id, duplicateId: imported.id, adoptEmail: false })).toMatchObject({ ok: true });
    const kept = (await rows<{ talenthr_id: string | null }>(sql`select talenthr_id from core.employees where id = ${keeper.id}`))[0];
    const dup = (await rows<{ talenthr_id: string | null; merged_into_id: string | null; archived_at: Date | null }>(sql`select talenthr_id, merged_into_id, archived_at from core.employees where id = ${imported.id}`))[0];
    expect(kept.talenthr_id).toBe(companyId(tag, 3)); // the id moved to the record that stays
    expect(dup).toMatchObject({ talenthr_id: null, merged_into_id: keeper.id });

    // The same export again: nobody is new, the duplicate stays archived, and the keeper is the one updated
    const again = await stage(csv);
    expect(again.summary.new).toBe(0);
    const done = await importService.commitBatch(hr, again.batchId, { skipErrors: true });
    expect(done.restored).toBe(0);
    expect((await rows<{ archived_at: Date | null }>(sql`select archived_at from core.employees where id = ${imported.id}`))[0].archived_at).not.toBeNull();
    expect(await rows(sql`select 1 from core.employees where legal_last_name = ${`Person3 ${tag}`} and archived_at is null`)).toHaveLength(1);

    // And a duplicate that was merged WITHOUT moving the id (the keeper already had its own) still points at the keeper
    const tag2 = uniq("merged2");
    const csv2 = toCsv(fakeCompany(tag2));
    await importService.commitBatch(hr, (await stage(csv2)).batchId, { skipErrors: true });
    const imp2 = (await rows<{ id: string }>(sql`select id from core.employees where work_email = ${`${tag2}.person4@example.com`}`))[0];
    const keep2 = await makeRecord("Test4", `Person4 ${tag2}`, { age: 400 });
    await db.execute(sql`update core.employees set talenthr_id = ${`own-${tag2}`} where id = ${keep2.id}`);
    await m.mergeDuplicate({ keepId: keep2.id, duplicateId: imp2.id, adoptEmail: false });
    expect((await rows<{ talenthr_id: string | null }>(sql`select talenthr_id from core.employees where id = ${imp2.id}`))[0].talenthr_id).toBe(companyId(tag2, 4)); // stays on the archived record
    const again2 = await stage(csv2);
    expect(again2.summary.new).toBe(0);
    expect((await importService.commitBatch(hr, again2.batchId, { skipErrors: true })).restored).toBe(0);
    expect((await rows<{ archived_at: Date | null }>(sql`select archived_at from core.employees where id = ${imp2.id}`))[0].archived_at).not.toBeNull();
  });

  it("finds a person imported before the id was stored here, from the API pull, even when their email and name changed", async () => {
    const tag = uniq("pulled");
    const company = fakeCompany(tag);
    // person 3 was imported long ago (no TalentHR id kept), then HR changed their email and name; the pull had recorded their TalentHR id
    const old = await makeRecord("Renamed", `Person ${tag}`, { email: `${tag}.oldmail@example.com`, age: 300 });
    const [pull] = await rows<{ id: string }>(sql`insert into ops.import_pulls (status) values ('done') returning id`);
    await db.execute(sql`insert into ops.import_pull_items (pull_id, kind, source_id, employee_id, outcome) values (${pull.id}, 'leave_history', ${companyId(tag, 3)}, ${old.id}, 'archived')`);
    const staged = await stage(toCsv(company));
    expect(staged.summary.new).toBe(4); // person 3 is not new
    await importService.commitBatch(hr, staged.batchId, { skipErrors: true });
    // no second record for them, the old record kept its email and now remembers the id
    expect(await rows(sql`select 1 from core.employees where work_email = ${`${tag}.person3@example.com`}`)).toHaveLength(0);
    const kept = (await rows<{ work_email: string; talenthr_id: string }>(sql`select work_email, talenthr_id from core.employees where id = ${old.id}`))[0];
    expect(kept).toEqual({ work_email: old.email, talenthr_id: companyId(tag, 3) });
  });

  it("remembers the TalentHR id on a person found by email, and flags a new row that looks like someone already here", async () => {
    const tag = uniq("flag");
    // someone already here, made by hand (no TalentHR id yet), with a birth date
    await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, birth_date) values ('Test1', ${`Person1 ${tag}`}, ${`${tag}.person1@example.com`}, 'active', '1990-03-10')`);
    const company = fakeCompany(tag);
    const csv = toCsv(company);
    const batch = await stage(csv);
    await importService.commitBatch(hr, batch.batchId, { skipErrors: true });
    // matched by email, so its TalentHR id is now remembered
    expect((await rows<{ talenthr_id: string }>(sql`select talenthr_id from core.employees where work_email = ${`${tag}.person1@example.com`}`))[0].talenthr_id).toBe(companyId(tag, 1));

    // A new row (new id, new email) for a person who is already here: same name and birth date -> error; same name only -> warning
    const lookalike = fakeCompany(tag)[2]; // person 3
    const asNew = toCsv([{ ...lookalike, "Employee ID *": "999001", "Email *": `${tag}.changed@example.com`, "Supervisor ID *": "" }]);
    const staged = await stage(asNew);
    expect(staged.summary).toMatchObject({ new: 0, errors: 1 });
    const flagged = await rows<{ issues: { level: string; field: string; message: string }[] }>(sql`select issues from ops.import_rows where batch_id = ${staged.batchId}`);
    expect(flagged[0].issues.some((i) => i.field === "Possible duplicate" && i.level === "error")).toBe(true);
    const nameOnly = toCsv([{ ...lookalike, "Employee ID *": "999002", "Email *": `${tag}.changed2@example.com`, "Supervisor ID *": "", "custom_fields:Birth date": "01/02/1980", "custom_fields:Phone": "+63 900 000 0000" }]);
    const stagedName = await stage(nameOnly);
    expect(stagedName.summary).toMatchObject({ new: 1, errors: 0 });
    const warned = await rows<{ issues: { level: string; field: string }[] }>(sql`select issues from ops.import_rows where batch_id = ${stagedName.batchId}`);
    expect(warned[0].issues.some((i) => i.field === "Possible duplicate" && i.level === "warning")).toBe(true);
  });
});
