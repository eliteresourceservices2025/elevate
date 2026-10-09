import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for certificates: adding and importing (invented rows), a repeat import adding nothing, the reminders (once per
// threshold, silent for ones recorded inside a window, none for a renewed or removed certificate or someone who left), and who sees which.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.61" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/credentials/actions");
const queries = await import("@/modules/credentials/queries");
const jobs = await import("@/modules/credentials/jobs");

type Res = { ok: boolean; error?: string; data?: Record<string, unknown> };
const act = actions as unknown as Record<string, (input: unknown) => Promise<Res>>;
type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const plus = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const TODAY = "2026-10-12";

let hr: TestUser;
let lead: TestUser;
let worker: TestUser;
let workerId: string;
let workerEmail: string;
let stranger: TestUser;
let recruiter: TestUser;

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

async function makePerson(label: string, roles: RoleSlug[], managerId?: string, status = "active") {
  const user = await makeUser(label, roles);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, start_date)
    values (${label}, 'Tester', ${user.email}, ${status}, ${user.id}, ${managerId ?? null}, '2026-01-05') returning id`);
  return { user, employeeId: e.id };
}

const add = async (employeeId: string, name: string, expiresOn: string) => {
  as(hr);
  const r = await act.addCredential({ employeeId, name, expiresOn });
  if (!r.ok) throw new Error(r.error);
  return r.data!.id as string;
};
const noticesFor = (userId: string) => rows<{ title: string }>(sql`select title from ops.notifications where user_id = ${userId} and kind = 'credential.expiring' order by created_at`);

beforeAll(async () => {
  hr = await makeUser("hr", ["hr_admin"]);
  recruiter = await makeUser("recruiter", ["recruiter"]);
  const l = await makePerson("lead", ["team_lead"]);
  lead = l.user;
  const w = await makePerson("worker", ["employee"], l.employeeId);
  worker = w.user;
  workerId = w.employeeId;
  workerEmail = w.user.email;
  stranger = (await makePerson("stranger", ["employee"])).user;
});

describe("adding and removing", () => {
  it("records a certificate, refuses the same one twice, and removing hides it", async () => {
    const id = await add(workerId, "HIPAA Awareness certificate", "2027-03-01");
    as(hr);
    expect((await act.addCredential({ employeeId: workerId, name: "hipaa awareness CERTIFICATE", expiresOn: "2027-03-01" })).error).toBe("That certificate is already recorded for this person with the same end date.");
    expect((await act.addCredential({ employeeId: workerId, name: "HIPAA", issuedOn: "2027-04-01", expiresOn: "2027-03-01" })).ok).toBe(false);
    expect((await act.removeCredential({ credentialId: id })).ok).toBe(true);
    expect((await act.removeCredential({ credentialId: id })).error).toBe("That certificate was not found.");
    expect(await rows(sql`select 1 from ops.audit_log where action in ('credential.add','credential.remove') and target_id = ${id}`)).toHaveLength(2);
    const mine = (as(worker), await queries.getMyCredentials());
    expect(mine.find((c) => c.id === id)).toBeUndefined();
  });

  it("refuses everyone but HR and Super Admin", async () => {
    for (const u of [lead, worker, recruiter]) {
      as(u);
      expect(await act.addCredential({ employeeId: workerId, name: "HIPAA", expiresOn: "2027-03-01" })).toEqual({ ok: false, error: NO_ACCESS });
    }
  });
});

describe("loading from the TalentHR assets file", () => {
  const head = 'UUID,"Name *",Category,Cost,Currency,"Purchase date","Warranty end date",Status,"Assignment Email","GUIDE ROW"';
  const guide = '"","REQUIRED",,,,,,,"OPTIONAL",yes';
  const line = (name: string, bought: string, ends: string, email: string) => `u,"${name}","Software and Licenses",30.00,USD,${bought},${ends},"In use",${email},no`;

  it("previews without saving, loads once, skips what cannot be matched, and a repeat adds nothing", async () => {
    const leaver = await makePerson("leaver", ["employee"], undefined, "separated");
    const cert = `HIPAA import ${uniq("n")}`;
    const csv = [head, guide, line(cert, "01/05/2026", "08/09/2027", workerEmail.toUpperCase()), line(cert, "01/05/2026", "08/09/2027", `nobody-${uniq("x")}@example.com`), line(cert, "01/05/2026", "08/09/2027", leaver.user.email), line(cert, "01/05/2026", "", workerEmail), line("MacBook", "01/05/2026", "08/09/2027", workerEmail)].join("\n") + "\n";

    as(hr);
    const preview = await act.importCredentials({ csv, nameContains: cert, commit: false });
    expect(preview.data).toMatchObject({ committed: false, looked: 4, created: 1, alreadyThere: 0 });
    expect((preview.data!.skipped as { reason: string }[]).map((s) => s.reason).sort()).toEqual(["No longer on the team", "No person with that email in ELEVATE (import the people first)", "No valid end date"]);
    expect(await rows(sql`select 1 from talent.credentials where lower(name) = ${cert.toLowerCase()}`)).toHaveLength(0);

    const done = await act.importCredentials({ csv, nameContains: cert, commit: true });
    expect(done.data).toMatchObject({ committed: true, created: 1 });
    const [saved] = await rows<{ source: string; issued_on: string; expires_on: string }>(sql`select source, issued_on::text, expires_on::text from talent.credentials where lower(name) = ${cert.toLowerCase()}`);
    expect(saved).toEqual({ source: "talenthr", issued_on: "2026-01-05", expires_on: "2027-08-09" });

    const again = await act.importCredentials({ csv, nameContains: cert, commit: true });
    expect(again.data).toMatchObject({ created: 0, alreadyThere: 1 });
    expect(await rows(sql`select 1 from talent.credentials where lower(name) = ${cert.toLowerCase()}`)).toHaveLength(1);
    const [audit] = await rows<{ metadata: Record<string, number> }>(sql`select metadata from ops.audit_log where action = 'credential.import' order by occurred_at desc limit 1`);
    expect(audit.metadata).toMatchObject({ created: 1 }); // the repeat added nothing, so it wrote no entry
    expect(JSON.stringify(audit.metadata)).not.toContain(cert);
  });

  it("refuses a file that is not the assets file", async () => {
    as(hr);
    expect((await act.importCredentials({ csv: "Employee ID,Email\n1,a@example.com\n", nameContains: "HIPAA", commit: false })).ok).toBe(false);
  });
});

describe("reminders", () => {
  it("sends the 30, 7 and 0 day notices once each, and nothing twice", async () => {
    const p = await makePerson("remind", ["employee"]);
    const name = `HIPAA ${uniq("r")}`;
    // 40 days out when added: nothing is due yet
    const id = await add(p.employeeId, name, plus(TODAY, 40));
    expect(await jobs.runCredentialReminders(TODAY)).toMatchObject({ employeeNotices: 0 });
    // 30 days out
    const at30 = await jobs.runCredentialReminders(plus(TODAY, 10));
    expect(at30.employeeNotices).toBe(1);
    expect(await jobs.runCredentialReminders(plus(TODAY, 10))).toMatchObject({ employeeNotices: 0 });
    // a day with 5 days left sends only the 7-day notice, once
    expect((await jobs.runCredentialReminders(plus(TODAY, 35))).employeeNotices).toBe(1);
    expect((await jobs.runCredentialReminders(plus(TODAY, 36))).employeeNotices).toBe(0);
    // the end date itself
    expect((await jobs.runCredentialReminders(plus(TODAY, 40))).employeeNotices).toBe(1);
    const notices = await noticesFor(p.user.id);
    expect(notices).toHaveLength(3);
    expect(notices[2].title).toContain("expires today");
    expect(id).toBeTruthy();
  });

  it("is silent for a certificate added inside a window, then sends the next threshold", async () => {
    const p = await makePerson("silent", ["employee"]);
    await add(p.employeeId, `HIPAA ${uniq("s")}`, plus(TODAY, 20)); // already past the 30-day mark when added
    expect((await jobs.runCredentialReminders(TODAY)).employeeNotices).toBe(0);
    expect((await jobs.runCredentialReminders(plus(TODAY, 14))).employeeNotices).toBe(1); // 6 days left: the 7-day notice
  });

  it("sends nothing for a renewed certificate, a removed one, or someone who has left", async () => {
    const name = `HIPAA ${uniq("x")}`;
    const renewed = await makePerson("renewed", ["employee"]);
    await add(renewed.employeeId, name, plus(TODAY, 5)).then(() => undefined);
    // recorded before the window so it is not silenced: insert directly with no reminder rows
    const old = await rows<{ id: string }>(sql`insert into talent.credentials (employee_id, name, expires_on, source) values (${renewed.employeeId}, ${name + " old"}, ${plus(TODAY, 3)}, 'manual') returning id`);
    await db.execute(sql`insert into talent.credentials (employee_id, name, expires_on, source) values (${renewed.employeeId}, ${name + " old"}, ${plus(TODAY, 400)}, 'manual')`);
    expect(old).toHaveLength(1);
    await jobs.runCredentialReminders(TODAY);
    const titles = (await noticesFor(renewed.user.id)).map((n) => n.title);
    expect(titles.some((t) => t.includes("old"))).toBe(false);

    const removed = await makePerson("removed", ["employee"]);
    const [r] = await rows<{ id: string }>(sql`insert into talent.credentials (employee_id, name, expires_on, source, archived_at) values (${removed.employeeId}, ${name + " r"}, ${plus(TODAY, 2)}, 'manual', now()) returning id`);
    const gone = await makePerson("gone", ["employee"], undefined, "separated");
    await db.execute(sql`insert into talent.credentials (employee_id, name, expires_on, source) values (${gone.employeeId}, ${name + " g"}, ${plus(TODAY, 2)}, 'manual')`);
    await jobs.runCredentialReminders(TODAY);
    expect(r.id).toBeTruthy();
    expect(await noticesFor(removed.user.id)).toHaveLength(0);
    expect(await noticesFor(gone.user.id)).toHaveLength(0);
  });
});

describe("who sees what", () => {
  it("HR sees everyone, a lead only their downline, an employee only their own, others nothing", async () => {
    const mineName = `HIPAA ${uniq("v")}`;
    const strangerP = await rows<{ id: string }>(sql`select id from core.employees where user_id = ${stranger.id}`);
    await add(workerId, mineName, "2027-05-05");
    await add(strangerP[0].id, `${mineName} stranger`, "2027-05-05");

    as(hr);
    const all = await queries.listCredentials({ q: mineName }, { page: 1, pageSize: 25 });
    expect(all.rows.map((r) => r.name).sort()).toEqual([mineName, `${mineName} stranger`].sort());

    as(lead);
    expect((await queries.listTeamCredentials()).map((r) => r.name)).toContain(mineName);
    expect((await queries.listTeamCredentials()).map((r) => r.name)).not.toContain(`${mineName} stranger`);
    await expect(queries.listCredentials({}, { page: 1, pageSize: 25 })).rejects.toThrow();

    as(worker);
    expect((await queries.getMyCredentials()).map((r) => r.name)).toEqual(expect.arrayContaining([mineName]));
    expect((await queries.getMyCredentials()).map((r) => r.name)).not.toContain(`${mineName} stranger`);
    await expect(queries.listTeamCredentials()).rejects.toThrow();

    as(recruiter);
    await expect(queries.getMyCredentials()).rejects.toThrow();
  });

  it("marks an older certificate as renewed and keeps it out of the expired list", async () => {
    const p = await makePerson("renew2", ["employee"]);
    const name = `HIPAA ${uniq("w")}`;
    await db.execute(sql`insert into talent.credentials (employee_id, name, expires_on, source) values (${p.employeeId}, ${name}, '2020-01-01', 'manual')`);
    await db.execute(sql`insert into talent.credentials (employee_id, name, expires_on, source) values (${p.employeeId}, ${name}, '2090-01-01', 'manual')`);
    as(hr);
    const expired = await queries.listCredentials({ status: "expired", q: name }, { page: 1, pageSize: 25 });
    expect(expired.rows).toHaveLength(0);
    const everything = await queries.listCredentials({ q: name }, { page: 1, pageSize: 25 });
    expect(everything.rows.map((r) => r.renewed).sort()).toEqual([false, true]);
  });
});
