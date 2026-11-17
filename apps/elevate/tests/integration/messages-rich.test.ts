import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Real-database tests for the richer chat features: reactions, thread replies, pins and @mentions (Phase 2a).

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.81" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const service = await import("@/modules/messages/service");
const queries = await import("@/modules/messages/queries");

type Actor = { id: string; email: string; roles: string[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: Actor) => {
  current.user = u;
};
async function makeUser(label: string, person?: { first: string; last: string }): Promise<Actor> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  if (person) await db.execute(sql`insert into core.employees (legal_first_name, legal_last_name, work_email, status, user_id, start_date) values (${person.first}, ${person.last}, ${email}, 'active', ${id}, '2026-01-05')`);
  return { id, email, roles: ["employee"] };
}
async function group(creator: Actor, others: Actor[], title = "Crew") {
  return (await service.createGroup(creator, { title, memberUserIds: others.map((o) => o.id) })).conversationId;
}
const NOT_FOUND_MSG = "Message not found.";

describe("reactions", () => {
  it("toggle on and off; each person sees the count and which ones are theirs", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const m = await service.sendMessage(a, { conversationId: conv, body: "great news" });
    expect(await service.toggleReaction(b, { messageId: m.id, emoji: "👍" })).toEqual({ active: true });
    await service.toggleReaction(c, { messageId: m.id, emoji: "👍" });
    await service.toggleReaction(c, { messageId: m.id, emoji: "🎉" });
    as(b);
    const seenByB = (await queries.loadMessages({ conversationId: conv })).messages.find((x) => x.id === m.id)!;
    expect(seenByB.reactions).toEqual(expect.arrayContaining([{ emoji: "👍", count: 2, mine: true }, { emoji: "🎉", count: 1, mine: false }]));
    expect(await service.toggleReaction(b, { messageId: m.id, emoji: "👍" })).toEqual({ active: false });
    const after = (await queries.loadMessages({ conversationId: conv })).messages.find((x) => x.id === m.id)!;
    expect(after.reactions.find((r) => r.emoji === "👍")).toEqual({ emoji: "👍", count: 1, mine: false });
  });

  it("refuses an emoji outside the set, a stranger, a removed member, and a message from before a person joined", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const d = await makeUser("d");
    const stranger = await makeUser("s");
    const conv = await group(a, [b, c]);
    const old = await service.sendMessage(a, { conversationId: conv, body: "before d" });
    await expect(service.toggleReaction(b, { messageId: old.id, emoji: "zzz" })).rejects.toThrow("That reaction isn't available.");
    await expect(service.toggleReaction(stranger, { messageId: old.id, emoji: "👍" })).rejects.toThrow(NOT_FOUND_MSG);
    await service.removeMember(a, { conversationId: conv, userId: c.id });
    await expect(service.toggleReaction(c, { messageId: old.id, emoji: "👍" })).rejects.toThrow(NOT_FOUND_MSG);
    await db.execute(sql`select pg_sleep(0.05)`);
    await service.addMembers(a, conv, [d.id]);
    await expect(service.toggleReaction(d, { messageId: old.id, emoji: "👍" })).rejects.toThrow(NOT_FOUND_MSG);
  });

  it("cannot react to a removed message", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const m = await service.sendMessage(a, { conversationId: conv, body: "oops" });
    await service.deleteMessage(a, m.id);
    await expect(service.toggleReaction(b, { messageId: m.id, emoji: "👍" })).rejects.toThrow(NOT_FOUND_MSG);
  });
});

