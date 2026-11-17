import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Real-database tests for message search: a blind index over encrypted text (Phase 2e).

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.84" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const service = await import("@/modules/messages/service");
const queries = await import("@/modules/messages/queries");

type Actor = { id: string; email: string; roles: string[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`.replace(/[^a-z0-9]/gi, "").toLowerCase();
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
const group = async (creator: Actor, others: Actor[], title = "Crew") => (await service.createGroup(creator, { title, memberUserIds: others.map((o) => o.id) })).conversationId;
const found = async (viewer: Actor, q: string) => {
  as(viewer);
  return (await queries.searchMessages({ q })).map((r) => r.body);
};

describe("searchMessages", () => {
  it("finds whole words and word starts, case and accent blind, newest first, and needs every word", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const tag = uniq("zz");
    await service.sendMessage(a, { conversationId: conv, body: `Schedule for Thursday ${tag}` });
    await service.sendMessage(b, { conversationId: conv, body: `Café menu ${tag} and the schedule` });
    await service.sendMessage(a, { conversationId: conv, body: `unrelated note ${tag}` });
    expect(await found(c, `schedule ${tag}`)).toEqual([`Café menu ${tag} and the schedule`, `Schedule for Thursday ${tag}`]);
    expect(await found(c, `SCHED ${tag}`)).toHaveLength(2); // a word start, any case
    expect(await found(c, `cafe ${tag}`)).toEqual([`Café menu ${tag} and the schedule`]); // accents ignored
    expect(await found(c, `schedule thursday ${tag}`)).toEqual([`Schedule for Thursday ${tag}`]); // every word must match
    expect(await found(c, `nothingmatches ${tag}`)).toEqual([]);
    expect(await found(c, "x")).toEqual([]); // too short to search
  });

  it("the index holds hashes, never the words", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const word = `confidentialword${uniq("q")}`;
    const m = await service.sendMessage(a, { conversationId: conv, body: `please keep ${word} private` });
    const tokens = await rows<{ token: string }>(sql`select token from chat.search_tokens where message_id = ${m.id}`);
    expect(tokens.length).toBeGreaterThan(5);
    expect(JSON.stringify(tokens)).not.toContain("confidential");
    expect(JSON.stringify(tokens)).not.toContain("private");
  });

  it("finds only what the person may read: members, from their join time on, never removed or deleted messages, never other chats", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const d = await makeUser("d");
    const stranger = await makeUser("s");
    const conv = await group(a, [b, c]);
    const other = await group(a, [d, b], "Other");
    const tag = uniq("kk");
    await service.sendMessage(a, { conversationId: conv, body: `old plan ${tag}` });
    await service.sendMessage(a, { conversationId: other, body: `other chat plan ${tag}` });
    await db.execute(sql`select pg_sleep(0.05)`);
    await service.addMembers(a, conv, [d.id]);
    await db.execute(sql`select pg_sleep(0.05)`);
    const fresh = await service.sendMessage(a, { conversationId: conv, body: `new plan ${tag}` });
    expect(await found(d, `plan ${tag}`)).toEqual([`new plan ${tag}`, `other chat plan ${tag}`]); // d is in both chats, but sees only after joining
    expect(await found(stranger, `plan ${tag}`)).toEqual([]);
    await service.removeMember(a, { conversationId: conv, userId: c.id });
    expect((await found(c, `plan ${tag}`)).some((b) => b.startsWith("old") || b.startsWith("new"))).toBe(false);
    await service.deleteMessage(a, fresh.id);
    expect(await found(b, `new plan ${tag}`)).toEqual([]);
  });

  it("follows edits and removals", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const tag = uniq("ee");
    const m = await service.sendMessage(a, { conversationId: conv, body: `first draft ${tag}` });
    expect(await found(b, `draft ${tag}`)).toEqual([`first draft ${tag}`]);
    await service.editMessage(a, { messageId: m.id, body: `final version ${tag}` });
    expect(await found(b, `draft ${tag}`)).toEqual([]);
    expect(await found(b, `final ${tag}`)).toEqual([`final version ${tag}`]);
    await service.deleteMessage(a, m.id);
    expect(await found(b, `final ${tag}`)).toEqual([]);
    const left = await rows<{ n: string }>(sql`select count(*)::text as n from chat.search_tokens where message_id = ${m.id}`);
    expect(left[0].n).toBe("0");
  });

  it("each hit says where it is (chat name, who, when) and mentions are searchable by name, not by id", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c], "Front desk");
    const tag = uniq("hh");
    await service.sendMessage(a, { conversationId: conv, body: `hello @[Bea Santos](user:${b.id}) about ${tag}` });
    as(b);
    const hits = await queries.searchMessages({ q: `bea ${tag}` });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ conversationId: conv, conversationTitle: "Front desk" });
    expect(await found(b, `${b.id.slice(0, 8)} ${tag}`)).toEqual([]);
  });
});
