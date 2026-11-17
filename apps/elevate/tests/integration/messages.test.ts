import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

// Real-database tests for the chat schema: the guards (messages are insert-only apart from one deleted_at stamp, revisions never change),
// the one-conversation-per-pair key, and chat.can_join (who may subscribe to which Realtime channel).

const { db } = await import("@/lib/db");

let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

async function makeUser(label: string) {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${`${uniq(label)}@example.com`})`);
  return id;
}

async function makeConversation(createdBy: string, members: { userId: string; left?: boolean }[], kind = "group", dmKey: string | null = null) {
  const id = randomUUID();
  await db.execute(sql`insert into chat.conversations (id, kind, title, dm_key, created_by) values (${id}, ${kind}, ${kind === "group" ? "Test group" : null}, ${dmKey}, ${createdBy})`);
  for (const m of members) {
    await db.execute(sql`insert into chat.conversation_members (conversation_id, user_id, role, left_at) values (${id}, ${m.userId}, 'member', ${m.left ? sql`now()` : sql`null`})`);
  }
  return id;
}

async function makeMessage(conversationId: string, senderId: string) {
  const id = randomUUID();
  await db.execute(sql`insert into chat.messages (id, conversation_id, sender_user_id, body_enc) values (${id}, ${conversationId}, ${senderId}, 'ciphertext')`);
  return id;
}

describe("chat guards", () => {
  it("messages are insert-only: updating body_enc throws", async () => {
    const a = await makeUser("a");
    const conv = await makeConversation(a, [{ userId: a }]);
    const m = await makeMessage(conv, a);
    await expect(db.execute(sql`update chat.messages set body_enc = 'changed' where id = ${m}`)).rejects.toThrow();
  });

  it("updating deleted_at once succeeds, a second time throws", async () => {
    const a = await makeUser("a");
    const conv = await makeConversation(a, [{ userId: a }]);
    const m = await makeMessage(conv, a);
    await db.execute(sql`update chat.messages set deleted_at = now() where id = ${m}`);
    const [row] = await rows<{ deleted_at: string | null }>(sql`select deleted_at from chat.messages where id = ${m}`);
    expect(row.deleted_at).not.toBeNull();
    await expect(db.execute(sql`update chat.messages set deleted_at = now() where id = ${m}`)).rejects.toThrow();
  });

  it("editing sets edited_at only together with nothing else changing", async () => {
    const a = await makeUser("a");
    const conv = await makeConversation(a, [{ userId: a }]);
    const m = await makeMessage(conv, a);
    await db.execute(sql`update chat.messages set edited_at = now() where id = ${m}`);
    await expect(db.execute(sql`update chat.messages set edited_at = now(), body_enc = 'x' where id = ${m}`)).rejects.toThrow();
  });

  it("deleting a message row throws", async () => {
    const a = await makeUser("a");
    const conv = await makeConversation(a, [{ userId: a }]);
    const m = await makeMessage(conv, a);
    await expect(db.execute(sql`delete from chat.messages where id = ${m}`)).rejects.toThrow();
  });

  it("message_revisions rows cannot be updated or deleted", async () => {
    const a = await makeUser("a");
    const conv = await makeConversation(a, [{ userId: a }]);
    const m = await makeMessage(conv, a);
    const rev = randomUUID();
    await db.execute(sql`insert into chat.message_revisions (id, message_id, body_enc) values (${rev}, ${m}, 'v2')`);
    await expect(db.execute(sql`update chat.message_revisions set body_enc = 'v3' where id = ${rev}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from chat.message_revisions where id = ${rev}`)).rejects.toThrow();
  });

  it("seq increases with every message", async () => {
    const a = await makeUser("a");
    const conv = await makeConversation(a, [{ userId: a }]);
    const first = await makeMessage(conv, a);
    const second = await makeMessage(conv, a);
    const seqs = await rows<{ id: string; seq: string }>(sql`select id, seq from chat.messages where id in (${first}, ${second})`);
    const bySeq = Object.fromEntries(seqs.map((r) => [r.id, Number(r.seq)]));
    expect(bySeq[second]).toBeGreaterThan(bySeq[first]);
  });

  it("dm_key is unique: inserting the same key twice throws", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const key = [a, b].sort().join(":");
    await makeConversation(a, [{ userId: a }, { userId: b }], "dm", key);
    await expect(makeConversation(b, [{ userId: b }, { userId: a }], "dm", key)).rejects.toThrow();
  });
});

describe("chat.can_join", () => {
  const can = async (topic: string, uid: string) => (await rows<{ ok: boolean }>(sql`select chat.can_join(${topic}, ${uid}::uuid) as ok`))[0].ok;

  it("a member of conv:<id> may join, a stranger and someone who left may not", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const stranger = await makeUser("s");
    const conv = await makeConversation(a, [{ userId: a }, { userId: b, left: true }]);
    expect(await can(`conv:${conv}`, a)).toBe(true);
    expect(await can(`conv:${conv}`, b)).toBe(false);
    expect(await can(`conv:${conv}`, stranger)).toBe(false);
  });

  it("an archived conversation cannot be joined", async () => {
    const a = await makeUser("a");
    const conv = await makeConversation(a, [{ userId: a }]);
    await db.execute(sql`update chat.conversations set archived_at = now() where id = ${conv}`);
    expect(await can(`conv:${conv}`, a)).toBe(false);
  });

  it("user:<own id> is true, user:<other id> is false", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    expect(await can(`user:${a}`, a)).toBe(true);
    expect(await can(`user:${b}`, a)).toBe(false);
  });

  it("a malformed topic is false", async () => {
    const a = await makeUser("a");
    expect(await can("conv:not-a-uuid", a)).toBe(false);
    expect(await can("other:" + a, a)).toBe(false);
    expect(await can("", a)).toBe(false);
  });
});
