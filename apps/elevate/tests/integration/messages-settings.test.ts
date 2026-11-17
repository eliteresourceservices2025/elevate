import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Real-database tests for muting, personal chat settings and the daily unread digest (Phase 2e).

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.85" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const service = await import("@/modules/messages/service");
const queries = await import("@/modules/messages/queries");
const settings = await import("@/modules/messages/settings");
const jobs = await import("@/modules/messages/jobs");

type Actor = { id: string; email: string; roles: string[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: Actor) => {
  current.user = u;
};
async function makeUser(label: string): Promise<Actor> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email, roles: ["employee"] };
}
const group = async (creator: Actor, others: Actor[]) => (await service.createGroup(creator, { title: "Crew", memberUserIds: others.map((o) => o.id) })).conversationId;
const unread = async (u: Actor) => {
  as(u);
  return queries.countMyUnread();
};

describe("unread counts every kind of message from others, not only text", () => {
  it("a poll, a text and a removed message", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    await service.sendMessage(a, { conversationId: conv, body: "hello" });
    await service.createPoll(a, { conversationId: conv, question: "Lunch?", options: ["Pizza", "Noodles"], multiple: false, anonymous: false });
    const gone = await service.sendMessage(a, { conversationId: conv, body: "oops" });
    await service.deleteMessage(a, gone.id);
    expect(await unread(b)).toBe(2);
    expect(await unread(a)).toBe(0);
  });
});

describe("muting a chat", () => {
  it("a muted chat leaves the unread total and the digest; unmuting brings it back", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    await service.sendMessage(a, { conversationId: conv, body: "ping" });
    expect(await unread(b)).toBe(1);
    await settings.muteConversation(b, { conversationId: conv, until: "8h" });
    expect(await unread(b)).toBe(0);
    as(b);
    const row = (await queries.listMyConversations()).find((x) => x.id === conv)!;
    expect(row.mutedUntil).not.toBeNull();
    expect(row.unread).toBe(1); // the chat still shows its own count, it just stops adding to the total
    await settings.muteConversation(b, { conversationId: conv, until: "off" });
    expect(await unread(b)).toBe(1);
    await settings.muteConversation(b, { conversationId: conv, until: "forever" });
    expect(new Date((await rows<{ muted_until: string }>(sql`select muted_until from chat.conversation_members where conversation_id = ${conv} and user_id = ${b.id}`))[0].muted_until).getFullYear()).toBeGreaterThan(2100);
  });

  it("only a member can mute", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const stranger = await makeUser("s");
    const conv = await group(a, [b, c]);
    await expect(settings.muteConversation(stranger, { conversationId: conv, until: "1h" })).rejects.toThrow("Conversation not found.");
  });
});

describe("personal settings", () => {
  it("start as appear online with the email digest on, and are saved per person", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    as(a);
    expect(await settings.getChatSettings()).toEqual({ appearOffline: false, emailDigest: true, sound: "chime" });
    await settings.saveChatSettings(a, { appearOffline: true, emailDigest: false, sound: "bell" });
    expect(await settings.getChatSettings()).toEqual({ appearOffline: true, emailDigest: false, sound: "bell" });
    as(b);
    expect(await settings.getChatSettings()).toEqual({ appearOffline: false, emailDigest: true, sound: "chime" });
  });
});

describe("the daily digest", () => {
  it("queues one lowest-priority email per person with unread messages, with counts and a link only, once a day", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const d = await makeUser("d");
    const conv = await group(a, [b, c, d]);
    const secret = `secret plan ${uniq("x")}`;
    await service.sendMessage(a, { conversationId: conv, body: secret });
    await service.sendMessage(a, { conversationId: conv, body: "second" });
    await settings.saveChatSettings(c, { appearOffline: false, emailDigest: false, sound: "off" }); // c switched the digest off
    await settings.muteConversation(d, { conversationId: conv, until: "forever" }); // d muted the only chat
    const first = await jobs.runChatDigest("2026-11-17");
    expect(first.queued).toBeGreaterThanOrEqual(1);
    const mail = await rows<{ user_id: string; kind: string; priority: number; subject: string; body: string; link: string }>(sql`select user_id, kind, priority, subject, body, link from ops.email_queue where kind = 'chat_unread' and user_id in (${a.id}, ${b.id}, ${c.id}, ${d.id})`);
    expect(mail.map((m) => m.user_id)).toEqual([b.id]);
    expect(mail[0].priority).toBe(3);
    expect(mail[0].link).toBe("/messages");
    expect(JSON.stringify(mail)).not.toContain(secret);
    expect(mail[0].subject).toContain("2 unread");
    const again = await jobs.runChatDigest("2026-11-17");
    expect(again.queued).toBe(0);
  });
});
