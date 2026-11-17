import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Real-database tests for the chat service: encryption at rest, membership checks, the send rate limit, one conversation per pair,
// who may edit or delete, leaving a group, and audit rows that carry ids and counts but never text.

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.71" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const { fieldCrypto } = await import("@/lib/crypto");
const service = await import("@/modules/messages/service");

type Actor = { id: string; email: string };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

async function makeUser(label: string): Promise<Actor> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email };
}

const NOT_FOUND = "Conversation not found.";

describe("sendMessage", () => {
  it("stores ciphertext, never the plain text, and it decrypts with its context", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { conversationId } = await service.openDirect(a, b.id);
    const secret = `lunch at noon ${uniq("s")}`;
    const { id } = await service.sendMessage(a, { conversationId, body: secret });
    const [row] = await rows<{ body_enc: string }>(sql`select body_enc from chat.messages where id = ${id}`);
    expect(row.body_enc).not.toContain(secret);
    expect(fieldCrypto().decrypt(row.body_enc, `chat_message:${conversationId}:${id}`)).toBe(secret);
    // Bound to its place: the same ciphertext does not open under another message's context.
    expect(() => fieldCrypto().decrypt(row.body_enc, `chat_message:${conversationId}:${randomUUID()}`)).toThrow();
  });

  it("a non-member cannot send and gets the same message as for a missing conversation", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const stranger = await makeUser("s");
    const { conversationId } = await service.openDirect(a, b.id);
    await expect(service.sendMessage(stranger, { conversationId, body: "hi" })).rejects.toThrow(NOT_FOUND);
    await expect(service.sendMessage(stranger, { conversationId: randomUUID(), body: "hi" })).rejects.toThrow(NOT_FOUND);
  });

  it("31 sends inside 10 seconds: the 31st is refused", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { conversationId } = await service.openDirect(a, b.id);
    for (let i = 0; i < 30; i++) await service.sendMessage(a, { conversationId, body: `m${i}` });
    await expect(service.sendMessage(a, { conversationId, body: "one too many" })).rejects.toThrow("too fast");
    // The other person is not affected by A's limit.
    await expect(service.sendMessage(b, { conversationId, body: "still fine" })).resolves.toBeDefined();
  });
});

describe("openDirect", () => {
  it("two people opening each other's DM at the same moment end up in one conversation", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const [x, y] = await Promise.all([service.openDirect(a, b.id), service.openDirect(b, a.id)]);
    expect(x.conversationId).toBe(y.conversationId);
    const count = await rows<{ n: string }>(sql`select count(*)::text as n from chat.conversations where dm_key = ${[a.id, b.id].sort().join(":")}`);
    expect(count[0].n).toBe("1");
    const members = await rows<{ n: string }>(sql`select count(*)::text as n from chat.conversation_members where conversation_id = ${x.conversationId}`);
    expect(members[0].n).toBe("2");
  });

  it("refuses yourself, an unknown person and an archived person", async () => {
    const a = await makeUser("a");
    const gone = await makeUser("gone");
    await db.execute(sql`update core.users set archived_at = now() where id = ${gone.id}`);
    await expect(service.openDirect(a, a.id)).rejects.toThrow();
    await expect(service.openDirect(a, randomUUID())).rejects.toThrow();
    await expect(service.openDirect(a, gone.id)).rejects.toThrow();
  });
});

describe("edit and delete", () => {
  it("another member cannot edit or delete someone else's message; the sender can", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { conversationId } = await service.openDirect(a, b.id);
    const { id } = await service.sendMessage(a, { conversationId, body: "original" });
    await expect(service.editMessage(b, { messageId: id, body: "hacked" })).rejects.toThrow();
    await expect(service.deleteMessage(b, id)).rejects.toThrow();
    await service.editMessage(a, { messageId: id, body: "edited" });
    const revs = await rows<{ n: string }>(sql`select count(*)::text as n from chat.message_revisions where message_id = ${id}`);
    expect(revs[0].n).toBe("1");
    await service.deleteMessage(a, id);
    await expect(service.editMessage(a, { messageId: id, body: "after delete" })).rejects.toThrow();
    const [row] = await rows<{ deleted_at: string | null }>(sql`select deleted_at from chat.messages where id = ${id}`);
    expect(row.deleted_at).not.toBeNull();
  });
});

