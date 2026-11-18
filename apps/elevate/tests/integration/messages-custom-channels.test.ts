import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Channels made by hand (HR Admin and Super Admin): add, edit (rename, who can post, people) and remove.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.90" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const service = await import("@/modules/messages/service");
const queries = await import("@/modules/messages/queries");
const { syncChannels } = await import("@/modules/messages/channels");

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

describe("channels made by hand", () => {
  it("are created with chosen people, listed as channels, renamed, and removed", async () => {
    const hr = await makeUser("hr");
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { conversationId } = await service.createChannel(hr, { title: "Announcements", memberUserIds: [a.id, b.id], postingAdminsOnly: false });
    as(a);
    const mine = (await queries.listMyConversations()).find((c) => c.id === conversationId)!;
    expect(mine).toMatchObject({ kind: "channel", title: "Announcements", posting: "everyone", memberCount: 3 });
    await service.renameGroup(hr, { conversationId, title: "News" });
    expect((await queries.listMyConversations()).find((c) => c.id === conversationId)!.title).toBe("News");
    await service.addMembers(hr, conversationId, [(await makeUser("late")).id]);
    await service.removeMember(hr, { conversationId, userId: b.id });
    await service.deleteGroup(hr, conversationId);
    expect((await queries.listMyConversations()).some((c) => c.id === conversationId)).toBe(false);
  });

  it("can be set so only HR posts, while replies and reactions stay open", async () => {
    const hr = await makeUser("hr");
    const a = await makeUser("a");
    const { conversationId } = await service.createChannel(hr, { title: "Notices", memberUserIds: [a.id], postingAdminsOnly: true });
    await expect(service.sendMessage(a, { conversationId, body: "hello" })).rejects.toThrow("Only HR can post in this channel.");
    const root = await service.sendMessage(hr, { conversationId, body: "Holiday schedule", canManage: true });
    await expect(service.sendMessage(a, { conversationId, body: "thanks!", threadRootId: root.id })).resolves.toBeTruthy();
    await service.setChannelPosting(hr, { conversationId, posting: "everyone" });
    await expect(service.sendMessage(a, { conversationId, body: "now I can post" })).resolves.toBeTruthy();
    // The setting only applies to channels made by hand.
    const group = await service.createGroup(hr, { title: "Crew", memberUserIds: [a.id, (await makeUser("c")).id] });
    await expect(service.setChannelPosting(hr, { conversationId: group.conversationId, posting: "admins" })).rejects.toThrow("Only a channel");
  });

  it("refuse an empty name or nobody else, and the daily sync leaves them alone", async () => {
    const hr = await makeUser("hr");
    const a = await makeUser("a");
    await expect(service.createChannel(hr, { title: "  ", memberUserIds: [a.id], postingAdminsOnly: false })).rejects.toThrow();
    await expect(service.createChannel(hr, { title: "Solo", memberUserIds: [], postingAdminsOnly: false })).rejects.toThrow();
    const { conversationId } = await service.createChannel(hr, { title: "Keep me", memberUserIds: [a.id], postingAdminsOnly: false });
    await syncChannels();
    const row = (await db.execute(sql`select kind, archived_at from chat.conversations where id = ${conversationId}`)) as unknown as { kind: string; archived_at: Date | null }[];
    expect(row[0]).toMatchObject({ kind: "channel", archived_at: null });
    expect((await db.execute(sql`select count(*)::int as n from chat.conversation_members where conversation_id = ${conversationId} and left_at is null`)) as unknown as { n: number }[]).toEqual([{ n: 2 }]);
  });
});
