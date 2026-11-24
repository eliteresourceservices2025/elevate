import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { RoleSlug } from "@/lib/roles";
import { FakeStorage, PDF_BYTES } from "./fake-storage";

// Company documents for chosen groups (owner decision 2026-11-24): a file such as the handbook can be restricted to teams, clients, roles or
// named people (any mix; a person who matches any one of them can read it). HR and Super Admin always can.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.10" }) }));

const { db } = await import("@/lib/db");
const docs = await import("@/modules/documents/actions");
const docQueries = await import("@/modules/documents/queries");
const { authorizeDocumentView } = await import("@/modules/documents/service");
const { setDocumentStorage } = await import("@/modules/documents/storage");

type TestUser = { id: string; email: string; roles: RoleSlug[] };
type Member = { kind: "team" | "client" | "role" | "person"; id: string };
const fake = new FakeStorage();
const NO_ACCESS = "You do not have access to do that.";
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: TestUser) => {
  current.user = u;
};
const typeId = async (slug: string) => (await rows<{ id: string }>(sql`select id from docs.document_types where slug = ${slug}`))[0].id;

async function makeUser(label: string, roles: RoleSlug[]): Promise<TestUser> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  for (const r of roles) await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${r})`);
  return { id, email, roles };
}
async function person(label: string, roles: RoleSlug[] = ["employee"], o: { teamId?: string; clientId?: string } = {}) {
  const user = await makeUser(label, roles);
  const [e] = await rows<{ id: string }>(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, team_id) values (${label}, ${uniq(label)}, ${user.email}, 'active', ${user.id}, ${o.teamId ?? null}) returning id`);
  if (o.clientId) await db.execute(sql`insert into core.client_assignments (employee_id, client_id, start_date) values (${e.id}, ${o.clientId}, current_date - 30)`);
  return { user, employeeId: e.id };
}
const newTeam = async () => {
  const [d] = await rows<{ id: string }>(sql`insert into core.departments (name) values (${uniq("Dept ")}) returning id`);
  return (await rows<{ id: string }>(sql`insert into core.teams (name, department_id) values (${uniq("Team ")}, ${d.id}) returning id`))[0].id;
};
const newClient = async () => (await rows<{ id: string }>(sql`insert into core.clients (name) values (${uniq("Client ")}) returning id`))[0].id;

/** The real three steps: ask, upload (fake), finalize. Returns the document id. */
async function uploadCompany(actor: TestUser, audience: "all_staff" | "hr_only" | "restricted", audienceMembers: Member[] = []) {
  as(actor);
  const ticket = await docs.requestUpload({
    target: "company",
    typeId: await typeId("company_policy"),
    title: uniq("Handbook "),
    audience,
    audienceMembers,
    fileName: "handbook.pdf",
    mimeType: "application/pdf",
    sizeBytes: PDF_BYTES.length,
    acknowledged: true,
  });
  if (!ticket.ok) return { ticket, id: null as string | null };
  fake.put(ticket.data.bucket, ticket.data.path, PDF_BYTES);
  const fin = await docs.finalizeUpload({ documentId: ticket.data.documentId });
  if (!fin.ok) throw new Error(fin.error);
  return { ticket, id: ticket.data.documentId };
}
const seesInList = async (who: TestUser, id: string) => {
  as(who);
  return (await docQueries.listCompanyDocuments()).some((d) => d.id === id);
};
const canOpen = async (who: TestUser, id: string) => {
  try {
    await authorizeDocumentView(who, id);
    return true;
  } catch {
    return false;
  }
};

let hr: TestUser;
let superAdmin: TestUser;
let teamA: string;
let teamB: string;
let clientX: string;
let inTeamA: Awaited<ReturnType<typeof person>>;
let inTeamB: Awaited<ReturnType<typeof person>>;
let onClientX: Awaited<ReturnType<typeof person>>;
let nobody: Awaited<ReturnType<typeof person>>;
let leadUser: Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  setDocumentStorage(fake);
  hr = await makeUser("daHr", ["hr_admin"]);
  superAdmin = await makeUser("daSuper", ["super_admin"]);
  teamA = await newTeam();
  teamB = await newTeam();
  clientX = await newClient();
  inTeamA = await person("daTeamA", ["employee"], { teamId: teamA });
  inTeamB = await person("daTeamB", ["employee"], { teamId: teamB });
  onClientX = await person("daClient", ["employee"], { clientId: clientX });
  nobody = await person("daNobody");
  leadUser = await person("daLead", ["employee", "team_lead"]);
});

