import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Real-database tests for the call lifecycle with the fake media server (CALLS_FAKE=1): who may start and join, one live call per chat,
// the 25-person limit, seats and heartbeats, publishing and pulling rules, and how a call ends (and what the chat is told).

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.90" }), cookies: async () => ({ get: () => undefined }) }));
vi.stubEnv("CALLS_FAKE", "1");

const { db } = await import("@/lib/db");
const { provisionCoreUser } = await import("@/modules/core/users");
const messages = await import("@/modules/messages/service");
const guests = await import("@/modules/messages/guests");
const calls = await import("@/modules/calls/service");

type Actor = { id: string; email: string; isGuest?: boolean };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

beforeAll(async () => {
  await db.execute(sql`create schema if not exists auth`);
  await db.execute(sql`create table if not exists auth.sessions (user_id uuid)`);
});

async function makeUser(label: string): Promise<Actor> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email };
}
async function group(creator: Actor, others: Actor[]) {
  return (await messages.createGroup(creator, { title: "Crew", memberUserIds: others.map((o) => o.id) })).conversationId;
}
async function clientGroupWithGuest(hr: Actor, staff: Actor) {
  const clientId = randomUUID();
  await db.execute(sql`insert into core.clients (id, name) values (${clientId}, ${uniq("clinic")})`);
  const email = `${uniq("guest")}@client.example`;
  await guests.inviteGuest(hr, { email, clientId });
  const id = randomUUID();
  await provisionCoreUser({ id, email });
  const guest: Actor = { id, email, isGuest: true };
  await guests.acceptGuestNotice(guest);
  const { conversationId } = await guests.createClientGroup(hr, { clientId, title: "Clinic", guestUserIds: [guest.id], staffUserIds: [staff.id] });
  return { guest, conversationId };
}
const systemLines = async (conversationId: string) => (await rows<{ n: number }>(sql`select count(*)::int as n from chat.messages where conversation_id = ${conversationId} and kind = 'system'`))[0].n;
const live = async (conversationId: string) => (await rows(sql`select 1 from chat.calls where conversation_id = ${conversationId} and ended_at is null`)).length;

describe("starting a call", () => {
  it("a member starts one; starting again returns the same live call; outsiders and guests cannot start", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const outsider = await makeUser("o");
    const conv = await group(a, [b, c]);
    const first = await calls.startCall(a, { conversationId: conv });
    expect(first.created).toBe(true);
    expect(await calls.startCall(b, { conversationId: conv })).toEqual({ callId: first.callId, created: false });
    await expect(calls.startCall(outsider, { conversationId: conv })).rejects.toThrow("not found");
    await expect(calls.startCall({ ...a, isGuest: true }, { conversationId: conv })).rejects.toThrow("can't start");
    expect(await live(conv)).toBe(1);
    const audit = await rows(sql`select 1 from ops.audit_log where action = 'call.start' and target_id = ${first.callId}`);
    expect(audit).toHaveLength(1);
  });
});

describe("joining", () => {
  it("takes a seat with a media session and relay servers; members see each other; the starter is host", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const conv = await group(a, [b, await makeUser("c")]);
    const { callId } = await calls.startCall(a, { conversationId: conv });
    const joinedA = await calls.joinCall(a, { callId });
    const joinedB = await calls.joinCall(b, { callId });
    expect(joinedA.me.role).toBe("host");
    expect(joinedB.me.role).toBe("attendee");
    expect(joinedB.me.sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(joinedB.iceServers.length).toBeGreaterThan(0);
    expect(joinedB.participants.map((p) => p.userId).sort()).toEqual([a.id, b.id].sort());
    expect(joinedB.call.mode).toBe("meeting");
  });

  it("refuses outsiders, an ended call, and removed members; a guest only joins a client group's call", async () => {
    const hr = await makeUser("hr");
    const staff = await makeUser("s");
    const outsider = await makeUser("o");
    const { guest, conversationId } = await clientGroupWithGuest(hr, staff);
    const { callId } = await calls.startCall(staff, { conversationId });
    await expect(calls.joinCall(outsider, { callId })).rejects.toThrow("not found");
    const joined = await calls.joinCall(guest, { callId });
    expect(joined.participants.some((p) => p.userId === guest.id)).toBe(true);
    // A guest cannot join a staff group's call even by id.
    const plain = await group(staff, [await makeUser("x"), await makeUser("y")]);
    const staffCall = await calls.startCall(staff, { conversationId: plain });
    await expect(calls.joinCall(guest, { callId: staffCall.callId })).rejects.toThrow("not found");
    // A guest who has not accepted the notice gets nothing.
    await db.execute(sql`update chat.guests set notice_accepted_at = null where user_id = ${guest.id}`);
    await expect(calls.joinCall(guest, { callId })).rejects.toThrow("Accept the guest notice");
    await db.execute(sql`update chat.guests set notice_accepted_at = now() where user_id = ${guest.id}`);
    await calls.leaveCall(staff, { callId }).catch(() => {});
    await calls.endCall(staff, { callId }).catch(() => {});
    await expect(calls.joinCall(guest, { callId })).rejects.toThrow("ended");
  });

  it("stops at 25 people in a meeting, and joining again replaces your own seat instead of taking a second", async () => {
    const a = await makeUser("a");
    const members = await Promise.all(Array.from({ length: 26 }, (_, i) => makeUser(`m${i}`)));
    const conv = await group(a, members.slice(0, 26));
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    for (const m of members.slice(0, 24)) await calls.joinCall(m, { callId });
    await expect(calls.joinCall(members[24], { callId })).rejects.toThrow("full");
    const before = (await rows<{ n: number }>(sql`select count(*)::int as n from chat.call_participants where call_id = ${callId} and left_at is null`))[0].n;
    expect(before).toBe(25);
    await calls.joinCall(members[0], { callId });
    expect((await rows<{ n: number }>(sql`select count(*)::int as n from chat.call_participants where call_id = ${callId} and left_at is null`))[0].n).toBe(25);
  });
});

