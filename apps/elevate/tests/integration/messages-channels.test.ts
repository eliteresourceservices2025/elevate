import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Real-database tests for the automatic team, department and company channels (Phase 2b).

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.82" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const service = await import("@/modules/messages/service");
const queries = await import("@/modules/messages/queries");
const channels = await import("@/modules/messages/channels");

type Actor = { id: string; email: string; roles: string[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: Actor) => {
  current.user = u;
};

async function makeAdmin(): Promise<Actor> {
  const id = randomUUID();
  const email = `${uniq("adm")}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, 'employee'), (${id}, 'hr_admin')`);
  // HR people are employees too, so they are in the company channel like everyone else.
  await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, start_date) values ('Hr', 'Person', ${email}, 'active', ${id}, '2026-01-05')`);
  return { id, email, roles: ["employee", "hr_admin"] };
}
async function makeDepartment(name: string) {
  const [d] = await rows<{ id: string }>(sql`insert into core.departments (name) values (${`${name} ${uniq("d")}`}) returning id`);
  return d.id;
}
async function makeTeam(departmentId: string, name: string) {
  const [t] = await rows<{ id: string }>(sql`insert into core.teams (department_id, name) values (${departmentId}, ${`${name} ${uniq("t")}`}) returning id`);
  return t.id;
}
async function makeEmployee(label: string, teamId: string | null, status = "active"): Promise<Actor> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, team_id, start_date) values (${label}, 'Tester', ${email}, ${status}, ${id}, ${teamId}, '2026-01-05')`);
  return { id, email, roles: ["employee"] };
}
const memberIds = async (conversationId: string) => (await rows<{ user_id: string }>(sql`select user_id from chat.conversation_members where conversation_id = ${conversationId} and left_at is null`)).map((r) => r.user_id);
const channelOf = async (column: "team_id" | "department_id", id: string) => (await rows<{ id: string; posting: string; archived_at: string | null }>(sql`select id, posting, archived_at from chat.conversations where ${sql.raw(column)} = ${id}`))[0];
const companyChannel = async () => (await rows<{ id: string; posting: string }>(sql`select id, posting from chat.conversations where kind = 'company' and archived_at is null`))[0];

describe("syncChannels", () => {
  it("creates a channel per team and department and one company channel, with the right people, and is idempotent", async () => {
    await makeAdmin();
    const dept = await makeDepartment("Support");
    const t1 = await makeTeam(dept, "Alpha");
    const t2 = await makeTeam(dept, "Bravo");
    const a1 = await makeEmployee("a1", t1);
    const a2 = await makeEmployee("a2", t1);
    const b1 = await makeEmployee("b1", t2);
    const loner = await makeEmployee("loner", null);
    const gone = await makeEmployee("gone", t1, "separated");

    const first = await channels.syncChannels();
    expect(first.created).toBeGreaterThanOrEqual(3);
    const c1 = await channelOf("team_id", t1);
    const c2 = await channelOf("team_id", t2);
    const cd = await channelOf("department_id", dept);
    expect((await memberIds(c1.id)).sort()).toEqual([a1.id, a2.id].sort());
    expect(await memberIds(c2.id)).toEqual([b1.id]);
    expect((await memberIds(cd.id)).sort()).toEqual([a1.id, a2.id, b1.id].sort());
    const company = await companyChannel();
    const everyone = await memberIds(company.id);
    expect(everyone).toEqual(expect.arrayContaining([a1.id, a2.id, b1.id, loner.id]));
    expect(everyone).not.toContain(gone.id);
    expect(company.posting).toBe("admins");
    expect(c1.posting).toBe("everyone");

    const second = await channels.syncChannels();
    expect(second).toMatchObject({ created: 0, membersAdded: 0, membersRemoved: 0 });
  });

  it("follows people: a move between teams, a person who left, and an archived team", async () => {
    await makeAdmin();
    const dept = await makeDepartment("Ops");
    const t1 = await makeTeam(dept, "North");
    const t2 = await makeTeam(dept, "South");
    const mover = await makeEmployee("mover", t1);
    await makeEmployee("stay", t1);
    await channels.syncChannels();
    const north = await channelOf("team_id", t1);
    const south = await channelOf("team_id", t2);
    expect(await memberIds(north.id)).toContain(mover.id);

    await db.execute(sql`update core.employees set team_id = ${t2} where user_id = ${mover.id}`);
    await channels.syncChannels();
    expect(await memberIds(north.id)).not.toContain(mover.id);
    expect(await memberIds(south.id)).toContain(mover.id);

    await db.execute(sql`update core.employees set status = 'separated' where user_id = ${mover.id}`);
    await channels.syncChannels();
    expect(await memberIds(south.id)).not.toContain(mover.id);
    expect(await memberIds((await companyChannel()).id)).not.toContain(mover.id);

    await db.execute(sql`update core.teams set archived_at = now() where id = ${t1}`);
    await channels.syncChannels();
    expect((await channelOf("team_id", t1)).archived_at).not.toBeNull();
  });

  it("syncEmployeeChannels brings one person's channels up to date", async () => {
    await makeAdmin();
    const dept = await makeDepartment("Sales");
    const t1 = await makeTeam(dept, "East");
    const person = await makeEmployee("one", t1);
    await channels.syncEmployeeChannels(person.id);
    const east = await channelOf("team_id", t1);
    expect(await memberIds(east.id)).toContain(person.id);
    expect(await memberIds((await companyChannel()).id)).toContain(person.id);
    await db.execute(sql`update core.employees set team_id = null where user_id = ${person.id}`);
    await channels.syncEmployeeChannels(person.id);
    expect(await memberIds(east.id)).not.toContain(person.id);
  });
});

describe("channels are system-managed", () => {
  it("nobody can rename, delete or change the people of a channel through the group functions", async () => {
    const admin = await makeAdmin();
    const dept = await makeDepartment("Care");
    const t1 = await makeTeam(dept, "Care team");
    const member = await makeEmployee("m", t1);
    const other = await makeEmployee("o", null);
    await channels.syncChannels();
    const ch = await channelOf("team_id", t1);
    await expect(service.renameGroup(admin, { conversationId: ch.id, title: "Mine now" })).rejects.toThrow("Group not found.");
    await expect(service.deleteGroup(admin, ch.id)).rejects.toThrow("Group not found.");
    await expect(service.addMembers(admin, ch.id, [other.id])).rejects.toThrow("Group not found.");
    await expect(service.removeMember(admin, { conversationId: ch.id, userId: member.id })).rejects.toThrow("Group not found.");
  });

  it("only HR may post a root message in the company channel; replies and reactions stay open to everyone", async () => {
    const admin = await makeAdmin();
    const worker = await makeEmployee("w", null);
    await channels.syncChannels();
    const company = await companyChannel();
    await expect(service.sendMessage(worker, { conversationId: company.id, body: "hello all", canManage: false })).rejects.toThrow("Only HR can post in this channel.");
    const post = await service.sendMessage(admin, { conversationId: company.id, body: "Holiday schedule is out", canManage: true });
    await expect(service.sendMessage(worker, { conversationId: company.id, body: "thanks!", threadRootId: post.id, canManage: false })).resolves.toBeDefined();
    await expect(service.toggleReaction(worker, { messageId: post.id, emoji: "👍" })).resolves.toEqual({ active: true });
    as(worker);
    const list = await queries.listMyConversations();
    const row = list.find((c) => c.id === company.id)!;
    expect(row).toMatchObject({ kind: "company", posting: "admins" });
    expect(row.title).toBe("Everyone at ERS");
  });
});
