import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Real-database tests for chat reads: unread counts, tombstones for deleted messages, the latest edit winning, strangers refused,
// a person who left seeing only what came before, list previews, and the people search.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.72" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const service = await import("@/modules/messages/service");
const queries = await import("@/modules/messages/queries");

type Actor = { id: string; email: string; roles: string[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const as = (u: Actor) => {
  current.user = u;
};

async function makeUser(label: string, person?: { first: string; last: string; position?: string }, roles: string[] = ["employee"]): Promise<Actor> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  if (person) {
    await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, position, start_date)
      values (${person.first}, ${person.last}, ${email}, 'active', ${id}, ${person.position ?? null}, '2026-01-05')`);
  }
  return { id, email, roles };
}

describe("managing groups: what HR sees", () => {
  it("listManagedGroups lists every group, including ones the admin is not in, with names and counts but no message text", async () => {
    const admin = await makeUser("admin", { first: "Gina", last: "HR" }, ["employee", "hr_admin"]);
    const creator = await makeUser("creator", { first: "Cora", last: "Creator" });
    const b = await makeUser("b");
    const c = await makeUser("c");
    const title = `Secret crew ${uniq("t")}`;
    const { conversationId } = await service.createGroup(creator, { title, memberUserIds: [b.id, c.id] });
    await service.sendMessage(creator, { conversationId, body: "the secret plan" });
    as(admin);
    const groups = await queries.listManagedGroups();
    const g = groups.find((x) => x.id === conversationId)!;
    expect(g).toMatchObject({ title, memberCount: 3, amMember: false, createdByName: "Cora Creator" });
    expect(JSON.stringify(groups)).not.toContain("the secret plan");
    await expect(queries.loadMessages({ conversationId })).rejects.toThrow("Conversation not found."); // managing is not reading
  });

  it("loadGroupPeople lists the current people of a group; a deleted group and a direct message are not found", async () => {
    const admin = await makeUser("admin", undefined, ["employee", "super_admin"]);
    const b = await makeUser("b", { first: "Bea", last: "Bee" });
    const c = await makeUser("c", { first: "Cy", last: "Sea" });
    const { conversationId } = await service.createGroup(admin, { title: "Crew", memberUserIds: [b.id, c.id] });
    as(admin);
    const people = await queries.loadGroupPeople({ conversationId });
    expect(people.map((p) => p.name).sort()).toEqual(["Bea Bee", "Cy Sea", people.find((p) => p.userId === admin.id)!.name].sort());
    const { conversationId: dm } = await service.openDirect(b, c.id);
    await expect(queries.loadGroupPeople({ conversationId: dm })).rejects.toThrow();
    await service.deleteGroup(admin, conversationId);
    await expect(queries.loadGroupPeople({ conversationId })).rejects.toThrow();
  });

  it("a person without the manage right gets nothing from the manage queries", async () => {
    const worker = await makeUser("w");
    as(worker);
    await expect(queries.listManagedGroups()).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

describe("unread and previews", () => {
  it("unread counts only others' undeleted text messages after last_read_seq", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { conversationId } = await service.openDirect(a, b.id);
    const m1 = await service.sendMessage(a, { conversationId, body: "one" });
    const m2 = await service.sendMessage(a, { conversationId, body: "two" });
    await service.sendMessage(b, { conversationId, body: "mine, not unread for me" });
    await service.deleteMessage(a, m2.id);
    as(b);
    expect(await queries.countMyUnread()).toBe(1); // "one" only: "two" was deleted
    await service.markRead(b, { conversationId, seq: m1.seq });
    expect(await queries.countMyUnread()).toBe(0);
    as(a);
    expect(await queries.countMyUnread()).toBe(1); // b's message
  });

  it("the list preview skips a deleted latest message and shows the other person as the title of a DM", async () => {
    const a = await makeUser("a", { first: "Ana", last: "Cruz" });
    const b = await makeUser("b", { first: "Jose", last: "Reyes" });
    const { conversationId } = await service.openDirect(a, b.id);
    await service.sendMessage(a, { conversationId, body: "first message" });
    const last = await service.sendMessage(a, { conversationId, body: "secret last" });
    await service.deleteMessage(a, last.id);
    as(b);
    const list = await queries.listMyConversations();
    const row = list.find((c) => c.id === conversationId)!;
    expect(row.title).toBe("Ana Cruz");
    expect(row.lastPreview).toBe("first message");
    expect(row.unread).toBe(1);
    expect(row.photoUserId).toBe(a.id);
    expect(JSON.stringify(list)).not.toContain("secret last");
  });
});

describe("loadMessages", () => {
  it("a deleted message returns body null and deleted true", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { conversationId } = await service.openDirect(a, b.id);
    const m = await service.sendMessage(a, { conversationId, body: "oops" });
    await service.deleteMessage(a, m.id);
    for (const viewer of [a, b]) {
      as(viewer);
      const { messages } = await queries.loadMessages({ conversationId });
      expect(messages[0]).toMatchObject({ id: m.id, deleted: true, body: null });
    }
  });

  it("an edited message returns the latest revision's body and edited true", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { conversationId } = await service.openDirect(a, b.id);
    const m = await service.sendMessage(a, { conversationId, body: "v1" });
    await service.editMessage(a, { messageId: m.id, body: "v2" });
    await service.editMessage(a, { messageId: m.id, body: "v3" });
    as(b);
    const { messages } = await queries.loadMessages({ conversationId });
    expect(messages[0]).toMatchObject({ body: "v3", edited: true, deleted: false });
  });

  it("a stranger loading a conversation is refused with the not-found message", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const stranger = await makeUser("s");
    const { conversationId } = await service.openDirect(a, b.id);
    as(stranger);
    await expect(queries.loadMessages({ conversationId })).rejects.toThrow("Conversation not found.");
    await expect(queries.loadMessages({ conversationId: randomUUID() })).rejects.toThrow("Conversation not found.");
  });

  it("a person who was removed can no longer load the conversation at all, not even what came before", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    await service.sendMessage(a, { conversationId, body: "before the removal" });
    await service.removeMember(a, { conversationId, userId: c.id });
    as(c);
    await expect(queries.loadMessages({ conversationId })).rejects.toThrow("Conversation not found.");
    expect((await queries.listMyConversations()).some((x) => x.id === conversationId)).toBe(false);
  });

  it("nobody can load a deleted group", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(a, { title: "Doomed", memberUserIds: [b.id, c.id] });
    await service.sendMessage(a, { conversationId, body: "gone soon" });
    await service.deleteGroup(a, conversationId);
    for (const viewer of [a, b]) {
      as(viewer);
      await expect(queries.loadMessages({ conversationId })).rejects.toThrow("Conversation not found.");
      expect((await queries.listMyConversations()).some((x) => x.id === conversationId)).toBe(false);
    }
  });

  it("pages: the latest 2 first, then earlier ones with beforeSeq, and hasMore says so", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { conversationId } = await service.openDirect(a, b.id);
    for (const n of ["1", "2", "3", "4", "5"]) await service.sendMessage(a, { conversationId, body: n });
    as(b);
    const first = await queries.loadMessages({ conversationId, limit: 2 });
    expect(first.messages.map((m) => m.body)).toEqual(["4", "5"]);
    expect(first.hasMore).toBe(true);
    const older = await queries.loadMessages({ conversationId, limit: 2, beforeSeq: first.messages[0].seq });
    expect(older.messages.map((m) => m.body)).toEqual(["2", "3"]);
    const rest = await queries.loadMessages({ conversationId, limit: 5, beforeSeq: older.messages[0].seq });
    expect(rest.messages.map((m) => m.body)).toEqual(["1"]);
    expect(rest.hasMore).toBe(false);
    const after = await queries.loadMessages({ conversationId, afterSeq: first.messages[0].seq });
    expect(after.messages.map((m) => m.body)).toEqual(["5"]);
  });
});

describe("a person added later", () => {
  it("sees only messages from the moment they were added: thread, list preview and unread", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const d = await makeUser("d");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    await service.sendMessage(a, { conversationId, body: "old secret" });
    await db.execute(sql`select pg_sleep(0.05)`);
    await service.addMembers(a, conversationId, [d.id]);
    await db.execute(sql`select pg_sleep(0.05)`);
    await service.sendMessage(a, { conversationId, body: "welcome d" });

    as(d);
    const { messages } = await queries.loadMessages({ conversationId });
    const bodies = messages.map((m) => m.body);
    expect(bodies).toContain("welcome d");
    expect(bodies).not.toContain("old secret");
    expect(await queries.countMyUnread()).toBe(1);
    const row = (await queries.listMyConversations()).find((x) => x.id === conversationId)!;
    expect(row.lastPreview).toBe("welcome d");
    expect(row.unread).toBe(1);

    // The people who were already there still see everything.
    as(b);
    expect((await queries.loadMessages({ conversationId })).messages.map((m) => m.body)).toContain("old secret");
  });

  it("someone who left and was added back does not see what was said while they were away", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    await service.removeMember(a, { conversationId, userId: c.id });
    await db.execute(sql`select pg_sleep(0.05)`);
    await service.sendMessage(a, { conversationId, body: "said while c was away" });
    await db.execute(sql`select pg_sleep(0.05)`);
    await service.addMembers(a, conversationId, [c.id]);
    as(c);
    const { messages } = await queries.loadMessages({ conversationId });
    expect(messages.map((m) => m.body)).not.toContain("said while c was away");
  });
});

describe("the people list", () => {
  it("shows only current members, so a removed person is not listed and can be added back", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const d = await makeUser("d");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    await service.removeMember(a, { conversationId, userId: c.id });
    await db.execute(sql`select pg_sleep(0.05)`);
    await service.addMembers(a, conversationId, [d.id]);

    as(a);
    const current = (await queries.loadMessages({ conversationId })).members.map((m) => m.userId).sort();
    expect(current).toEqual([a.id, b.id, d.id].sort());
  });
});

describe("read position", () => {
  it("members carry their last read seq, so a DM can show Seen", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { conversationId } = await service.openDirect(a, b.id);
    const sent = await service.sendMessage(a, { conversationId, body: "ping" });
    await service.markRead(b, { conversationId, seq: sent.seq });
    as(a);
    const { members } = await queries.loadMessages({ conversationId });
    expect(members.find((m) => m.userId === b.id)?.lastReadSeq).toBe(sent.seq);
    expect(members.find((m) => m.userId === a.id)?.lastReadSeq).toBe(0);
  });
});

describe("searchChatPeople", () => {
  it("excludes the actor and archived people, and a % in the query is not a wildcard", async () => {
    const tag = uniq("zq").replace(/[^a-z0-9]/g, "");
    const a = await makeUser("a", { first: `Alma${tag}`, last: "Self" });
    await makeUser("b", { first: `Alma${tag}`, last: "Other", position: "Front desk" });
    const gone = await makeUser("g", { first: `Alma${tag}`, last: "Gone" });
    await db.execute(sql`update core.users set archived_at = now() where id = ${gone.id}`);
    as(a);
    const found = await queries.searchChatPeople({ q: `Alma${tag}` });
    expect(found.map((p) => p.name)).toEqual([`Alma${tag} Other`]);
    expect(found[0].position).toBe("Front desk");
    expect(await queries.searchChatPeople({ q: "%" })).toEqual([]);
  });
});

describe("people search size", () => {
  it("an ordinary person gets at most 20 results, an HR Admin (who builds big groups) gets them all", async () => {
    const tag = uniq("sz").replace(/[^a-z0-9]/g, "");
    await db.execute(sql`with u as (
        insert into core.users (id, email) select gen_random_uuid(), 'sz' || md5(random()::text || g::text) || '@example.com' from generate_series(1, 25) g returning id, email)
      insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, start_date)
      select ${`Zed${tag}`}, 'Person', email, 'active', id, '2026-01-05' from u`);
    const worker = await makeUser("w");
    const admin = await makeUser("adm", undefined, ["employee", "hr_admin"]);
    as(worker);
    expect(await queries.searchChatPeople({ q: `Zed${tag}` })).toHaveLength(20);
    as(admin);
    expect(await queries.searchChatPeople({ q: `Zed${tag}` })).toHaveLength(25);
  });
});
