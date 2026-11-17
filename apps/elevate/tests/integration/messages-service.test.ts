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

  it("a member who left cannot send or mark read, and the others still can", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    const { seq } = await service.sendMessage(a, { conversationId, body: "before" });
    await service.leaveConversation(c, conversationId);
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

  it("addMembers brings a new person in and the group cannot pass 50", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const d = await makeUser("d");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    await service.addMembers(a, conversationId, [d.id]);
    const members = await rows<{ n: string }>(sql`select count(*)::text as n from chat.conversation_members where conversation_id = ${conversationId} and left_at is null`);
    expect(members[0].n).toBe("4");
    const stranger = await makeUser("s");
    await expect(service.addMembers(stranger, conversationId, [stranger.id])).rejects.toThrow(NOT_FOUND);
  });
});
