import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// Host controls (4c): mute and remove, host handover (never to a guest), and a person closing video they stopped watching.

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.91" }), cookies: async () => ({ get: () => undefined }) }));
vi.stubEnv("CALLS_FAKE", "1");

const { db } = await import("@/lib/db");
const { provisionCoreUser } = await import("@/modules/core/users");
const messages = await import("@/modules/messages/service");
const guests = await import("@/modules/messages/guests");
const calls = await import("@/modules/calls/service");
const { createFakeSfu } = await import("@/modules/calls/sfu-port");
void createFakeSfu;

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
async function callOf(host: Actor, others: Actor[]) {
  const conv = (await messages.createGroup(host, { title: "Crew", memberUserIds: others.map((o) => o.id) })).conversationId;
  const { callId } = await calls.startCall(host, { conversationId: conv });
  await calls.joinCall(host, { callId });
  for (const o of others) await calls.joinCall(o, { callId });
  return { conv, callId };
}
const role = async (callId: string, userId: string) => (await rows<{ role: string }>(sql`select role from chat.call_participants where call_id = ${callId} and user_id = ${userId} and left_at is null`))[0]?.role;

describe("mute and remove", () => {
  it("only the host may, never on themself; mute ends their audio but not their video and they can unmute", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { callId } = await callOf(a, [b, c]);
    const audio = (await calls.publishTracks(b, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }, { mid: "1", kind: "video" }] })).tracks;
    await expect(calls.muteParticipant(c, { callId, userId: b.id })).rejects.toThrow("Only the host");
    await expect(calls.removeParticipant(c, { callId, userId: b.id })).rejects.toThrow("Only the host");
    await expect(calls.muteParticipant(a, { callId, userId: a.id })).rejects.toThrow("yourself");
    await calls.muteParticipant(a, { callId, userId: b.id });
    const live = await rows<{ kind: string }>(sql`select kind from chat.call_tracks where call_id = ${callId} and user_id = ${b.id} and ended_at is null`);
    expect(live.map((t) => t.kind)).toEqual(["video"]);
    expect(audio.find((t) => t.kind === "audio")).toBeTruthy();
    await expect(calls.publishTracks(b, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "2", kind: "audio" }] })).resolves.toBeTruthy();
    expect(await rows(sql`select 1 from ops.audit_log where action = 'call.mute' and target_id = ${callId}`)).toHaveLength(1);
  });

  it("remove takes the seat and the tracks; the person's next heartbeat says they were removed; the others stay", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { callId } = await callOf(a, [b, c]);
    await calls.publishTracks(b, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }] });
    await calls.removeParticipant(a, { callId, userId: b.id });
    expect(await calls.heartbeat(b, { callId })).toEqual({ status: "removed" });
    expect(await rows(sql`select 1 from chat.call_tracks where call_id = ${callId} and user_id = ${b.id} and ended_at is null`)).toHaveLength(0);
    const beat = await calls.heartbeat(c, { callId });
    expect(beat.status === "ok" && beat.state.participants.map((p) => p.userId).sort()).toEqual([a.id, c.id].sort());
    await expect(calls.removeParticipant(a, { callId, userId: b.id })).rejects.toThrow("isn't in the call");
    expect(await rows(sql`select 1 from ops.audit_log where action = 'call.remove' and target_id = ${callId}`)).toHaveLength(1);
  });

  it("a removed person can't pull anyone's tracks", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { callId } = await callOf(a, [b, await makeUser("c")]);
    const out = await calls.publishTracks(a, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }] });
    await calls.removeParticipant(a, { callId, userId: b.id });
    await expect(calls.subscribeTracks(b, { callId, trackNames: [out.tracks[0].trackName] })).rejects.toThrow("Join the call first");
  });
});

describe("host handover", () => {
  it("passes to the person who has been there longest when the host leaves, and the new host can end the call", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { callId } = await callOf(a, [b, c]);
    await calls.leaveCall(a, { callId });
    expect(await role(callId, b.id)).toBe("host");
    expect(await role(callId, c.id)).toBe("attendee");
    await calls.endCall(b, { callId });
    expect(await rows(sql`select 1 from chat.calls where id = ${callId} and ended_at is not null`)).toHaveLength(1);
  });

  it("never passes to a client guest", async () => {
    const hr = await makeUser("hr");
    const staff = await makeUser("s");
    const clientId = randomUUID();
    await db.execute(sql`insert into core.clients (id, name) values (${clientId}, ${uniq("clinic")})`);
    const email = `${uniq("guest")}@client.example`;
    await guests.inviteGuest(hr, { email, clientId });
    const gid = randomUUID();
    await provisionCoreUser({ id: gid, email });
    const guest: Actor = { id: gid, email, isGuest: true };
    await guests.acceptGuestNotice(guest);
    const { conversationId } = await guests.createClientGroup(hr, { clientId, title: "Clinic", guestUserIds: [guest.id], staffUserIds: [staff.id] });
    const { callId } = await calls.startCall(staff, { conversationId });
    await calls.joinCall(staff, { callId });
    await calls.joinCall(guest, { callId });
    await calls.leaveCall(staff, { callId });
    expect(await role(callId, guest.id)).toBe("attendee");
    await expect(calls.endCall(guest, { callId })).rejects.toThrow("Only the host");
    await expect(calls.removeParticipant(guest, { callId, userId: staff.id })).rejects.toThrow();
    // A staff member joining later becomes host (the starter rule no longer applies, but a host is needed): rejoining as the starter does.
    await calls.joinCall(staff, { callId });
    expect(await role(callId, staff.id)).toBe("host");
  });
});

describe("closing video you stopped watching", () => {
  it("only needs a seat, and never fails the call if Cloudflare says no", async () => {
    const a = await makeUser("a");
    const { callId } = await callOf(a, [await makeUser("b"), await makeUser("c")]);
    await expect(calls.unsubscribeTracks(a, { callId, mids: ["3", "4"] })).resolves.toBeUndefined();
    await expect(calls.unsubscribeTracks(await makeUser("o"), { callId, mids: ["3"] })).rejects.toThrow("not found");
  });
});