describe("a company file for selected groups", () => {
  it("is read by the people in a chosen team and nobody else", async () => {
    const { id } = await uploadCompany(hr, "restricted", [{ kind: "team", id: teamA }]);
    expect(id).not.toBeNull();
    expect(await seesInList(inTeamA.user, id!)).toBe(true);
    expect(await canOpen(inTeamA.user, id!)).toBe(true);
    for (const other of [inTeamB, onClientX, nobody, leadUser]) {
      expect(await seesInList(other.user, id!)).toBe(false);
      expect(await canOpen(other.user, id!)).toBe(false);
    }
  });

  it("can be for the people assigned to a client", async () => {
    const { id } = await uploadCompany(hr, "restricted", [{ kind: "client", id: clientX }]);
    expect(await canOpen(onClientX.user, id!)).toBe(true);
    expect(await canOpen(inTeamA.user, id!)).toBe(false);
    // Someone whose assignment to the client has ended no longer reads it.
    await db.execute(sql`update core.client_assignments set end_date = current_date - 1 where employee_id = ${onClientX.employeeId} and client_id = ${clientX}`);
    expect(await canOpen(onClientX.user, id!)).toBe(false);
  });

  it("can be for a role, such as team leads", async () => {
    const { id } = await uploadCompany(hr, "restricted", [{ kind: "role", id: "team_lead" }]);
    expect(await canOpen(leadUser.user, id!)).toBe(true);
    expect(await canOpen(nobody.user, id!)).toBe(false);
  });

  it("can be for named people", async () => {
    const { id } = await uploadCompany(hr, "restricted", [{ kind: "person", id: nobody.employeeId }]);
    expect(await canOpen(nobody.user, id!)).toBe(true);
    expect(await canOpen(inTeamA.user, id!)).toBe(false);
  });

  it("is read by anyone who matches any one of the groups", async () => {
    const { id } = await uploadCompany(hr, "restricted", [
      { kind: "team", id: teamB },
      { kind: "role", id: "team_lead" },
      { kind: "person", id: nobody.employeeId },
    ]);
    for (const who of [inTeamB, leadUser, nobody]) expect(await canOpen(who.user, id!), who.user.email).toBe(true);
    expect(await canOpen(inTeamA.user, id!)).toBe(false);
  });

  it("is always readable by HR and Super Admin, who also see who it is for", async () => {
    const { id } = await uploadCompany(hr, "restricted", [{ kind: "team", id: teamA }]);
    for (const who of [hr, superAdmin]) {
      expect(await seesInList(who, id!)).toBe(true);
      expect(await canOpen(who, id!)).toBe(true);
    }
    as(hr);
    const row = (await docQueries.listCompanyDocuments()).find((d) => d.id === id)!;
    expect(row.audience).toBe("restricted");
    expect(row.audienceGroups).toEqual([expect.objectContaining({ kind: "team" })]);
    as(inTeamA.user);
    expect((await docQueries.listCompanyDocuments()).find((d) => d.id === id)!.audienceGroups).toEqual([]); // a reader does not see who else it is for
  });
});

describe("choosing the audience", () => {
  it("needs at least one group when restricted, and only HR can set it", async () => {
    expect((await uploadCompany(hr, "restricted", [])).ticket.ok).toBe(false);
    expect((await uploadCompany(hr, "all_staff", [{ kind: "team", id: teamA }])).ticket.ok).toBe(false); // groups only go with "selected groups"
    as(leadUser.user);
    const asLead = await docs.requestUpload({ target: "company", typeId: await typeId("company_policy"), title: "Handbook", audience: "restricted", audienceMembers: [{ kind: "team", id: teamA }], fileName: "a.pdf", mimeType: "application/pdf", sizeBytes: 100, acknowledged: true });
    expect(asLead).toEqual({ ok: false, error: NO_ACCESS });
  });

  it("refuses a group that does not exist or a role that is not one", async () => {
    expect((await uploadCompany(hr, "restricted", [{ kind: "team", id: randomUUID() }])).ticket.ok).toBe(false);
    expect((await uploadCompany(hr, "restricted", [{ kind: "role", id: "wizard" }])).ticket.ok).toBe(false);
    expect((await uploadCompany(hr, "restricted", [{ kind: "person", id: randomUUID() }])).ticket.ok).toBe(false);
  });

  it("can be changed later: to other groups, to all staff (groups cleared) and back", async () => {
    const { id } = await uploadCompany(hr, "restricted", [{ kind: "team", id: teamA }]);
    as(hr);
    const policy = await typeId("company_policy");
    const set = (audience: "all_staff" | "hr_only" | "restricted", audienceMembers: Member[] = []) => docs.changeDocumentType({ documentId: id!, typeId: policy, title: "Handbook", audience, audienceMembers });
    expect((await set("restricted", [{ kind: "team", id: teamB }])).ok).toBe(true);
    expect(await canOpen(inTeamB.user, id!)).toBe(true);
    expect(await canOpen(inTeamA.user, id!)).toBe(false);
    expect((await set("all_staff")).ok).toBe(true);
    expect(await canOpen(nobody.user, id!)).toBe(true);
    expect(await rows(sql`select 1 from docs.document_audience_members where document_id = ${id}`)).toHaveLength(0);
    expect((await set("hr_only")).ok).toBe(true);
    expect(await canOpen(nobody.user, id!)).toBe(false);
    expect((await set("restricted", [])).ok).toBe(false);
  });

  it("leaves all staff and HR only files as they were", async () => {
    const open = await uploadCompany(hr, "all_staff");
    const closed = await uploadCompany(hr, "hr_only");
    expect(await canOpen(nobody.user, open.id!)).toBe(true);
    expect(await canOpen(nobody.user, closed.id!)).toBe(false);
    expect(await canOpen(hr, closed.id!)).toBe(true);
  });
});

describe("the choices HR picks the groups from", () => {
  it("lists the teams, clients and people for HR, and nothing for anyone else", async () => {
    as(hr);
    const r = await docs.listAudienceOptions();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.teams.map((t) => t.id)).toContain(teamA);
      expect(r.data.clients.map((c) => c.id)).toContain(clientX);
      expect(r.data.people.map((p) => p.id)).toContain(nobody.employeeId);
    }
    as(leadUser.user);
    expect(await docs.listAudienceOptions()).toEqual({ ok: false, error: NO_ACCESS });
  });
});
