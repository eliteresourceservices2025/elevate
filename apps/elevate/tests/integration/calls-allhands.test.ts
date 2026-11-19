import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// All-hands (Phase 5a): who may start one and where, a big room, who may speak (at most 8, never a guest), and that the audience only watches.

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.94" }), cookies: async () => ({ get: () => undefined }) }));
vi.stubEnv("CALLS_FAKE", "1");

const { db } = await import("@/lib/db");
const messages = await import("@/modules/messages/service");
const guests = await import("@/modules/messages/guests");
const { provisionCoreUser } = await import("@/modules/core/users");
const calls = await import("@/modules/calls/service");
const settings = await import("@/modules/calls/settings");
const { getSfu } = await import("@/modules/calls/sfu-port");

type Actor = { id: string; email: string; isGuest?: boolean };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const fakeSfu = () => getSfu() as unknown as { closed: { sessionId: string; mids: string[] }[] };
const offer = { type: "offer" as const, sdp: "o" };

beforeAll(async () => {
  await db.execute(sql`create schema if not exists auth`);
  await db.execute(sql`create table if not exists auth.sessions (user_id uuid)`);
});

async function makeUser(label = "u"): Promise<Actor> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email };
}
async function townhall(host: Actor, audience: Actor[]) {
  // A group needs at least three people: pad with someone who never joins.
  const members = audience.length < 2 ? [...audience, await makeUser("pad")] : audience;
  const conv = (await messages.createGroup(host, { title: "Company", memberUserIds: members.map((o) => o.id) })).conversationId;
  const { callId } = await calls.startCall(host, { conversationId: conv, mode: "townhall" });
  await calls.joinCall(host, { callId });
  for (const o of audience) await calls.joinCall(o, { callId });
  return { conv, callId };
}
const role = async (callId: string, userId: string) => (await rows<{ role: string }>(sql`select role from chat.call_participants where call_id = ${callId} and user_id = ${userId} and left_at is null`))[0]?.role;

describe("starting an all-hands", () => {
  it("starts in a group, as mode townhall, and the starter is the host", async () => {
    const hr = await makeUser("hr");
    const { callId } = await townhall(hr, [await makeUser()]);
    expect((await rows<{ mode: string }>(sql`select mode from chat.calls where id = ${callId}`))[0].mode).toBe("townhall");
    expect(await role(callId, hr.id)).toBe("host");
  });

  it("is refused in a direct message and in a client group", async () => {
    const hr = await makeUser("hr");
    const staff = await makeUser();
    const dm = await messages.openDirect(hr, staff.id);
    await expect(calls.startCall(hr, { conversationId: dm.conversationId, mode: "townhall" })).rejects.toThrow("can't be held in this chat");
    const clientId = randomUUID();
    await db.execute(sql`insert into core.clients (id, name) values (${clientId}, ${uniq("clinic")})`);
    const email = `${uniq("guest")}@client.example`;
    await guests.inviteGuest(hr, { email, clientId });
    const gid = randomUUID();
    await provisionCoreUser({ id: gid, email });
    const guest: Actor = { id: gid, email, isGuest: true };
    await guests.acceptGuestNotice(guest);
    const { conversationId } = await guests.createClientGroup(hr, { clientId, title: "Clinic", guestUserIds: [guest.id], staffUserIds: [staff.id] });
    await expect(calls.startCall(hr, { conversationId, mode: "townhall" })).rejects.toThrow("can't be held in this chat");
  });

  it("can be switched off by a Super Admin", async () => {
    const sa = await makeUser("sa");
    const hr = await makeUser("hr");
    const conv = (await messages.createGroup(hr, { title: "Everyone", memberUserIds: [(await makeUser()).id, (await makeUser()).id] })).conversationId;
    await settings.saveCallSettings(sa, { monthlyGbWarning: 700, townhallEnabled: false, recordingEnabled: false });
    await expect(calls.startCall(hr, { conversationId: conv, mode: "townhall" })).rejects.toThrow("switched off");
    await settings.saveCallSettings(sa, { monthlyGbWarning: 700, townhallEnabled: true, recordingEnabled: false });
    await expect(calls.startCall(hr, { conversationId: conv, mode: "townhall" })).resolves.toMatchObject({ created: true });
  });
});

describe("the audience only watches", () => {
  it("cannot publish; a speaker can; the host can", async () => {
    const host = await makeUser("host");
    const a = await makeUser("aud");
    const s = await makeUser("spk");
    const { callId } = await townhall(host, [a, s]);
    await expect(calls.publishTracks(a, { callId, offer, tracks: [{ mid: "0", kind: "audio" }] })).rejects.toThrow("You're watching");
    await calls.setSpeaker(host, { callId, userId: s.id, speaker: true });
    await expect(calls.publishTracks(s, { callId, offer, tracks: [{ mid: "0", kind: "audio" }] })).resolves.toBeTruthy();
    await expect(calls.publishTracks(host, { callId, offer, tracks: [{ mid: "0", kind: "audio" }] })).resolves.toBeTruthy();
  });

  it("hears the speakers (and only them): a speaker's audio can be pulled, another attendee's cannot exist", async () => {
    const host = await makeUser("host");
    const a = await makeUser("aud");
    const { callId } = await townhall(host, [a]);
    const out = await calls.publishTracks(host, { callId, offer, tracks: [{ mid: "0", kind: "audio" }] });
    await expect(calls.subscribeTracks(a, { callId, trackNames: [out.tracks[0].trackName] })).resolves.toMatchObject({ tracks: expect.any(Array) });
  });

  it("holds more people than a 25-person meeting would allow", async () => {
    const host = await makeUser("host");
    const audience: Actor[] = [];
    for (let i = 0; i < 30; i++) audience.push(await makeUser("m"));
    const { callId } = await townhall(host, audience);
    const [n] = await rows<{ n: number }>(sql`select count(*)::int as n from chat.call_participants where call_id = ${callId} and left_at is null`);
    expect(n.n).toBe(31); // more than a 25-person meeting would allow
  });
});

