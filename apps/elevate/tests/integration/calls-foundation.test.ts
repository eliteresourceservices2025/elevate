import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";

// Real-database tests for the calls foundation (migration 0159): who may join a call's Realtime channel, one live call per chat,
// one open seat per person, the recorder flag and its guest guard, and the default settings row.

let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

async function makeUser(label: string, isGuest = false): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`insert into core.users (id, email, is_guest) values (${id}, ${`${uniq(label)}@example.com`}, ${isGuest})`);
  return id;
}
async function makeGroup(members: string[]): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`insert into chat.conversations (id, kind, title, created_by) values (${id}, 'group', 'Crew', ${members[0]})`);
  for (const m of members) await db.execute(sql`insert into chat.conversation_members (conversation_id, user_id) values (${id}, ${m})`);
  return id;
}
async function makeCall(conversationId: string, startedBy: string): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`insert into chat.calls (id, conversation_id, started_by) values (${id}, ${conversationId}, ${startedBy})`);
  return id;
}
const canJoin = async (topic: string, uid: string) => (await rows<{ ok: boolean }>(sql`select chat.can_join(${topic}, ${uid}) as ok`))[0].ok;

describe("chat.can_join for call channels", () => {
  it("lets current members of the conversation join its live call, and nobody else", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const outsider = await makeUser("o");
    const conv = await makeGroup([a, b]);
    const call = await makeCall(conv, a);
    expect(await canJoin(`call:${call}`, a)).toBe(true);
    expect(await canJoin(`call:${call}`, b)).toBe(true);
    expect(await canJoin(`call:${call}`, outsider)).toBe(false);
  });

  it("closes the channel when the call ends, when the person leaves the chat, or the chat is deleted", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const conv = await makeGroup([a, b]);
    const call = await makeCall(conv, a);
    await db.execute(sql`update chat.conversation_members set left_at = now() where conversation_id = ${conv} and user_id = ${b}`);
    expect(await canJoin(`call:${call}`, b)).toBe(false);
    expect(await canJoin(`call:${call}`, a)).toBe(true);
    await db.execute(sql`update chat.conversations set archived_at = now() where id = ${conv}`);
    expect(await canJoin(`call:${call}`, a)).toBe(false);
    const conv2 = await makeGroup([a, b]);
    const call2 = await makeCall(conv2, a);
    await db.execute(sql`update chat.calls set ended_at = now(), end_reason = 'ended' where id = ${call2}`);
    expect(await canJoin(`call:${call2}`, a)).toBe(false);
  });

  it("still allows only your own user channel and your chats, and refuses malformed topics", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const conv = await makeGroup([a, b]);
    expect(await canJoin(`user:${a}`, a)).toBe(true);
    expect(await canJoin(`user:${b}`, a)).toBe(false);
    expect(await canJoin(`conv:${conv}`, a)).toBe(true);
    for (const bad of ["call:not-a-uuid", `call:${randomUUID()}`, `calls:${randomUUID()}`, `call:${randomUUID()}x`, "", "user:"]) expect(await canJoin(bad, a)).toBe(false);
  });
});

describe("call tables", () => {
  it("allows one live call per conversation at a time, and a new one after it ends", async () => {
    const a = await makeUser("a");
    const conv = await makeGroup([a, await makeUser("b")]);
    const first = await makeCall(conv, a);
    await expect(makeCall(conv, a)).rejects.toThrow();
    await db.execute(sql`update chat.calls set ended_at = now(), end_reason = 'ended' where id = ${first}`);
    await expect(makeCall(conv, a)).resolves.toBeTruthy();
  });

  it("allows one open seat per person per call, and rejoining after leaving", async () => {
    const a = await makeUser("a");
    const conv = await makeGroup([a, await makeUser("b")]);
    const call = await makeCall(conv, a);
    await db.execute(sql`insert into chat.call_participants (call_id, user_id, role) values (${call}, ${a}, 'host')`);
    await expect(db.execute(sql`insert into chat.call_participants (call_id, user_id, role) values (${call}, ${a}, 'attendee')`)).rejects.toThrow();
    await db.execute(sql`update chat.call_participants set left_at = now() where call_id = ${call} and user_id = ${a}`);
    await expect(db.execute(sql`insert into chat.call_participants (call_id, user_id, role) values (${call}, ${a}, 'attendee')`)).resolves.toBeTruthy();
  });

  it("only accepts known modes, roles and track kinds, and one track name per session", async () => {
    const a = await makeUser("a");
    const conv = await makeGroup([a, await makeUser("b")]);
    await expect(db.execute(sql`insert into chat.calls (conversation_id, started_by, mode) values (${conv}, ${a}, 'party')`)).rejects.toThrow();
    const call = await makeCall(conv, a);
    await expect(db.execute(sql`insert into chat.call_participants (call_id, user_id, role) values (${call}, ${a}, 'king')`)).rejects.toThrow();
    const session = "d".repeat(32);
    await db.execute(sql`insert into chat.call_tracks (call_id, user_id, cf_session_id, track_name, kind) values (${call}, ${a}, ${session}, 'audio-1', 'audio')`);
    await expect(db.execute(sql`insert into chat.call_tracks (call_id, user_id, cf_session_id, track_name, kind) values (${call}, ${a}, ${session}, 'audio-1', 'audio')`)).rejects.toThrow();
    await expect(db.execute(sql`insert into chat.call_tracks (call_id, user_id, cf_session_id, track_name, kind) values (${call}, ${a}, ${session}, 'x', 'hologram')`)).rejects.toThrow();
  });
});

describe("recorder flag and settings", () => {
  it("is false for everyone by default, can be set for staff, and never for a guest", async () => {
    const staff = await makeUser("s");
    const guest = await makeUser("g", true);
    expect((await rows<{ f: boolean }>(sql`select can_record_calls as f from core.users where id = ${staff}`))[0].f).toBe(false);
    await db.execute(sql`update core.users set can_record_calls = true where id = ${staff}`);
    await expect(db.execute(sql`update core.users set can_record_calls = true where id = ${guest}`)).rejects.toThrow();
  });

  it("starts with recording off and all-hands on, in a single settings row", async () => {
    const [row] = await rows<{ recording_enabled: boolean; townhall_enabled: boolean; monthly_gb_warning: number }>(sql`select recording_enabled, townhall_enabled, monthly_gb_warning from chat.call_settings where id = 1`);
    expect(row).toEqual({ recording_enabled: false, townhall_enabled: true, monthly_gb_warning: 700 });
    await expect(db.execute(sql`insert into chat.call_settings (id) values (2)`)).rejects.toThrow();
  });
});
