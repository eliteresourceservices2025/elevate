import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";

// Real-database tests for assets (Phase 4.3): registering, assigning and returning with the rules, the append-only history, who sees
// which item, the in-app notices, archiving, and the offboarding check that ticks when nothing is left with the person.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.51" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/assets/actions");
const queries = await import("@/modules/assets/queries");
const onboardingService = await import("@/modules/onboarding/service");
const onboardingActions = await import("@/modules/onboarding/actions");
const { setLoginDisabler } = await import("@/modules/onboarding/accounts");

type Res = { ok: boolean; error?: string; data?: { id?: string; tag?: string } };
const act = actions as unknown as Record<string, (input: unknown) => Promise<Res>>;
type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};

let hr: TestUser;
let lead: TestUser;
let otherLead: TestUser;
let worker: TestUser;
let workerId: string;
let stranger: TestUser;
let strangerId: string;
let recruiter: TestUser;
let executive: TestUser;

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}

async function makePerson(label: string, roles: RoleSlug[], managerId?: string) {
  const user = await makeUser(label, roles);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, manager_id, start_date)
    values (${label}, 'Tester', ${user.email}, 'active', ${user.id}, ${managerId ?? null}, '2026-01-05') returning id`);
  return { user, employeeId: e.id };
}

const newTag = () => `T-${Date.now().toString(36)}${counter++}`.toUpperCase();
async function newAsset(extra: Record<string, unknown> = {}) {
  as(hr);
  const tag = newTag();
  const r = await act.createAsset({ tag, name: "Test laptop", category: "laptop", ...extra });
  if (!r.ok) throw new Error(r.error);
  return { id: r.data!.id as string, tag: r.data!.tag as string };
}

beforeAll(async () => {
  setLoginDisabler(async () => {});
  hr = await makeUser("hr", ["hr_admin"]);
  recruiter = await makeUser("recruiter", ["recruiter"]);
  executive = await makeUser("executive", ["executive"]);
  const l = await makePerson("lead", ["team_lead"]);
  lead = l.user;
  otherLead = (await makePerson("otherlead", ["team_lead"])).user;
  const w = await makePerson("worker", ["employee"], l.employeeId);
  worker = w.user;
  workerId = w.employeeId;
  const s = await makePerson("stranger", ["employee"]);
  stranger = s.user;
  strangerId = s.employeeId;
});

describe("registering items", () => {
  it("HR registers an item with its tag normalized, audited, and refuses a duplicate tag in any case", async () => {
    as(hr);
    const tag = newTag();
    const r = await act.createAsset({ tag: tag.toLowerCase(), name: "Dell Latitude", category: "laptop", serialNumber: "SN-1", purchaseDate: "2026-03-01", notes: "Spare" });
    expect(r).toMatchObject({ ok: true, data: { tag } });
    const [a] = await rows<{ status: string; tag: string; purchase_date: string }>(sql`select status, tag, purchase_date::text as purchase_date from talent.assets where id = ${r.data!.id}`);
    expect(a).toMatchObject({ status: "in_stock", tag, purchase_date: "2026-03-01" });
    const audit = await rows(sql`select 1 from ops.audit_log where action = 'asset.create' and target_id = ${r.data!.id}`);
    expect(audit.length).toBe(1);
    expect((await act.createAsset({ tag: tag.toLowerCase(), name: "Another", category: "headset" })).error).toBe("That tag is already used by another item.");
  });

  it("only HR registers, edits, changes status and archives", async () => {
    const { id, tag } = await newAsset();
    for (const u of [lead, worker, recruiter, executive]) {
      as(u);
      expect((await act.createAsset({ tag: newTag(), name: "X item", category: "other" })).error).toBe(NO_ACCESS);
      expect((await act.updateAsset({ assetId: id, name: "Renamed", category: "other" })).error).toBe(NO_ACCESS);
      expect((await act.setAssetStatus({ assetId: id, status: "repair" })).error).toBe(NO_ACCESS);
      expect((await act.archiveAsset({ assetId: id, archive: true })).error).toBe(NO_ACCESS);
      expect((await act.assignAsset({ assetId: id, employeeId: workerId, condition: "good" })).error).toBe(NO_ACCESS);
    }
    as(hr);
    expect((await act.updateAsset({ assetId: id, name: "Renamed", category: "monitor", notes: "Note" })).ok).toBe(true);
    const [a] = await rows<{ name: string; tag: string }>(sql`select name, tag from talent.assets where id = ${id}`);
    expect(a).toEqual({ name: "Renamed", tag }); // the tag never changes
  });
});

describe("assigning and returning", () => {
  it("assigns with date, condition and who handed it over, tells the person (no serial number), and refuses a second assignment", async () => {
    const { id, tag } = await newAsset({ serialNumber: "SECRET-SN-99" });
    as(hr);
    expect((await act.assignAsset({ assetId: id, employeeId: workerId, condition: "new", note: "Box sealed" })).ok).toBe(true);
    const [a] = await rows<{ status: string }>(sql`select status from talent.assets where id = ${id}`);
    expect(a.status).toBe("assigned");
    const [h] = await rows<{ condition_out: string; assigned_by: string; employee_id: string; returned_at: Date | null }>(sql`select condition_out, assigned_by, employee_id, returned_at from talent.asset_assignments where asset_id = ${id}`);
    expect(h).toMatchObject({ condition_out: "new", assigned_by: hr.id, employee_id: workerId, returned_at: null });
    const notes = await rows<{ title: string; body: string; link: string }>(sql`select title, body, link from ops.notifications where user_id = ${worker.id} and kind = 'asset.assigned'`);
    expect(notes.length).toBeGreaterThan(0);
    const note = notes[notes.length - 1];
    expect(note.link).toBe(`/assets/${tag}`);
    expect(`${note.title} ${note.body}`).not.toContain("SECRET-SN-99");
    const audit = await rows<{ after: { handedOverBy: string } }>(sql`select after from ops.audit_log where action = 'asset.assign' and target_id = ${id}`);
    expect(audit[0].after.handedOverBy).toBe(hr.id);

    // One active assignment at a time, to anyone
    expect((await act.assignAsset({ assetId: id, employeeId: strangerId, condition: "good" })).ok).toBe(false);
    expect((await act.assignAsset({ assetId: id, employeeId: workerId, condition: "good" })).ok).toBe(false);
  });

  it("the database itself refuses two open assignments for one item", async () => {
    const { id } = await newAsset();
    await db.execute(sql`insert into talent.asset_assignments (asset_id, employee_id, condition_out, assigned_by) values (${id}, ${workerId}, 'good', ${hr.id})`);
    await expect(db.execute(sql`insert into talent.asset_assignments (asset_id, employee_id, condition_out, assigned_by) values (${id}, ${strangerId}, 'good', ${hr.id})`)).rejects.toThrow();
  });

  it("refuses to assign a lost, retired, in-repair or archived item, and someone who has left", async () => {
    as(hr);
    const lost = await newAsset();
    expect((await act.setAssetStatus({ assetId: lost.id, status: "lost" })).ok).toBe(true);
    expect((await act.assignAsset({ assetId: lost.id, employeeId: workerId, condition: "good" })).error).toBe("This item is marked lost.");
    const retired = await newAsset();
    await act.setAssetStatus({ assetId: retired.id, status: "retired" });
    expect((await act.assignAsset({ assetId: retired.id, employeeId: workerId, condition: "good" })).error).toBe("This item is retired.");
    expect((await act.setAssetStatus({ assetId: retired.id, status: "in_stock" })).ok).toBe(false); // retired is final
    const repair = await newAsset();
    await act.setAssetStatus({ assetId: repair.id, status: "repair" });
    expect((await act.assignAsset({ assetId: repair.id, employeeId: workerId, condition: "good" })).ok).toBe(false);
    const archived = await newAsset();
    expect((await act.archiveAsset({ assetId: archived.id, archive: true })).ok).toBe(true);
    expect((await act.assignAsset({ assetId: archived.id, employeeId: workerId, condition: "good" })).error).toBe("This item is archived.");
    const left = await makePerson("leaver", ["employee"]);
    await db.execute(sql`update core.employees set status = 'separated' where id = ${left.employeeId}`);
    const fresh = await newAsset();
    as(hr);
    expect((await act.assignAsset({ assetId: fresh.id, employeeId: left.employeeId, condition: "good" })).ok).toBe(false);
  });

  it("returns with date, condition and who received it, then it can be assigned again; history is kept", async () => {
    const { id } = await newAsset();
    as(hr);
    await act.assignAsset({ assetId: id, employeeId: workerId, condition: "good" });
    expect((await act.returnAsset({ assetId: id, condition: "fair", note: "Scratched lid" })).ok).toBe(true);
    const [a] = await rows<{ status: string }>(sql`select status from talent.assets where id = ${id}`);
    expect(a.status).toBe("in_stock");
    const [h] = await rows<{ condition_in: string; received_by: string; returned_at: Date | null }>(sql`select condition_in, received_by, returned_at from talent.asset_assignments where asset_id = ${id}`);
    expect(h).toMatchObject({ condition_in: "fair", received_by: hr.id });
    expect(h.returned_at).not.toBeNull();
    const notes = await rows(sql`select 1 from ops.notifications where user_id = ${worker.id} and kind = 'asset.returned'`);
    expect(notes.length).toBeGreaterThan(0);

    // Not assigned any more: a second return fails; reassigning works and keeps two rows
    expect((await act.returnAsset({ assetId: id, condition: "good" })).ok).toBe(false);
    expect((await act.assignAsset({ assetId: id, employeeId: strangerId, condition: "fair" })).ok).toBe(true);
    const all = await rows(sql`select 1 from talent.asset_assignments where asset_id = ${id}`);
    expect(all.length).toBe(2);
  });

  it("a damaged or lost return moves the item to the status HR picks", async () => {
    as(hr);
    const a = await newAsset();
    await act.assignAsset({ assetId: a.id, employeeId: workerId, condition: "good" });
    await act.returnAsset({ assetId: a.id, condition: "damaged", nextStatus: "repair" });
    expect((await rows<{ status: string }>(sql`select status from talent.assets where id = ${a.id}`))[0].status).toBe("repair");
    const b = await newAsset();
    await act.assignAsset({ assetId: b.id, employeeId: workerId, condition: "good" });
    await act.returnAsset({ assetId: b.id, condition: "good", nextStatus: "lost" });
    expect((await rows<{ status: string }>(sql`select status from talent.assets where id = ${b.id}`))[0].status).toBe("lost");
  });

  it("an assigned item cannot be archived or have its status set by hand", async () => {
    const { id } = await newAsset();
    as(hr);
    await act.assignAsset({ assetId: id, employeeId: workerId, condition: "good" });
    expect((await act.archiveAsset({ assetId: id, archive: true })).ok).toBe(false);
    expect((await act.setAssetStatus({ assetId: id, status: "lost" })).ok).toBe(false);
    expect((await act.setAssetStatus({ assetId: id, status: "in_stock" })).ok).toBe(false);
  });
});

describe("the history is append-only", () => {
  it("allows closing an assignment once and nothing else", async () => {
    const { id } = await newAsset();
    as(hr);
    await act.assignAsset({ assetId: id, employeeId: workerId, condition: "good" });
    // The assignment details never change
    await expect(db.execute(sql`update talent.asset_assignments set employee_id = ${strangerId} where asset_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`update talent.asset_assignments set condition_out = 'new' where asset_id = ${id}`)).rejects.toThrow();
    await act.returnAsset({ assetId: id, condition: "good" });
    // A returned row is frozen and nothing can be deleted
    await expect(db.execute(sql`update talent.asset_assignments set condition_in = 'new' where asset_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from talent.asset_assignments where asset_id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`truncate talent.asset_assignments`)).rejects.toThrow();
  });
});

describe("who sees what", () => {
  it("HR sees everything; the person and their lead see the item; others get nothing", async () => {
    const { id, tag } = await newAsset({ notes: "HR private note", purchaseDate: "2026-01-01" });
    as(hr);
    await act.assignAsset({ assetId: id, employeeId: workerId, condition: "good" });

    as(hr);
    const asHr = await queries.getAsset(tag);
    expect(asHr?.notes).toBe("HR private note");
    expect(asHr?.history[0].assignedBy).not.toBeNull();
    expect(asHr?.canAssign).toBe(true);

    as(worker);
    const asWorker = await queries.getAsset(tag.toLowerCase());
    expect(asWorker).not.toBeNull();
    expect(asWorker?.notes).toBeNull();
    expect(asWorker?.purchaseDate).toBeNull();
    expect(asWorker?.canManage).toBe(false);
    expect(asWorker?.history.every((h) => h.assignedBy === null)).toBe(true);

    as(lead);
    expect(await queries.getAsset(tag)).not.toBeNull(); // the worker reports to this lead
    as(otherLead);
    expect(await queries.getAsset(tag)).toBeNull();
    as(stranger);
    expect(await queries.getAsset(tag)).toBeNull();
    as(recruiter);
    await expect(queries.getAsset(tag)).rejects.toMatchObject({ name: "ForbiddenError" });
    as(executive);
    await expect(queries.getAsset(tag)).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("an employee sees only their own rows of an item that moved between people, and still sees it after returning it", async () => {
    const { id, tag } = await newAsset();
    as(hr);
    await act.assignAsset({ assetId: id, employeeId: workerId, condition: "good" });
    await act.returnAsset({ assetId: id, condition: "good" });
    await act.assignAsset({ assetId: id, employeeId: strangerId, condition: "good" });

    as(worker);
    const w = await queries.getAsset(tag);
    expect(w?.history.length).toBe(1);
    expect(w?.history[0].employeeId).toBe(workerId);
    as(stranger);
    const s = await queries.getAsset(tag);
    expect(s?.history.length).toBe(1);
    expect(s?.history[0].employeeId).toBe(strangerId);
  });

  it("My assets lists only what is with the signed-in person now; the lead's team list covers the downline only", async () => {
    const a = await newAsset();
    const b = await newAsset();
    as(hr);
    await act.assignAsset({ assetId: a.id, employeeId: workerId, condition: "good" });
    await act.assignAsset({ assetId: b.id, employeeId: strangerId, condition: "good" });
    as(worker);
    const mine = (await queries.getMyAssets()).map((x) => x.tag);
    expect(mine).toContain(a.tag);
    expect(mine).not.toContain(b.tag);
    as(lead);
    const team = (await queries.listTeamAssets()).map((x) => x.tag);
    expect(team).toContain(a.tag);
    expect(team).not.toContain(b.tag);
    as(otherLead);
    expect((await queries.listTeamAssets()).map((x) => x.tag)).not.toContain(a.tag);
  });

  it("the inventory filters by status, category and search, and pages", async () => {
    const marker = uniq("zq").toUpperCase();
    as(hr);
    for (let i = 0; i < 3; i++) await act.createAsset({ tag: `${marker}-${i}`, name: `Headset ${marker}`, category: "headset", serialNumber: `SER${marker}${i}` });
    await act.createAsset({ tag: `${marker}-L`, name: `Laptop ${marker}`, category: "laptop" });
    const all = await queries.listAssets({ q: marker.toLowerCase() }, { page: 1, pageSize: 25 });
    expect(all.total).toBe(4);
    const heads = await queries.listAssets({ q: marker, category: "headset" }, { page: 1, pageSize: 25 });
    expect(heads.total).toBe(3);
    const bySerial = await queries.listAssets({ q: `SER${marker}1` }, { page: 1, pageSize: 25 });
    expect(bySerial.rows.map((r) => r.tag)).toEqual([`${marker}-1`]);
    const paged = await queries.listAssets({ q: marker }, { page: 2, pageSize: 3 });
    expect(paged.rows.length).toBe(1);
    expect(paged.info.pages).toBe(2);
    // A search with wildcard characters matches literally
    expect((await queries.listAssets({ q: "%" }, { page: 1, pageSize: 25 })).total).toBe(0);
    expect((await queries.listAssets({ q: marker, status: "assigned" }, { page: 1, pageSize: 25 })).total).toBe(0);
  });

  it("archived items leave the default inventory but keep their history", async () => {
    const { id, tag } = await newAsset();
    as(hr);
    await act.archiveAsset({ assetId: id, archive: true });
    expect((await queries.listAssets({ q: tag }, { page: 1, pageSize: 25 })).total).toBe(0);
    expect((await queries.listAssets({ q: tag, archived: true }, { page: 1, pageSize: 25 })).total).toBe(1);
    expect((await queries.getLabelItems([tag])).length).toBe(0);
    expect((await act.archiveAsset({ assetId: id, archive: false })).ok).toBe(true);
    expect((await queries.getLabelItems([tag.toLowerCase()])).map((l) => l.tag)).toEqual([tag]);
  });
});

describe("offboarding check", () => {
  it("'assets_returned' is satisfied only when nothing is with the person", async () => {
    const leaver = await makePerson("leaver2", ["employee"]);
    const { id } = await newAsset();
    as(hr);
    await act.assignAsset({ assetId: id, employeeId: leaver.employeeId, condition: "good" });
    const started = await (onboardingActions as unknown as Record<string, (i: unknown) => Promise<{ ok: boolean; error?: string; data?: { caseId: string } }>>).startOffboarding({ employeeId: leaver.employeeId, lastWorkingDay: new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10), reason: "resignation" });
    if (!started.ok) throw new Error(started.error);
    const caseId = started.data!.caseId;
    const [task] = await rows<{ id: string; check_kind: string; status: string }>(sql`select id, check_kind, status from talent.checklist_tasks where offboarding_case_id = ${caseId} and title = 'Equipment and assets returned'`);
    expect(task.check_kind).toBe("assets_returned");

    await onboardingService.syncCase("offboarding", caseId);
    expect((await rows<{ status: string }>(sql`select status from talent.checklist_tasks where id = ${task.id}`))[0].status).toBe("todo");

    as(hr);
    await act.returnAsset({ assetId: id, condition: "good" });
    await onboardingService.syncCase("offboarding", caseId);
    const [after] = await rows<{ status: string; auto_completed: boolean }>(sql`select status, auto_completed from talent.checklist_tasks where id = ${task.id}`);
    expect(after).toMatchObject({ status: "done", auto_completed: true });
  });
});