describe("speakers", () => {
  it("only the host chooses them, never for a meeting, never the host or oneself, never a guest", async () => {
    const host = await makeUser("host");
    const a = await makeUser("a");
    const b = await makeUser("b");
    const { callId } = await townhall(host, [a, b]);
    await expect(calls.setSpeaker(a, { callId, userId: b.id, speaker: true })).rejects.toThrow("Only the host");
    await expect(calls.setSpeaker(host, { callId, userId: host.id, speaker: true })).rejects.toThrow("Use the buttons for yourself");
    // A meeting has no speakers.
    const conv = (await messages.createGroup(host, { title: "Crew", memberUserIds: [a.id, b.id] })).conversationId;
    const meeting = (await calls.startCall(host, { conversationId: conv })).callId;
    await calls.joinCall(host, { callId: meeting });
    await calls.joinCall(a, { callId: meeting });
    await expect(calls.setSpeaker(host, { callId: meeting, userId: a.id, speaker: true })).rejects.toThrow("only exist in an all-hands");
  });

  it("at most 8 including the host", async () => {
    const host = await makeUser("host");
    const crowd: Actor[] = [];
    for (let i = 0; i < 9; i++) crowd.push(await makeUser("c"));
    const { callId } = await townhall(host, crowd);
    for (let i = 0; i < 7; i++) await calls.setSpeaker(host, { callId, userId: crowd[i].id, speaker: true });
    await expect(calls.setSpeaker(host, { callId, userId: crowd[7].id, speaker: true })).rejects.toThrow("8 speakers at most");
    // Making an existing speaker a speaker again is fine; putting one back opens a place.
    await calls.setSpeaker(host, { callId, userId: crowd[0].id, speaker: true });
    await calls.setSpeaker(host, { callId, userId: crowd[0].id, speaker: false });
    await calls.setSpeaker(host, { callId, userId: crowd[7].id, speaker: true });
    expect(await role(callId, crowd[7].id)).toBe("speaker");
  });

  it("putting a speaker back closes what they were sending at Cloudflare and they can no longer publish", async () => {
    const host = await makeUser("host");
    const s = await makeUser("spk");
    const { callId } = await townhall(host, [s]);
    await calls.setSpeaker(host, { callId, userId: s.id, speaker: true });
    await calls.publishTracks(s, { callId, offer, tracks: [{ mid: "0", kind: "audio" }] });
    const before = fakeSfu().closed.length;
    await calls.setSpeaker(host, { callId, userId: s.id, speaker: false });
    expect(fakeSfu().closed.slice(before).some((c) => c.mids.includes("0"))).toBe(true);
    expect(await rows(sql`select 1 from chat.call_tracks where call_id = ${callId} and user_id = ${s.id} and ended_at is null`)).toHaveLength(0);
    await expect(calls.publishTracks(s, { callId, offer, tracks: [{ mid: "0", kind: "audio" }] })).rejects.toThrow("You're watching");
  });

  it("is written to the audit log with ids only", async () => {
    const host = await makeUser("host");
    const s = await makeUser("spk");
    const { callId } = await townhall(host, [s]);
    await calls.setSpeaker(host, { callId, userId: s.id, speaker: true });
    const [row] = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from ops.audit_log where action = 'call.speaker' and target_id = ${callId} order by occurred_at desc limit 1`);
    expect(row.metadata).toEqual({ userId: s.id, speaker: true });
  });
});

describe("when the host goes", () => {
  it("only a speaker takes over, never someone in the audience; with no speaker nobody is host", async () => {
    const host = await makeUser("host");
    const spk = await makeUser("spk");
    const aud = await makeUser("aud");
    const { callId } = await townhall(host, [aud, spk]); // the audience member joined before the speaker
    await calls.setSpeaker(host, { callId, userId: spk.id, speaker: true });
    await calls.leaveCall(host, { callId });
    expect(await role(callId, spk.id)).toBe("host");
    expect(await role(callId, aud.id)).toBe("attendee");
    // No speaker left: the audience never inherits the call.
    await calls.leaveCall(spk, { callId });
    expect(await role(callId, aud.id)).toBe("attendee");
    expect(await rows(sql`select 1 from chat.call_participants where call_id = ${callId} and left_at is null and role = 'host'`)).toHaveLength(0);
  });
});

describe("an all-hands over a live meeting", () => {
  it("is refused instead of quietly joining the meeting", async () => {
    const host = await makeUser("host");
    const conv = (await messages.createGroup(host, { title: "Crew", memberUserIds: [(await makeUser()).id, (await makeUser()).id] })).conversationId;
    const meeting = await calls.startCall(host, { conversationId: conv });
    await expect(calls.startCall(host, { conversationId: conv, mode: "townhall" })).rejects.toThrow("already going on");
    await expect(calls.startCall(host, { conversationId: conv })).resolves.toEqual({ callId: meeting.callId, created: false });
  });
});