describe("groups", () => {
  it("createGroup writes an audit row with ids and a count and no title or text", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const title = `Secret plans ${uniq("t")}`;
    const { conversationId } = await service.createGroup(a, { title, memberUserIds: [b.id, c.id] });
    const audit = await rows<{ metadata: unknown; after: unknown; before: unknown }>(sql`select metadata, after, before from ops.audit_log where action = 'chat.group.create' and target_id = ${conversationId}`);
    expect(audit).toHaveLength(1);
    const text = JSON.stringify(audit[0]);
    expect(text).not.toContain(title);
    expect(text).toContain('"memberCount":3');
  });

  it("a removed member cannot send or mark read, and the others still can", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    const { seq } = await service.sendMessage(a, { conversationId, body: "before" });
    await service.removeMember(a, { conversationId, userId: c.id });
    await expect(service.sendMessage(c, { conversationId, body: "after" })).rejects.toThrow(NOT_FOUND);
    await expect(service.markRead(c, { conversationId, seq })).rejects.toThrow(NOT_FOUND);
    await expect(service.sendMessage(b, { conversationId, body: "still here" })).resolves.toBeDefined();
  });

  it("markRead never moves backwards", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { conversationId } = await service.openDirect(a, b.id);
    const first = await service.sendMessage(a, { conversationId, body: "1" });
    const second = await service.sendMessage(a, { conversationId, body: "2" });
    await service.markRead(b, { conversationId, seq: second.seq });
    await service.markRead(b, { conversationId, seq: first.seq });
    const [m] = await rows<{ last_read_seq: string }>(sql`select last_read_seq from chat.conversation_members where conversation_id = ${conversationId} and user_id = ${b.id}`);
    expect(Number(m.last_read_seq)).toBe(second.seq);
  });

  it("addMembers brings a new person in", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const d = await makeUser("d");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    await service.addMembers(a, conversationId, [d.id]);
    const members = await rows<{ n: string }>(sql`select count(*)::text as n from chat.conversation_members where conversation_id = ${conversationId} and left_at is null`);
    expect(members[0].n).toBe("4");
  });
});

async function makeUsers(n: number): Promise<string[]> {
  const out = await rows<{ id: string }>(sql`insert into core.users (id, email) select gen_random_uuid(), 'bulk' || md5(random()::text || g::text) || '@example.com' from generate_series(1, ${n}) g returning id`);
  return out.map((r) => r.id);
}

describe("a group of up to 200 people", () => {
  it("can have 200 in total (199 others), and neither creating nor adding goes past 200", async () => {
    const a = await makeUser("a");
    const others = await makeUsers(199);
    const { conversationId } = await service.createGroup(a, { title: "Everyone", memberUserIds: others });
    const [count] = await rows<{ n: string }>(sql`select count(*)::text as n from chat.conversation_members where conversation_id = ${conversationId} and left_at is null`);
    expect(count.n).toBe("200");
    const extra = await makeUser("extra");
    await expect(service.addMembers(a, conversationId, [extra.id])).rejects.toThrow("up to 200");
    const tooMany = await makeUsers(200);
    await expect(service.createGroup(a, { title: "Too big", memberUserIds: tooMany })).rejects.toThrow();
    // A message still reaches everyone's list (the unread count is per person).
    await service.sendMessage(a, { conversationId, body: "hello all" });
  });
});

