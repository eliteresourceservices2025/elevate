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

describe("polls (Phase 2c)", () => {
  const optionsOf = async (conv: string, viewer: Actor, messageId: string) => {
    as(viewer);
    const m = (await queries.loadMessages({ conversationId: conv })).messages.find((x) => x.id === messageId)!;
    return m.poll!;
  };

  it("a poll stores its question and options encrypted, and shows the options with zero votes", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const question = `Lunch spot ${uniq("q")}`;
    const poll = await service.createPoll(a, { conversationId: conv, question, options: ["Pizza place", "Noodle bar", "Salad"], multiple: false, anonymous: false });
    const raw = await rows<{ body_enc: string }>(sql`select body_enc from chat.messages where id = ${poll.id}`);
    expect(raw[0].body_enc).not.toContain(question);
    const rawOptions = await rows<{ label_enc: string }>(sql`select label_enc from chat.poll_options where message_id = ${poll.id}`);
    expect(rawOptions).toHaveLength(3);
    expect(JSON.stringify(rawOptions)).not.toContain("Pizza");
    const view = await optionsOf(conv, b, poll.id);
    expect(view.options.map((o) => o.label)).toEqual(["Pizza place", "Noodle bar", "Salad"]);
    expect(view.options.every((o) => o.count === 0 && !o.mine)).toBe(true);
    const asMessage = (await queries.loadMessages({ conversationId: conv })).messages.find((x) => x.id === poll.id)!;
    expect(asMessage).toMatchObject({ kind: "poll", body: question });
  });

  it("single choice: a new vote replaces the old one, the same vote again removes it", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const poll = await service.createPoll(a, { conversationId: conv, question: "Friday huddle time?", options: ["9 PM", "10 PM"], multiple: false, anonymous: false });
    const [o1, o2] = (await optionsOf(conv, b, poll.id)).options;
    await service.votePoll(b, { messageId: poll.id, optionId: o1.id });
    await service.votePoll(c, { messageId: poll.id, optionId: o1.id });
    await service.votePoll(b, { messageId: poll.id, optionId: o2.id });
    let view = await optionsOf(conv, b, poll.id);
    expect(view.options.map((o) => [o.count, o.mine])).toEqual([[1, false], [1, true]]);
    await service.votePoll(b, { messageId: poll.id, optionId: o2.id });
    view = await optionsOf(conv, b, poll.id);
    expect(view.options.map((o) => o.count)).toEqual([1, 0]);
  });

  it("multiple choice toggles each option; names are shown unless the poll is anonymous", async () => {
    const a = await makeUser("a", { first: "Ana", last: "Cruz" });
    const b = await makeUser("b", { first: "Bea", last: "Santos" });
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const open = await service.createPoll(a, { conversationId: conv, question: "Which days can you work?", options: ["Mon", "Tue", "Wed"], multiple: true, anonymous: false });
    const secret = await service.createPoll(a, { conversationId: conv, question: "Rate the new schedule", options: ["Good", "Bad"], multiple: false, anonymous: true });
    const [mon, tue] = (await optionsOf(conv, b, open.id)).options;
    await service.votePoll(b, { messageId: open.id, optionId: mon.id });
    await service.votePoll(b, { messageId: open.id, optionId: tue.id });
    const view = await optionsOf(conv, a, open.id);
    expect(view.options.map((o) => o.count)).toEqual([1, 1, 0]);
    expect(view.options[0].voters).toEqual(["Bea Santos"]);
    const [good] = (await optionsOf(conv, a, secret.id)).options;
    await service.votePoll(b, { messageId: secret.id, optionId: good.id });
    const hidden = await optionsOf(conv, a, secret.id);
    expect(hidden.options[0].count).toBe(1);
    expect(hidden.options[0].voters).toBeUndefined();
    expect(JSON.stringify(hidden)).not.toContain("Bea");
  });

  it("refuses votes from strangers and removed members, an option of another poll, a vote on a non-poll, and bad polls", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const stranger = await makeUser("s");
    const conv = await group(a, [b, c]);
    const p1 = await service.createPoll(a, { conversationId: conv, question: "One?", options: ["Yes", "No"], multiple: false, anonymous: false });
    const p2 = await service.createPoll(a, { conversationId: conv, question: "Two?", options: ["Yes", "No"], multiple: false, anonymous: false });
    const [y1] = (await optionsOf(conv, b, p1.id)).options;
    const [y2] = (await optionsOf(conv, b, p2.id)).options;
    await expect(service.votePoll(stranger, { messageId: p1.id, optionId: y1.id })).rejects.toThrow("Message not found.");
    await expect(service.votePoll(b, { messageId: p1.id, optionId: y2.id })).rejects.toThrow("That option isn't in this poll.");
    const text = await service.sendMessage(a, { conversationId: conv, body: "not a poll" });
    await expect(service.votePoll(b, { messageId: text.id, optionId: y1.id })).rejects.toThrow("That isn't a poll.");
    await service.removeMember(a, { conversationId: conv, userId: c.id });
    await expect(service.votePoll(c, { messageId: p1.id, optionId: y1.id })).rejects.toThrow("Message not found.");
    await expect(service.createPoll(a, { conversationId: conv, question: "Only one?", options: ["Just one"], multiple: false, anonymous: false })).rejects.toThrow();
    await expect(service.createPoll(a, { conversationId: conv, question: "Same?", options: ["Same", " same "], multiple: false, anonymous: false })).rejects.toThrow();
    await expect(service.createPoll(stranger, { conversationId: conv, question: "Hi?", options: ["A", "B"], multiple: false, anonymous: false })).rejects.toThrow("Conversation not found.");
  });
});

describe("@everyone and @all", () => {
  it("notifies everyone else in the chat, except people who muted it, and nobody outside it", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const d = await makeUser("d");
    const outsider = await makeUser("o");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id, d.id] });
    await db.execute(sql`update chat.conversation_members set muted_until = now() + interval '1 hour' where conversation_id = ${conversationId} and user_id = ${d.id}`);
    await service.sendMessage(a, { conversationId, body: "Meeting at 9 @everyone" });
    const who = async (id: string) => (await db.execute(sql`select 1 from ops.notifications where user_id = ${id} and kind = 'chat.mention' and link = ${`/messages/${conversationId}`}`)) as unknown as unknown[];
    expect(await who(b.id)).toHaveLength(1);
    expect(await who(c.id)).toHaveLength(1);
    expect(await who(a.id)).toHaveLength(0); // not the sender
    expect(await who(d.id)).toHaveLength(0); // muted
    expect(await who(outsider.id)).toHaveLength(0);
    // A look-alike notifies nobody.
    await service.sendMessage(a, { conversationId, body: "write to ana@all.com or @allison" });
    expect(await who(b.id)).toHaveLength(1);
  });
});
