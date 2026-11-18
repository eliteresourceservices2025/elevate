import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// A Cloudflare session is ONE connection (confirmed in the Phase 4 spike), so each person gets two: one to send, one to receive.
// Pulling and answering use the receiving one; publishing uses the sending one.

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.92" }), cookies: async () => ({ get: () => undefined }) }));
vi.stubEnv("CALLS_FAKE", "1");

const { db } = await import("@/lib/db");
const messages = await import("@/modules/messages/service");
const calls = await import("@/modules/calls/service");
const { getSfu } = await import("@/modules/calls/sfu-port");

type Actor = { id: string; email: string };
let counter = 0;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

beforeAll(async () => {
  await db.execute(sql`create schema if not exists auth`);
  await db.execute(sql`create table if not exists auth.sessions (user_id uuid)`);
});

async function makeUser(): Promise<Actor> {
  const id = randomUUID();
  const email = `u${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email };
}

describe("two sessions per person", () => {
  it("joining makes a sending session and a different receiving session, and they are stored", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conv = (await messages.createGroup(a, { title: "Crew", memberUserIds: [b.id, (await makeUser()).id] })).conversationId;
    const { callId } = await calls.startCall(a, { conversationId: conv });
    const joined = await calls.joinCall(a, { callId });
    const [seat] = await rows<{ cf_session_id: string; cf_pull_session_id: string }>(sql`select cf_session_id, cf_pull_session_id from chat.call_participants where call_id = ${callId} and user_id = ${a.id} and left_at is null`);
    expect(seat.cf_session_id).toBe(joined.me.sessionId);
    expect(seat.cf_pull_session_id).toMatch(/^[0-9a-f]{32,64}$/);
    expect(seat.cf_pull_session_id).not.toBe(seat.cf_session_id);
  });

  it("pulling, answering and closing pulled tracks use the receiving session; other people's published session is what is pulled", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conv = (await messages.createGroup(a, { title: "Crew", memberUserIds: [b.id, (await makeUser()).id] })).conversationId;
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    await calls.joinCall(b, { callId });
    const published = await calls.publishTracks(a, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }] });
    await calls.subscribeTracks(b, { callId, trackNames: [published.tracks[0].trackName] });
    await calls.unsubscribeTracks(b, { callId, mids: ["0"] });
    const [seatB] = await rows<{ cf_session_id: string; cf_pull_session_id: string }>(sql`select cf_session_id, cf_pull_session_id from chat.call_participants where call_id = ${callId} and user_id = ${b.id} and left_at is null`);
    const [seatA] = await rows<{ cf_session_id: string }>(sql`select cf_session_id from chat.call_participants where call_id = ${callId} and user_id = ${a.id} and left_at is null`);
    const sfu = getSfu() as unknown as { pulled: { sessionId: string; remote: { sessionId: string }[] }[]; closed: { sessionId: string }[] };
    const mine = sfu.pulled.filter((p) => p.sessionId === seatB.cf_pull_session_id);
    expect(mine).toHaveLength(1);
    expect(mine[0].remote[0].sessionId).toBe(seatA.cf_session_id); // pulled from A's SENDING session
    expect(sfu.pulled.some((p) => p.sessionId === seatB.cf_session_id)).toBe(false); // never through B's sending session
    expect(sfu.closed.some((c) => c.sessionId === seatB.cf_pull_session_id)).toBe(true);
  });

  it("an older seat with only one session still works (it is used for both)", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const conv = (await messages.createGroup(a, { title: "Crew", memberUserIds: [b.id, (await makeUser()).id] })).conversationId;
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    await calls.joinCall(b, { callId });
    await db.execute(sql`update chat.call_participants set cf_pull_session_id = null where call_id = ${callId} and user_id = ${b.id} and left_at is null`);
    const published = await calls.publishTracks(a, { callId, offer: { type: "offer", sdp: "o" }, tracks: [{ mid: "0", kind: "audio" }] });
    await expect(calls.subscribeTracks(b, { callId, trackNames: [published.tracks[0].trackName] })).resolves.toBeTruthy();
  });
});
