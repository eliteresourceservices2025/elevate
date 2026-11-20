import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Quote replies: the quote shows the original's sender and words, only within the same chat, follows removal, and never reveals
// a message from before the viewer joined.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.89" }), cookies: async () => ({ get: () => undefined }) }));

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
const messagesOf = async (u: Actor, conversationId: string) => {
  as(u);
  return (await queries.loadMessages({ conversationId })).messages;
};

describe("quote replies", () => {
  it("shows who and what was quoted, including the latest edit, and a label for non-text messages", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    const original = await service.sendMessage(a, { conversationId, body: "Friday cutoff is 5 PM" });
    await service.editMessage(a, { messageId: original.id, body: "Friday cutoff is 6 PM" });
    await service.sendMessage(b, { conversationId, body: "Noted", quotedMessageId: original.id });
    const poll = await service.createPoll(a, { conversationId, question: "Lunch?", options: ["Pizza", "Noodles"], multiple: false, anonymous: false });
    await service.sendMessage(c, { conversationId, body: "Pizza please", quotedMessageId: poll.id });

    const seen = await messagesOf(c, conversationId);
    const reply = seen.find((m) => m.body === "Noted")!;
    expect(reply.quote).toMatchObject({ id: original.id, state: "ok", snippet: "Friday cutoff is 6 PM" });
    expect(reply.quote!.senderName).toBeTruthy();
    expect(seen.find((m) => m.body === "Pizza please")!.quote).toMatchObject({ state: "ok", snippet: "Poll: Lunch?" });
    expect(seen.find((m) => m.id === original.id)!.quote).toBeNull();
  });

  it("refuses a quote from another chat, a system line or a stranger, and shows removal", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const stranger = await makeUser("s");
    const one = (await service.createGroup(a, { title: "One", memberUserIds: [b.id, c.id] })).conversationId;
    const two = (await service.createGroup(a, { title: "Two", memberUserIds: [b.id, c.id] })).conversationId;
    const inOne = await service.sendMessage(a, { conversationId: one, body: "secret of one" });
    await expect(service.sendMessage(b, { conversationId: two, body: "wrong chat", quotedMessageId: inOne.id })).rejects.toThrow("not found");
    await expect(service.sendMessage(stranger, { conversationId: one, body: "not a member", quotedMessageId: inOne.id })).rejects.toThrow("not found");
    const system = (await db.execute(sql`select id from chat.messages where conversation_id = ${one} and kind = 'system' limit 1`)) as unknown as { id: string }[];
    if (system[0]) await expect(service.sendMessage(b, { conversationId: one, body: "x", quotedMessageId: system[0].id })).rejects.toThrow("not found");

    await service.sendMessage(b, { conversationId: one, body: "agreed", quotedMessageId: inOne.id });
    await service.deleteMessage(a, inOne.id);
    const after = (await messagesOf(c, one)).find((m) => m.body === "agreed")!;
    expect(after.quote).toMatchObject({ state: "removed", snippet: "" });
  });

  it("a person added later sees 'earlier message', never the old text", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const late = await makeUser("late");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    const old = await service.sendMessage(a, { conversationId, body: "old private words" });
    await service.addMembers(a, conversationId, [late.id]);
    await service.sendMessage(b, { conversationId, body: "quoting old news", quotedMessageId: old.id });
    const asLate = (await messagesOf(late, conversationId)).find((m) => m.body === "quoting old news")!;
    expect(asLate.quote).toMatchObject({ state: "earlier", snippet: "" });
    expect(JSON.stringify(asLate)).not.toContain("old private words");
    // The quoted id is the only trace, and the database refuses to change it afterwards.
    await expect(db.execute(sql`update chat.messages set quoted_message_id = null where id = ${asLate.id}`)).rejects.toThrow();
  });
});
