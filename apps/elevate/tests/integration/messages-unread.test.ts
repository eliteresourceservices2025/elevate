import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// A thread reply must count as read once the person has read the chat (it used to keep the unread badge lit forever), and marking
// read can never go beyond the newest message that exists.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.88" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const service = await import("@/modules/messages/service");
const queries = await import("@/modules/messages/queries");

type Actor = { id: string; email: string; roles: string[] };
let counter = 0;
async function makeUser(label: string): Promise<Actor> {
  const id = randomUUID();
  const email = `${label}${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email, roles: ["employee"] };
}
const as = (u: Actor) => {
  current.user = u;
};

describe("reading a chat clears replies inside threads too", () => {
  it("the unread count is zero after reading up to latestSeq, even when the newest message is a thread reply", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    const root = await service.sendMessage(a, { conversationId, body: "Plan for Friday?" });
    await service.sendMessage(c, { conversationId, body: "Looks fine", threadRootId: root.id });
    await service.sendMessage(c, { conversationId, body: "One more thing", threadRootId: root.id });

    as(b);
    expect(await queries.countMyUnread()).toBe(3);
    const loaded = await queries.loadMessages({ conversationId });
    const newestRoot = loaded.messages[loaded.messages.length - 1].seq;
    expect(loaded.latestSeq).toBeGreaterThan(newestRoot); // the replies are newer than the newest top-level message

    // The old behaviour (read up to the newest top-level message) left the replies unread.
    await service.markRead(b, { conversationId, seq: newestRoot });
    expect(await queries.countMyUnread()).toBe(2);
    // Reading up to everything the person can see clears it.
    await service.markRead(b, { conversationId, seq: loaded.latestSeq });
    expect(await queries.countMyUnread()).toBe(0);
  });

  it("a made-up huge number cannot hide messages that arrive later", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    await service.sendMessage(a, { conversationId, body: "first" });
    await service.markRead(b, { conversationId, seq: 2_000_000_000 });
    as(b);
    expect(await queries.countMyUnread()).toBe(0);
    await service.sendMessage(a, { conversationId, body: "second, after the fake read" });
    expect(await queries.countMyUnread()).toBe(1);
  });
});