describe("heartbeat and silent seats", () => {
  it("reports the roster, and a seat silent for over 90 seconds is treated as left; an empty call ends", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const conv = await group(a, [b, await makeUser("c")]);
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    await calls.joinCall(b, { callId });
    const beat = await calls.heartbeat(a, { callId });
    expect(beat.status).toBe("ok");
    await db.execute(sql`update chat.call_participants set last_seen_at = now() - interval '5 minutes' where call_id = ${callId} and user_id = ${b.id}`);
    const after = await calls.heartbeat(a, { callId });
    expect(after.status === "ok" && after.state.participants.map((p) => p.userId)).toEqual([a.id]);
    await db.execute(sql`update chat.call_participants set last_seen_at = now() - interval '5 minutes' where call_id = ${callId} and user_id = ${a.id}`);
    const lines = await systemLines(conv);
    expect(await calls.heartbeat(b, { callId })).toEqual({ status: "ended" });
    expect(await live(conv)).toBe(0);
    expect(await systemLines(conv)).toBeGreaterThan(lines);
    expect(await calls.heartbeat(b, { callId })).toEqual({ status: "ended" });
  });

  it("tells a person who is no longer in the chat that the call is not theirs", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const conv = await group(a, [b, await makeUser("c")]);
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(b, { callId });
    await messages.removeMember(a, { conversationId: conv, userId: b.id });
    await expect(calls.heartbeat(b, { callId })).rejects.toThrow("not found");
    await expect(calls.publishTracks(b, { callId, offer: { type: "offer", sdp: "x" }, tracks: [{ mid: "0", kind: "audio" }] })).rejects.toThrow("not found");
  });
});

