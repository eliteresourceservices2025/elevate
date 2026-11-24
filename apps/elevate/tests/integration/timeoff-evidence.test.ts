import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PNG_BYTES } from "./fake-storage";

// Time off needs proof (owner decision 2026-11-24): every request carries a screenshot of the client's approval. The lead and HR can open it;
// nobody else can; the file is deleted 90 days after the request was decided.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const actions = await import("@/modules/timeoff/request-actions");
const attendanceActions = await import("@/modules/attendance/actions");
const jobs = await import("@/modules/attendance/jobs");
const { setDocumentStorage } = await import("@/modules/documents/storage");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
const NO_ACCESS = "You do not have access to do that.";
const DAY = 86_400_000;
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const fake = new FakeStorage();

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
/** A Monday at least 3 weeks away (a working day; the type used does not track a balance). */
function futureMonday(weeks: number): string {
  const d = new Date(Date.now() + weeks * 7 * DAY);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
async function upload(forEmployeeId?: string) {
  const ticket = await actions.requestLeaveEvidenceUpload({ mime: "image/png", size: PNG_BYTES.length, employeeId: forEmployeeId });
  if (!ticket.ok) throw new Error(ticket.error);
  fake.put("employee-docs", ticket.data.path, PNG_BYTES);
  return ticket.data;
}
const unpaid = async () => (await rows<{ id: string }>(sql`select id from time.leave_types where slug = 'unpaid_day'`))[0].id;

let hr: TestUser;
let lead: { user: TestUser; employeeId: string };
let va: { user: TestUser; employeeId: string };
let stranger: { user: TestUser; employeeId: string };
let typeId: string;

beforeAll(async () => {
  setDocumentStorage(fake);
  hr = await makeUser("tohr", ["hr_admin"]);
  lead = await person("toLead", { roles: ["team_lead", "employee"] });
  va = await person("toVa", { managerId: lead.employeeId });
  stranger = await person("toStranger");
  typeId = await unpaid();
});

const ask = (day: string, extra: Record<string, unknown> = {}) => actions.requestLeave({ leaveTypeId: typeId, startDate: day, endDate: day, ...extra });

describe("a time off request needs a screenshot of the client's approval", () => {
  it("is refused without one", async () => {
    as(va.user);
    const r = await ask(futureMonday(3));
    expect(r).toEqual({ ok: false, error: "Attach a screenshot of your client's approval." });
    expect((await ask(futureMonday(3), { evidenceIds: [] })).ok).toBe(false);
  });

  it("is accepted with one, which is then attached to the request", async () => {
    as(va.user);
    const shot = await upload();
    const r = await ask(futureMonday(4), { evidenceIds: [shot.id] });
    expect(r.ok).toBe(true);
    const [ev] = await rows<{ leave_request_id: string | null }>(sql`select leave_request_id from time.correction_evidence where id = ${shot.id}`);
    expect(ev.leave_request_id).toBe(r.ok ? r.data.id : null);
  });

  it("refuses a screenshot that belongs to someone else", async () => {
    as(stranger.user);
    const theirs = await upload();
    as(va.user);
    expect((await ask(futureMonday(5), { evidenceIds: [theirs.id] })).ok).toBe(false);
  });

  it("refuses a screenshot that was already used for another request", async () => {
    as(va.user);
    const shot = await upload();
    expect((await ask(futureMonday(6), { evidenceIds: [shot.id] })).ok).toBe(true);
    expect((await ask(futureMonday(7), { evidenceIds: [shot.id] })).ok).toBe(false);
  });

  it("is needed when HR files a request for someone, uploaded for that person", async () => {
    as(hr);
    expect((await ask(futureMonday(8), { employeeId: va.employeeId })).ok).toBe(false);
    const shot = await upload(va.employeeId);
    expect((await ask(futureMonday(8), { employeeId: va.employeeId, evidenceIds: [shot.id] })).ok).toBe(true);
  });

  it("refuses an upload ticket for someone else when you are not allowed to file for them", async () => {
    as(stranger.user);
    expect(await actions.requestLeaveEvidenceUpload({ mime: "image/png", size: 100, employeeId: va.employeeId })).toEqual({ ok: false, error: NO_ACCESS });
  });
});

describe("who can open the screenshot", () => {
  it("the person, their lead and HR can; someone else cannot", async () => {
    as(va.user);
    const shot = await upload();
    expect((await ask(futureMonday(9), { evidenceIds: [shot.id] })).ok).toBe(true);
    for (const who of [va.user, lead.user, hr]) {
      as(who);
      const link = await attendanceActions.openEvidence({ evidenceId: shot.id });
      expect(link.ok, who.email).toBe(true);
    }
    as(stranger.user);
    expect(await attendanceActions.openEvidence({ evidenceId: shot.id })).toEqual({ ok: false, error: NO_ACCESS });
  });
});

describe("keeping the screenshot", () => {
  it("is deleted 90 days after the request was decided, and kept before that", async () => {
    as(va.user);
    const shot = await upload();
    const made = await ask(futureMonday(10), { evidenceIds: [shot.id] });
    const id = made.ok ? made.data.id : "";
    await db.execute(sql`update time.leave_requests set status = 'approved', updated_at = now() - interval '30 days' where id = ${id}`);
    await jobs.purgeEvidence();
    expect((await rows<{ purged_at: Date | null }>(sql`select purged_at from time.correction_evidence where id = ${shot.id}`))[0].purged_at).toBeNull();
    await db.execute(sql`update time.leave_requests set updated_at = now() - interval '91 days' where id = ${id}`);
    await jobs.purgeEvidence();
    expect((await rows<{ purged_at: Date | null }>(sql`select purged_at from time.correction_evidence where id = ${shot.id}`))[0].purged_at).not.toBeNull();
  });

  it("is never deleted while the request is still waiting", async () => {
    as(va.user);
    const shot = await upload();
    const made = await ask(futureMonday(11), { evidenceIds: [shot.id] });
    const id = made.ok ? made.data.id : "";
    await db.execute(sql`update time.leave_requests set updated_at = now() - interval '200 days' where id = ${id}`);
    await jobs.purgeEvidence();
    expect((await rows<{ purged_at: Date | null }>(sql`select purged_at from time.correction_evidence where id = ${shot.id}`))[0].purged_at).toBeNull();
  });
});

describe("showing the screenshot with the request", () => {
  it("lists it for the person and for the lead who decides", async () => {
    const queries = await import("@/modules/timeoff/request-queries");
    as(va.user);
    const shot = await upload();
    const made = await ask(futureMonday(12), { evidenceIds: [shot.id] });
    const id = made.ok ? made.data.id : "";
    expect((await queries.listMyRequests()).find((r) => r.id === id)?.evidence).toEqual([{ id: shot.id, mime: "image/png", purged: false }]);
    as(lead.user);
    const queue = await queries.listApprovalQueue();
    expect(queue.items.find((r) => r.id === id)?.evidence).toHaveLength(1);
  });
});
