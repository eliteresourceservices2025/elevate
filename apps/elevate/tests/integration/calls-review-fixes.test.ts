import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Fixes from the independent security review of calls: media of people who leave, are removed, or leave the chat is closed at Cloudflare;
// a removed person stays out and "host" is one held role; admin-only channels can't have calls started by ordinary members.

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.93" }), cookies: async () => ({ get: () => undefined }) }));
vi.stubEnv("CALLS_FAKE", "1");

const { db } = await import("@/lib/db");
const messages = await import("@/modules/messages/service");
const calls = await import("@/modules/calls/service");
const { getSfu } = await import("@/modules/calls/sfu-port");

type Actor = { id: string; email: string };
let counter = 0;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const fakeSfu = () => getSfu() as unknown as { closed: { sessionId: string; mids: string[] }[] };

beforeAll(async () => {
  await db.execute(sql`create schema if not exists auth`);
  await db.execute(sql`create table if not exists auth.sessions (user_id uuid)`);
});

async function makeUser(): Promise<Actor> {
  const id = randomUUID();
  const email = `r${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email };
}
async function callOf(host: Actor, others: Actor[]) {
  const conv = (await messages.createGroup(host, { title: "Crew", memberUserIds: others.map((o) => o.id) })).conversationId;
  const { callId } = await calls.startCall(host, { conversationId: conv });
  await calls.joinCall(host, { callId });
  for (const o of others) await calls.joinCall(o, { callId });
  return { conv, callId };
}
const seat = async (callId: string, userId: string) =>
  (await rows<{ cf_session_id: string; cf_pull_session_id: string; pulled_mids: string[]; left_at: Date | null }>(sql`select cf_session_id, cf_pull_session_id, pulled_mids, left_at from chat.call_participants where call_id = ${callId} and user_id = ${userId} order by joined_at desc limit 1`))[0];
const role = async (callId: string, userId: string) => (await rows<{ role: string }>(sql`select role from chat.call_participants where call_id = ${callId} and user_id = ${userId} and left_at is null`))[0]?.role;

describe("what a person pulled is closed when they go", () => {
  it("remembers pulled tracks, forgets them when closed, and closes both sending and receiving media on removal", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { callId } = await callOf(a, [b, await makeUser()]);
    const out = await calls.publishTracks(a, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }] });
    const bOut = await calls.publishTracks(b, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }] });
    const pulled = await calls.subscribeTracks(b, { callId, trackNames: [out.tracks[0].trackName] });
    expect(pulled.tracks).toHaveLength(1);
    expect((await seat(callId, b.id)).pulled_mids).toEqual([pulled.tracks[0].mid]);
    await calls.unsubscribeTracks(b, { callId, mids: [pulled.tracks[0].mid] });
    expect((await seat(callId, b.id)).pulled_mids).toEqual([]);
    await calls.subscribeTracks(b, { callId, trackNames: [out.tracks[0].trackName] });
    const before = fakeSfu().closed.length;
    const s = await seat(callId, b.id);
    await calls.removeParticipant(a, { callId, userId: b.id });
    const closed = fakeSfu().closed.slice(before);
    expect(closed.some((c) => c.sessionId === s.cf_pull_session_id && c.mids.length > 0)).toBe(true); // what b was receiving
    expect(closed.some((c) => c.sessionId === s.cf_session_id && c.mids.includes("0"))).toBe(true); // what b was sending
    expect(bOut.tracks).toHaveLength(1);
  });

  it("leaving closes the person's media too", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { callId } = await callOf(a, [b, await makeUser()]);
    const out = await calls.publishTracks(a, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }] });
    await calls.subscribeTracks(b, { callId, trackNames: [out.tracks[0].trackName] });
    const s = await seat(callId, b.id);
    const before = fakeSfu().closed.length;
    await calls.leaveCall(b, { callId });
    expect(fakeSfu().closed.slice(before).some((c) => c.sessionId === s.cf_pull_session_id)).toBe(true);
  });

  it("taking someone out of the CHAT ends their seat in the live call at once and closes their media", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { conv, callId } = await callOf(a, [b, await makeUser()]);
    const out = await calls.publishTracks(a, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }] });
    await calls.subscribeTracks(b, { callId, trackNames: [out.tracks[0].trackName] });
    const s = await seat(callId, b.id);
    const before = fakeSfu().closed.length;
    await messages.removeMember(a, { conversationId: conv, userId: b.id });
    expect((await seat(callId, b.id)).left_at).not.toBeNull();
    expect(fakeSfu().closed.slice(before).some((c) => c.sessionId === s.cf_pull_session_id)).toBe(true);
    await expect(calls.heartbeat(b, { callId })).rejects.toThrow("not found");
  });

  it("deleting the chat ends its live call", async () => {
    const a = await makeUser();
    const { conv, callId } = await callOf(a, [await makeUser(), await makeUser()]);
    await messages.deleteGroup(a, conv);
    expect(await rows(sql`select 1 from chat.calls where id = ${callId} and ended_at is not null`)).toHaveLength(1);
  });
});

describe("a removed person stays out, and there is one host", () => {
  it("cannot rejoin the same call, but can join a new one", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { conv, callId } = await callOf(a, [b, await makeUser()]);
    await calls.removeParticipant(a, { callId, userId: b.id });
    await expect(calls.joinCall(b, { callId })).rejects.toThrow("removed from this call");
    await calls.endCall(a, { callId });
    const next = await calls.startCall(b, { conversationId: conv });
    await expect(calls.joinCall(b, { callId: next.callId })).resolves.toBeTruthy();
  });

  it("a starter who comes back after the host role passed on is not a second host", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { callId } = await callOf(a, [b, await makeUser()]);
    await calls.leaveCall(a, { callId });
    expect(await role(callId, b.id)).toBe("host");
    await calls.joinCall(a, { callId });
    expect(await role(callId, a.id)).toBe("attendee");
    expect(await role(callId, b.id)).toBe("host");
    await expect(calls.removeParticipant(a, { callId, userId: b.id })).rejects.toThrow("Only the host");
  });

  it("removing the host hands the role on", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const { callId } = await callOf(a, [b, c]);
    await calls.leaveCall(a, { callId });
    expect(await role(callId, b.id)).toBe("host");
    await calls.removeParticipant(b, { callId, userId: c.id });
    expect(await role(callId, b.id)).toBe("host");
  });
});

describe("channels only HR posts in", () => {
  it("an ordinary member cannot start a call there; someone who manages channels can", async () => {
    const hr = await makeUser();
    const member = await makeUser();
    const { conversationId } = await messages.createChannel(hr, { title: "Announcements", memberUserIds: [member.id, (await makeUser()).id], postingAdminsOnly: true });
    await expect(calls.startCall(member, { conversationId })).rejects.toThrow("Only HR can start a call in this channel");
    await expect(calls.startCall(member, { conversationId, canManage: false })).rejects.toThrow("Only HR");
    await expect(calls.startCall(hr, { conversationId, canManage: true })).resolves.toMatchObject({ created: true });
  });
});

describe("what the browser is told", () => {
  it("never includes other people's Cloudflare session ids", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { callId } = await callOf(a, [b, await makeUser()]);
    await calls.publishTracks(a, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }] });
    const beat = await calls.heartbeat(b, { callId });
    expect(beat.status === "ok" && beat.state.tracks.every((t) => t.cfSessionId === "")).toBe(true);
    expect(beat.status === "ok" && beat.state.tracks.length).toBeGreaterThan(0);
  });
});