describe("media steps", () => {
  async function twoInACall() {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const conv = await group(a, [b, await makeUser("c")]);
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    await calls.joinCall(b, { callId });
    return { a, b, conv, callId };
  }

  it("publishing names the tracks on the server, lists them for others, and caps how many one person can have", async () => {
    const { a, b, callId } = await twoInACall();
    const out = await calls.publishTracks(a, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }, { mid: "1", kind: "video" }] });
    expect(out.answer.type).toBe("answer");
    expect(out.tracks.map((t) => t.kind)).toEqual(["audio", "video"]);
    for (const t of out.tracks) expect(t.trackName).toMatch(/^(audio|video)-[A-Za-z0-9]+$/);
    const beat = await calls.heartbeat(b, { callId });
    expect(beat.status === "ok" && beat.state.tracks.map((t) => t.kind).sort()).toEqual(["audio", "video"]);
    await expect(calls.publishTracks(a, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "2", kind: "screen" }, { mid: "3", kind: "screen" }, { mid: "4", kind: "screen" }] })).rejects.toThrow("Too many");
  });

  it("subscribing works for someone else's live tracks only: not your own, not made-up names, not after they stop or leave", async () => {
    const { a, b, callId } = await twoInACall();
    const out = await calls.publishTracks(a, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }, { mid: "1", kind: "video" }] });
    const [audio, video] = out.tracks;
    const pulled = await calls.subscribeTracks(b, { callId, trackNames: [audio.trackName, video.trackName] });
    expect(pulled.offer.type).toBe("offer");
    expect(pulled.tracks).toHaveLength(2);
    await expect(calls.subscribeTracks(a, { callId, trackNames: [audio.trackName] })).rejects.toThrow("Nothing to watch");
    await expect(calls.subscribeTracks(b, { callId, trackNames: ["audio-doesnotexist"] })).rejects.toThrow("Nothing to watch");
    await calls.closeTracks(a, { callId, trackNames: [video.trackName] });
    await expect(calls.subscribeTracks(b, { callId, trackNames: [video.trackName] })).rejects.toThrow("Nothing to watch");
    await calls.leaveCall(a, { callId });
    await expect(calls.subscribeTracks(b, { callId, trackNames: [audio.trackName] })).rejects.toThrow("Nothing to watch");
  });

  it("a track from another call can never be pulled", async () => {
    const one = await twoInACall();
    const two = await twoInACall();
    const published = await calls.publishTracks(one.a, { callId: one.callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }] });
    await expect(calls.subscribeTracks(two.b, { callId: two.callId, trackNames: [published.tracks[0].trackName] })).rejects.toThrow("Nothing to watch");
    await expect(calls.subscribeTracks(two.b, { callId: one.callId, trackNames: [published.tracks[0].trackName] })).rejects.toThrow("not found");
  });
});

describe("ending", () => {
  it("the last person out ends the call, writes the line, and records a usage estimate; a call with two people is not 'missed'", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const conv = await group(a, [b, await makeUser("c")]);
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    await calls.joinCall(b, { callId });
    await calls.leaveCall(a, { callId });
    expect(await live(conv)).toBe(1);
    await calls.leaveCall(b, { callId });
    expect(await live(conv)).toBe(0);
    const [ended] = await rows<{ end_reason: string }>(sql`select end_reason from chat.calls where id = ${callId}`);
    expect(ended.end_reason).toBe("empty");
    expect(await rows(sql`select 1 from chat.call_usage where call_id = ${callId}`)).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.notifications where kind = 'chat.call' and user_id = ${b.id}`)).toHaveLength(0);
  });

  it("a call nobody answered is a missed call: the others are notified", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const conv = await group(a, [b, await makeUser("c")]);
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    await calls.leaveCall(a, { callId });
    expect(await rows(sql`select 1 from ops.notifications where kind = 'chat.call' and user_id = ${b.id} and link = ${`/messages/${conv}`}`)).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.notifications where kind = 'chat.call' and user_id = ${a.id}`)).toHaveLength(0);
  });

  it("only the host ends it for everyone", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const conv = await group(a, [b, await makeUser("c")]);
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    await calls.joinCall(b, { callId });
    await expect(calls.endCall(b, { callId })).rejects.toThrow("Only the person who started");
    await calls.endCall(a, { callId });
    expect(await live(conv)).toBe(0);
    expect(await rows(sql`select 1 from chat.call_participants where call_id = ${callId} and left_at is null`)).toHaveLength(0);
  });

  it("the cleanup ends a call whose chat was deleted", async () => {
    const a = await makeUser("a");
    const conv = await group(a, [await makeUser("b"), await makeUser("c")]);
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    await messages.deleteGroup(a, conv).catch(() => {});
    await db.execute(sql`update chat.conversations set archived_at = now() where id = ${conv}`);
    expect(await calls.endAbandonedCalls()).toBeGreaterThanOrEqual(1);
    expect(await live(conv)).toBe(0);
  });
});

describe("what a chat shows", () => {
  it("a live call banner knows who started it, how many are in, and whether I am in; muted chats do not ring", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const conv = await group(a, [b, await makeUser("c")]);
    expect(await calls.getLiveCall(b, { conversationId: conv })).toBeNull();
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    const seen = await calls.getLiveCall(b, { conversationId: conv });
    expect(seen).toMatchObject({ callId, participantCount: 1, iAmIn: false });
    expect(await calls.incomingCall(b, { callId })).toMatchObject({ callId });
    expect(await calls.incomingCall(a, { callId })).toBeNull();
    await db.execute(sql`update chat.conversation_members set muted_until = now() + interval '1 hour' where conversation_id = ${conv} and user_id = ${b.id}`);
    expect(await calls.incomingCall(b, { callId })).toBeNull();
    await expect(calls.getLiveCall(await makeUser("o"), { conversationId: conv })).rejects.toThrow("not found");
  });
});