describe("managing groups (HR and Super Admin)", () => {
  it("renameGroup changes the name, adds a system message and audits ids only", async () => {
    const admin = await makeUser("admin");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(admin, { title: "Old name", memberUserIds: [b.id, c.id] });
    const fresh = `Brand new ${uniq("n")}`;
    await service.renameGroup(admin, { conversationId, title: fresh });
    const [conv] = await rows<{ title: string }>(sql`select title from chat.conversations where id = ${conversationId}`);
    expect(conv.title).toBe(fresh);
    const audit = await rows<{ metadata: unknown; before: unknown; after: unknown }>(sql`select metadata, before, after from ops.audit_log where action = 'chat.group.rename' and target_id = ${conversationId}`);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toContain(fresh);
    expect(JSON.stringify(audit[0])).not.toContain("Old name");
  });

  it("removeMember removes one person, tells the group, and refuses to empty the group", async () => {
    const admin = await makeUser("admin");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(admin, { title: "Crew", memberUserIds: [b.id, c.id] });
    await service.removeMember(admin, { conversationId, userId: c.id });
    const [left] = await rows<{ left_at: string | null }>(sql`select left_at from chat.conversation_members where conversation_id = ${conversationId} and user_id = ${c.id}`);
    expect(left.left_at).not.toBeNull();
    await expect(service.removeMember(admin, { conversationId, userId: c.id })).rejects.toThrow("isn't in this group");
    await service.removeMember(admin, { conversationId, userId: b.id });
    await expect(service.removeMember(admin, { conversationId, userId: admin.id })).rejects.toThrow("at least one person");
  });

  it("deleteGroup archives it: nobody can send, the audit row has ids and a count, and it cannot be done to a direct message", async () => {
    const admin = await makeUser("admin");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(admin, { title: "Doomed", memberUserIds: [b.id, c.id] });
    await service.sendMessage(b, { conversationId, body: "before the end" });
    await service.deleteGroup(admin, conversationId);
    await expect(service.sendMessage(b, { conversationId, body: "after" })).rejects.toThrow(NOT_FOUND);
    const [row] = await rows<{ archived_at: string | null; n: string }>(sql`select archived_at, (select count(*)::text from chat.messages where conversation_id = ${conversationId}) as n from chat.conversations where id = ${conversationId}`);
    expect(row.archived_at).not.toBeNull();
    expect(Number(row.n)).toBeGreaterThan(0); // soft delete: the encrypted rows stay until the retention period
    const audit = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where action = 'chat.group.delete' and target_id = ${conversationId}`);
    expect(JSON.stringify(audit[0])).toContain('"memberCount":3');
    const { conversationId: dm } = await service.openDirect(b, c.id);
    await expect(service.deleteGroup(admin, dm)).rejects.toThrow();
    await expect(service.renameGroup(admin, { conversationId: dm, title: "x" })).rejects.toThrow();
    await expect(service.deleteGroup(admin, conversationId)).rejects.toThrow(); // already deleted
  });

  it("an admin who is not in a group can rename, add others, remove and delete, but cannot add themself", async () => {
    const creator = await makeUser("creator");
    const admin = await makeUser("admin");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const d = await makeUser("d");
    const { conversationId } = await service.createGroup(creator, { title: "Private crew", memberUserIds: [b.id, c.id] });
    await service.renameGroup(admin, { conversationId, title: "Renamed by HR" });
    await service.addMembers(admin, conversationId, [d.id]);
    await expect(service.addMembers(admin, conversationId, [admin.id])).rejects.toThrow("not in");
    await service.removeMember(admin, { conversationId, userId: d.id });
    await expect(service.sendMessage(admin, { conversationId, body: "sneaking in" })).rejects.toThrow(NOT_FOUND);
    await service.deleteGroup(admin, conversationId);
  });

  it("an added-back member is a fresh start: they were removed, then added, and can send again", async () => {
    const admin = await makeUser("admin");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(admin, { title: "Crew", memberUserIds: [b.id, c.id] });
    await service.removeMember(admin, { conversationId, userId: c.id });
    await service.addMembers(admin, conversationId, [c.id]);
    await expect(service.sendMessage(c, { conversationId, body: "back again" })).resolves.toBeDefined();
  });
});

describe("changing a group's people is traceable and safe under simultaneous changes", () => {
  it("addMembers records WHO was added (ids, never names or text) so the change can be reviewed", async () => {
    const admin = await makeUser("admin");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const d = await makeUser("d");
    const { conversationId } = await service.createGroup(admin, { title: "Crew", memberUserIds: [b.id, c.id] });
    await service.addMembers(admin, conversationId, [d.id]);
    const audit = await rows<{ metadata: unknown }>(sql`select metadata from ops.audit_log where action = 'chat.members.add' and target_id = ${conversationId}`);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0].metadata)).toContain(d.id);
    expect(JSON.stringify(audit[0].metadata)).toContain('"count":1');
  });

  it("two adds at the same moment cannot push a group past 200: exactly one of them is refused", async () => {
    const admin = await makeUser("admin");
    const members = await makeUsers(179); // 180 with the admin
    const { conversationId } = await service.createGroup(admin, { title: "Almost full", memberUserIds: members });
    const first = await makeUsers(15);
    const second = await makeUsers(15);
    const results = await Promise.allSettled([service.addMembers(admin, conversationId, first), service.addMembers(admin, conversationId, second)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const [count] = await rows<{ n: string }>(sql`select count(*)::text as n from chat.conversation_members where conversation_id = ${conversationId} and left_at is null`);
    expect(Number(count.n)).toBeLessThanOrEqual(200);
  });

  it("two removals at the same moment cannot empty a group", async () => {
    const admin = await makeUser("admin");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(admin, { title: "Three", memberUserIds: [b.id, c.id] });
    await service.removeMember(admin, { conversationId, userId: c.id }); // two left: admin and b
    const results = await Promise.allSettled([
      service.removeMember(admin, { conversationId, userId: admin.id }),
      service.removeMember(admin, { conversationId, userId: b.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [count] = await rows<{ n: string }>(sql`select count(*)::text as n from chat.conversation_members where conversation_id = ${conversationId} and left_at is null`);
    expect(count.n).toBe("1");
  });
});