describe("thread replies", () => {
  it("a reply stays out of the main list, counts on its root, and loads in the thread", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const root = await service.sendMessage(a, { conversationId: conv, body: "who can cover Thursday?" });
    const reply = await service.sendMessage(b, { conversationId: conv, body: "I can", threadRootId: root.id });
    as(c);
    const main = (await queries.loadMessages({ conversationId: conv })).messages;
    expect(main.map((m) => m.id)).toContain(root.id);
    expect(main.map((m) => m.id)).not.toContain(reply.id);
    expect(main.find((m) => m.id === root.id)).toMatchObject({ replyCount: 1 });
    const thread = await queries.loadThread({ conversationId: conv, rootId: root.id });
    expect(thread.root.id).toBe(root.id);
    expect(thread.replies.map((m) => m.body)).toEqual(["I can"]);
  });

  it("refuses a reply to a reply, a root from another conversation, and a stranger loading the thread", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const stranger = await makeUser("s");
    const conv = await group(a, [b, c]);
    const other = await group(a, [b, c], "Other");
    const root = await service.sendMessage(a, { conversationId: conv, body: "root" });
    const reply = await service.sendMessage(b, { conversationId: conv, body: "reply", threadRootId: root.id });
    await expect(service.sendMessage(a, { conversationId: conv, body: "nested", threadRootId: reply.id })).rejects.toThrow("Message not found.");
    await expect(service.sendMessage(a, { conversationId: other, body: "wrong place", threadRootId: root.id })).rejects.toThrow("Message not found.");
    as(stranger);
    await expect(queries.loadThread({ conversationId: conv, rootId: root.id })).rejects.toThrow("Conversation not found.");
  });
});

describe("pins", () => {
  it("pin and unpin, shown in the pinned list, idempotent, members only", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const stranger = await makeUser("s");
    const conv = await group(a, [b, c]);
    const m = await service.sendMessage(a, { conversationId: conv, body: "Holiday schedule is in Announcements" });
    await service.pinMessage(b, { messageId: m.id });
    await service.pinMessage(c, { messageId: m.id }); // already pinned: nothing changes
    as(c);
    const pins = await queries.listPins({ conversationId: conv });
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ messageId: m.id, body: "Holiday schedule is in Announcements" });
    expect((await queries.loadMessages({ conversationId: conv })).messages.find((x) => x.id === m.id)?.pinned).toBe(true);
    await expect(service.pinMessage(stranger, { messageId: m.id })).rejects.toThrow(NOT_FOUND_MSG);
    await service.unpinMessage(b, { messageId: m.id });
    expect(await queries.listPins({ conversationId: conv })).toHaveLength(0);
  });
});

describe("mentions", () => {
  it("notifies the mentioned members only, with no message text", async () => {
    const a = await makeUser("a", { first: "Ana", last: "Cruz" });
    const b = await makeUser("b", { first: "Bea", last: "Santos" });
    const c = await makeUser("c");
    const outsider = await makeUser("o");
    const conv = await group(a, [b, c], "Front desk");
    const secret = `the plan is ${uniq("x")}`;
    await service.sendMessage(a, { conversationId: conv, body: `Hi @[Bea Santos](user:${b.id}) and @[Nobody](user:${outsider.id}) and me @[Ana](user:${a.id}) - ${secret}` });
    const notes = await rows<{ user_id: string; kind: string; title: string; body: string | null; link: string | null }>(sql`select user_id, kind, title, body, link from ops.notifications where kind = 'chat.mention' and user_id in (${a.id}, ${b.id}, ${c.id}, ${outsider.id})`);
    expect(notes.map((n) => n.user_id)).toEqual([b.id]);
    expect(JSON.stringify(notes)).not.toContain(secret);
    expect(notes[0].title).toContain("Front desk");
    expect(notes[0].link).toBe(`/messages/${conv}`);
  });
});

describe("extractMentions", () => {
  it("finds user ids in mention tokens, once each", async () => {
    const { extractMentions } = await import("@/modules/messages/mentions");
    const id1 = "11111111-1111-4111-8111-111111111111";
    const id2 = "22222222-2222-4222-8222-222222222222";
    expect(extractMentions(`hi @[A](user:${id1}) @[B](user:${id2}) @[A again](user:${id1}) @[bad](user:nope) @nobody`)).toEqual([id1, id2]);
    expect(extractMentions("no mentions here")).toEqual([]);
  });
});
