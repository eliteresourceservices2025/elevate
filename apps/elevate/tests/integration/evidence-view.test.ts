import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PNG_BYTES } from "./fake-storage";

// A screenshot shown inside the page (owner request 2026-11-25): our own signed-in route, same access rules as the download link, audited once per
// full-size open (not per thumbnail), never cached, never a storage link.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const leaveActions = await import("@/modules/timeoff/request-actions");
const route = await import("@/app/api/attendance/evidence/[evidenceId]/route");
const { setDocumentStorage } = await import("@/modules/documents/storage");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
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
function futureMonday(weeks: number): string {
  const d = new Date(Date.now() + weeks * 7 * DAY);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

const get = (id: string, query = "") => route.GET(new Request(`http://localhost/api/attendance/evidence/${id}${query}`), { params: Promise.resolve({ evidenceId: id }) });
const views = async (evidenceId: string) => (await rows(sql`select 1 from ops.audit_log where action = 'clock.evidence_view' and metadata->>'evidenceId' = ${evidenceId}`)).length;

let hr: TestUser;
let lead: { user: TestUser; employeeId: string };
let va: { user: TestUser; employeeId: string };
let stranger: { user: TestUser; employeeId: string };
let evidenceId: string;

beforeAll(async () => {
  setDocumentStorage(fake);
  hr = await makeUser("evHr", ["hr_admin"]);
  lead = await person("evLead", { roles: ["team_lead", "employee"] });
  va = await person("evVa", { managerId: lead.employeeId });
  stranger = await person("evStranger");
  as(va.user);
  const ticket = await leaveActions.requestLeaveEvidenceUpload({ mime: "image/png", size: PNG_BYTES.length });
  if (!ticket.ok) throw new Error(ticket.error);
  fake.put("employee-docs", ticket.data.path, PNG_BYTES);
  const [type] = await rows<{ id: string }>(sql`select id from time.leave_types where slug = 'unpaid_day'`);
  const made = await leaveActions.requestLeave({ leaveTypeId: type.id, startDate: futureMonday(3), endDate: futureMonday(3), evidenceIds: [ticket.data.id] });
  if (!made.ok) throw new Error(made.error);
  evidenceId = ticket.data.id;
});

describe("the screenshot route", () => {
  it("shows the picture inside the page: right type, inline, never cached, locked down", async () => {
    as(va.user);
    const res = await get(evidenceId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-disposition")).toBe("inline");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("lets the person, their lead and HR see it, and nobody else", async () => {
    for (const who of [va.user, lead.user, hr]) {
      as(who);
      expect((await get(evidenceId)).status, who.email).toBe(200);
    }
    as(stranger.user);
    expect((await get(evidenceId)).status).toBe(404);
  });

  it("is not found for a bad id, a missing file or a screenshot that was deleted", async () => {
    as(hr);
    expect((await get("not-an-id")).status).toBe(404);
    expect((await get(randomUUID())).status).toBe(404);
    const [purged] = await rows<{ id: string }>(sql`select id from time.correction_evidence where id = ${evidenceId}`);
    await db.execute(sql`update time.correction_evidence set purged_at = now() where id = ${purged.id}`);
    expect((await get(evidenceId)).status).toBe(404);
    await db.execute(sql`update time.correction_evidence set purged_at = null where id = ${purged.id}`);
  });

  it("is audited once for each full-size open, not for thumbnails", async () => {
    as(lead.user);
    const before = await views(evidenceId);
    await get(evidenceId); // a thumbnail
    await get(evidenceId, "?thumb=1");
    expect(await views(evidenceId)).toBe(before);
    expect((await get(evidenceId, "?view=1")).status).toBe(200);
    expect(await views(evidenceId)).toBe(before + 1);
  });

  it("refuses a file whose bytes are not a picture", async () => {
    as(hr);
    const [row] = await rows<{ storage_path: string }>(sql`select storage_path from time.correction_evidence where id = ${evidenceId}`);
    const original = fake.objects.get(`employee-docs/${row.storage_path}`)!;
    fake.objects.set(`employee-docs/${row.storage_path}`, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    expect((await get(evidenceId)).status).toBe(415);
    fake.objects.set(`employee-docs/${row.storage_path}`, original);
  });
});
