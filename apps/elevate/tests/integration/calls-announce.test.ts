import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

// A call is announced (ring, banner, "Call started" line) only once its starter has really joined; a call nobody ever joined says nothing.

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.96" }), cookies: async () => ({ get: () => undefined }) }));
vi.stubEnv("CALLS_FAKE", "1");

const { db } = await import("@/lib/db");
const messages = await import("@/modules/messages/service");
const calls = await import("@/modules/calls/service");

type Actor = { id: string; email: string };
let counter = 0;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

beforeAll(async () => {
  await db.execute(sql`create schema if not exists auth`);
  await db.execute(sql`create table if not exists auth.sessions (user_id uuid)`);
});

async function makeUser(): Promise<Actor> {
  const id = randomUUID();
  const email = `an${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email };
}
const systemLines = async (conversationId: string) => (await rows<{ n: number }>(sql`select count(*)::int as n from chat.messages where conversation_id = ${conversationId} and kind = 'system'`))[0].n;
async function group() {
  const a = await makeUser();
  const b = await makeUser();
  const c = await makeUser();
  const conv = (await messages.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] })).conversationId;
  return { a, b, c, conv };
}

describe("before the starter has joined", () => {
  it("nobody else is offered the call, and no line is posted", async () => {
    const { a, b, conv } = await group();
    const { callId } = await calls.startCall(a, { conversationId: conv });
    expect(await calls.getLiveCall(b, { conversationId: conv })).toBeNull();
    expect(await calls.incomingCall(b, { callId })).toBeNull();
    expect(await calls.ringingCalls(b)).toEqual([]);
    expect(await systemLines(conv)).toBe(0);
    // The starter still sees their own call (and a second press of "Start a call" finds it).
    expect(await calls.getLiveCall(a, { conversationId: conv })).toMatchObject({ callId });
    await expect(calls.startCall(a, { conversationId: conv })).resolves.toEqual({ callId, created: false });
  });

  it("a call whose starter never joins ends quietly: no 'Missed call' line, no notice", async () => {
    const { a, b, conv } = await group();
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await db.execute(sql`update chat.calls set started_at = now() - interval '5 minutes' where id = ${callId}`);
    expect(await calls.endAbandonedCalls()).toBeGreaterThanOrEqual(1);
    expect(await rows(sql`select 1 from chat.calls where id = ${callId} and ended_at is not null`)).toHaveLength(1);
    expect(await systemLines(conv)).toBe(0);
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${b.id} and kind = 'chat.call'`)).toHaveLength(0);
  });
});

describe("once the starter has joined", () => {
  it("the others are offered it, it is ringing for them (not for the starter), and the chat says so", async () => {
    const { a, b, c, conv } = await group();
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    expect(await systemLines(conv)).toBe(1);
    expect(await calls.getLiveCall(b, { conversationId: conv })).toMatchObject({ callId, participantCount: 1, iAmIn: false });
    expect((await calls.ringingCalls(b)).map((r) => r.callId)).toEqual([callId]);
    expect((await calls.ringingCalls(c)).map((r) => r.callId)).toEqual([callId]);
    expect(await calls.ringingCalls(a)).toEqual([]); // the starter is in it
    // Joining makes it stop ringing for that person; rejoining does not announce again.
    await calls.joinCall(b, { callId });
    expect(await calls.ringingCalls(b)).toEqual([]);
    await calls.joinCall(a, { callId });
    expect(await systemLines(conv)).toBe(1);
  });

  it("stops ringing after 45 seconds, and never for someone who muted the chat", async () => {
    const { a, b, c, conv } = await group();
    const { callId } = await calls.startCall(a, { conversationId: conv });
    await calls.joinCall(a, { callId });
    await db.execute(sql`update chat.conversation_members set muted_until = now() + interval '1 hour' where conversation_id = ${conv} and user_id = ${c.id}`);
    expect(await calls.ringingCalls(c)).toEqual([]);
    expect((await calls.ringingCalls(b)).length).toBe(1);
    await db.execute(sql`update chat.calls set started_at = now() - interval '50 seconds' where id = ${callId}`);
    expect(await calls.ringingCalls(b)).toEqual([]);
  });
});
