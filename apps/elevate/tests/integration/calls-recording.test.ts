import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FakeStorage } from "./fake-storage";

// Recording (Phase 5b): the rules that refuse it, consent (a yes first, a changed mind counts), the pieces (checked by their bytes, in order),
// when it ends, who may watch, and the 30-day deletion.

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.95" }), cookies: async () => ({ get: () => undefined }) }));
vi.stubEnv("CALLS_FAKE", "1");

const { db } = await import("@/lib/db");
const messages = await import("@/modules/messages/service");
const guests = await import("@/modules/messages/guests");
const { provisionCoreUser } = await import("@/modules/core/users");
const calls = await import("@/modules/calls/service");
const recording = await import("@/modules/calls/recording");
const settings = await import("@/modules/calls/settings");
const { setDocumentStorage, BUCKETS } = await import("@/modules/documents/storage");

type Actor = { id: string; email: string; isGuest?: boolean };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const fake = new FakeStorage();
setDocumentStorage(fake);
const EBML = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const CLUSTER = new Uint8Array([0x1f, 0x43, 0xb6, 0x75, 9, 9]);

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
const setRecording = (on: boolean) => settings.saveCallSettings({ id: randomUUID(), email: "sa@example.com" }, { monthlyGbWarning: 700, townhallEnabled: true, recordingEnabled: on });
async function callOf(host: Actor, others: Actor[]) {
  const conv = (await messages.createGroup(host, { title: "Crew", memberUserIds: others.map((o) => o.id) })).conversationId;
  const { callId } = await calls.startCall(host, { conversationId: conv });
  await calls.joinCall(host, { callId });
  for (const o of others) await calls.joinCall(o, { callId });
  return { conv, callId };
}
const stateOf = async (actor: Actor, callId: string) => {
  const beat = await calls.heartbeat(actor, { callId });
  if (beat.status !== "ok") throw new Error(`call is ${beat.status}`);
  return beat.state;
};
async function upload(actor: Actor, recordingId: string, seq: number, bytes: Uint8Array) {
  const ticket = await recording.requestRecordingPart(actor, { recordingId, seq });
  fake.put(ticket.bucket, ticket.path, bytes);
  return recording.finalizeRecordingPart(actor, { recordingId, seq });
}
const recOf = async (callId: string) => (await rows<{ id: string; ended_at: Date | null; end_reason: string | null; expires_at: Date | null; size_bytes: string; deleted_at: Date | null }>(sql`select id, ended_at, end_reason, expires_at, size_bytes, deleted_at from chat.call_recordings where call_id = ${callId} order by started_at desc limit 1`))[0];
async function readAll(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const out: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.push(...value);
  }
  return Uint8Array.from(out);
}

describe("when recording is refused", () => {
  it("when the company switch is off (the default)", async () => {
    await setRecording(false);
    const a = await makeUser("rec");
    const { callId } = await callOf(a, [await makeUser(), await makeUser()]);
    await expect(recording.startRecording(a, { callId })).rejects.toThrow("Recording is switched off");
  });

  it("in a client group, even with only staff in it, and for someone who is not in the call", async () => {
    await setRecording(true);
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
    await expect(recording.startRecording(staff, { callId })).rejects.toThrow("never recorded");
    await calls.joinCall(guest, { callId });
    await expect(recording.startRecording(staff, { callId })).rejects.toThrow();
    await expect(recording.startRecording(guest, { callId })).rejects.toThrow("can't record");
    const outsider = await makeUser("out");
    await expect(recording.startRecording(outsider, { callId })).rejects.toThrow("not found");
  });

  it("while a recording is already running", async () => {
    await setRecording(true);
    const a = await makeUser("rec");
    const b = await makeUser();
    const { callId } = await callOf(a, [b, await makeUser()]);
    await recording.startRecording(a, { callId });
    await expect(recording.startRecording(b, { callId })).rejects.toThrow("already being recorded");
  });
});

describe("consent", () => {
  it("nobody is included before a yes; a yes adds them; a changed mind removes them again", async () => {
    await setRecording(true);
    const a = await makeUser("rec");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { callId } = await callOf(a, [b, c]);
    await recording.startRecording(a, { callId });
    let st = await stateOf(a, callId);
    expect(st.recording?.allowedUserIds).toEqual([a.id]); // only the person recording, who agreed by starting it
    expect((await stateOf(b, callId)).recording).toMatchObject({ myAnswer: null, allowedUserIds: [], recorderUserId: a.id });
    await recording.answerRecordingConsent(b, { callId, answer: "allow" });
    await recording.answerRecordingConsent(c, { callId, answer: "decline" });
    st = await stateOf(a, callId);
    expect([...(st.recording?.allowedUserIds ?? [])].sort()).toEqual([a.id, b.id].sort());
    expect((await stateOf(c, callId)).recording?.myAnswer).toBe("decline");
    await recording.answerRecordingConsent(b, { callId, answer: "decline" });
    expect((await stateOf(a, callId)).recording?.allowedUserIds).toEqual([a.id]);
    await recording.answerRecordingConsent(c, { callId, answer: "allow" });
    expect((await stateOf(a, callId)).recording?.allowedUserIds).toContain(c.id);
  });

  it("people who leave are no longer listed, and the answers can't be edited or removed", async () => {
    await setRecording(true);
    const a = await makeUser("rec");
    const b = await makeUser("b");
    const { callId } = await callOf(a, [b, await makeUser()]);
    await recording.startRecording(a, { callId });
    await recording.answerRecordingConsent(b, { callId, answer: "allow" });
    await calls.leaveCall(b, { callId });
    expect((await stateOf(a, callId)).recording?.allowedUserIds).toEqual([a.id]);
    await expect(db.execute(sql`update chat.recording_consents set answer = 'decline'`)).rejects.toThrow();
    await expect(db.execute(sql`delete from chat.recording_consents`)).rejects.toThrow();
  });

  it("answering with nothing being recorded says so", async () => {
    const a = await makeUser("rec");
    const { callId } = await callOf(a, [await makeUser(), await makeUser()]);
    await expect(recording.answerRecordingConsent(a, { callId, answer: "allow" })).rejects.toThrow("Nothing is being recorded");
  });
});

describe("the pieces", () => {
  async function started() {
    await setRecording(true);
    const a = await makeUser("rec");
    const b = await makeUser("b");
    const { callId } = await callOf(a, [b, await makeUser()]);
    const { recordingId } = await recording.startRecording(a, { callId });
    return { a, b, callId, recordingId };
  }

  it("are kept in order, checked by their bytes, and counted", async () => {
    const { a, recordingId, callId } = await started();
    await expect(recording.requestRecordingPart(a, { recordingId, seq: 1 })).rejects.toThrow("in order");
    expect(await upload(a, recordingId, 0, EBML)).toEqual({ sizeBytes: EBML.length });
    await upload(a, recordingId, 1, CLUSTER);
    expect(Number((await recOf(callId)).size_bytes)).toBe(EBML.length + CLUSTER.length);
    await expect(recording.requestRecordingPart(a, { recordingId, seq: 1 })).rejects.toThrow("already stored");
  });

  it("the first piece must really be a WebM file; a bad one is deleted and can be sent again", async () => {
    const { a, recordingId } = await started();
    const bad = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2]); // a PDF
    const ticket = await recording.requestRecordingPart(a, { recordingId, seq: 0 });
    fake.put(ticket.bucket, ticket.path, bad);
    await expect(recording.finalizeRecordingPart(a, { recordingId, seq: 0 })).rejects.toThrow("isn't a recording");
    expect(await fake.read(BUCKETS.calls, ticket.path)).toBeNull();
    await expect(upload(a, recordingId, 0, EBML)).resolves.toBeTruthy();
  });

  it("an upload that never arrived, or an empty one, is refused", async () => {
    const { a, recordingId } = await started();
    await recording.requestRecordingPart(a, { recordingId, seq: 0 });
    await expect(recording.finalizeRecordingPart(a, { recordingId, seq: 0 })).rejects.toThrow("did not arrive");
  });

  it("only the person recording may send pieces", async () => {
    const { b, recordingId } = await started();
    await expect(recording.requestRecordingPart(b, { recordingId, seq: 0 })).rejects.toThrow("not found");
    await expect(recording.finalizeRecordingPart(b, { recordingId, seq: 0 })).rejects.toThrow("not found");
  });

  it("the last piece may arrive for a few minutes after it ends, not much later", async () => {
    const { a, recordingId, callId } = await started();
    await upload(a, recordingId, 0, EBML);
    await recording.stopRecording(a, { callId });
    await expect(upload(a, recordingId, 1, CLUSTER)).resolves.toBeTruthy();
    await db.execute(sql`update chat.call_recordings set ended_at = now() - interval '11 minutes' where id = ${recordingId}`);
    await expect(recording.requestRecordingPart(a, { recordingId, seq: 2 })).rejects.toThrow("not found");
  });
});

describe("when it ends", () => {
  it("the recorder or the host stops it, nobody else; it is kept 30 days", async () => {
    await setRecording(true);
    const a = await makeUser("rec");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { callId } = await callOf(a, [b, c]);
    const { recordingId } = await recording.startRecording(b, { callId });
    await expect(recording.stopRecording(c, { callId })).rejects.toThrow("Only the person recording or the host");
    await recording.stopRecording(a, { callId }); // a is the host
    const rec = await recOf(callId);
    expect(rec.id).toBe(recordingId);
    expect(rec.end_reason).toBe("stopped");
    const days = (new Date(rec.expires_at!).getTime() - new Date(rec.ended_at!).getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    // Nothing live now: a new one may start.
    await expect(recording.startRecording(c, { callId })).resolves.toBeTruthy();
  });

  it("when the person recording leaves, or the call ends", async () => {
    await setRecording(true);
    const a = await makeUser("rec");
    const b = await makeUser("b");
    const { callId } = await callOf(a, [b, await makeUser()]);
    await recording.startRecording(b, { callId });
    await calls.leaveCall(b, { callId });
    expect((await recOf(callId)).end_reason).toBe("recorder_left");
    await recording.startRecording(a, { callId });
    await calls.endCall(a, { callId });
    expect((await recOf(callId)).end_reason).toBe("call_ended");
  });

  it("is audited with ids and reasons only", async () => {
    await setRecording(true);
    const a = await makeUser("rec");
    const { callId } = await callOf(a, [await makeUser(), await makeUser()]);
    const { recordingId } = await recording.startRecording(a, { callId });
    await recording.stopRecording(a, { callId });
    const logged = await rows<{ action: string; metadata: Record<string, unknown> }>(sql`select action, metadata from ops.audit_log where target_id = ${recordingId} order by id`);
    expect(logged.map((l) => l.action)).toEqual(["call.recording.start", "call.recording.stop"]);
    expect(logged[1].metadata).toEqual({ callId, reason: "stopped" });
  });
});

describe("watching", () => {
  async function finished() {
    await setRecording(true);
    const a = await makeUser("rec");
    const b = await makeUser("b");
    const { callId } = await callOf(a, [b, await makeUser()]);
    const { recordingId } = await recording.startRecording(a, { callId });
    await upload(a, recordingId, 0, EBML);
    await upload(a, recordingId, 1, CLUSTER);
    return { a, b, callId, recordingId };
  }

  it("plays the pieces in order to people who were in the call, and every play is audited", async () => {
    const { a, b, callId, recordingId } = await finished();
    await expect(recording.openRecording(b, recordingId)).rejects.toThrow("not found"); // still being recorded
    await recording.stopRecording(a, { callId });
    const bytes = await readAll(await recording.openRecording(b, recordingId));
    expect([...bytes]).toEqual([...EBML, ...CLUSTER]);
    expect(await rows(sql`select 1 from ops.audit_log where action = 'call.recording.play' and target_id = ${recordingId}`)).toHaveLength(1);
    expect((await recording.listMyRecordings(b)).map((r) => r.id)).toContain(recordingId);
  });

  it("is not available to people who were not in the call, or to a guest", async () => {
    const { a, callId, recordingId } = await finished();
    await recording.stopRecording(a, { callId });
    const outsider = await makeUser("out");
    await expect(recording.openRecording(outsider, recordingId)).rejects.toThrow("not found");
    expect(await recording.listMyRecordings(outsider)).toEqual([]);
    await expect(recording.openRecording({ ...a, isGuest: true }, recordingId)).rejects.toThrow("not found");
    expect(await recording.listMyRecordings({ ...a, isGuest: true })).toEqual([]);
  });

  it("is only for people who were in the call while it was recorded", async () => {
    const { a, callId, recordingId } = await finished();
    const early = await makeUser("early");
    const late = await makeUser("late");
    // early: sat in the call but left before the recording began. late: arrived after it ended.
    await db.execute(sql`insert into chat.call_participants (call_id, user_id, role, cf_session_id, joined_at, left_at) values (${callId}, ${early.id}, 'attendee', 'x', now() - interval '2 hours', now() - interval '1 hour')`);
    await db.execute(sql`update chat.call_recordings set started_at = now() - interval '30 minutes' where id = ${recordingId}`);
    await recording.stopRecording(a, { callId });
    await db.execute(sql`insert into chat.call_participants (call_id, user_id, role, cf_session_id, joined_at) values (${callId}, ${late.id}, 'attendee', 'y', now() + interval '1 hour')`);
    await expect(recording.openRecording(early, recordingId)).rejects.toThrow("not found");
    await expect(recording.openRecording(late, recordingId)).rejects.toThrow("not found");
    expect(await recording.listMyRecordings(early)).toEqual([]);
    expect(await recording.listMyRecordings(late)).toEqual([]);
    await expect(recording.openRecording(a, recordingId)).resolves.toBeTruthy();
  });

  it("is not for someone the host removed", async () => {
    const { a, b, callId, recordingId } = await finished();
    await calls.removeParticipant(a, { callId, userId: b.id });
    await recording.stopRecording(a, { callId });
    await expect(recording.openRecording(b, recordingId)).rejects.toThrow("not found");
  });

  it("is gone after it expires", async () => {
    const { a, b, callId, recordingId } = await finished();
    await recording.stopRecording(a, { callId });
    await db.execute(sql`update chat.call_recordings set expires_at = now() - interval '1 minute' where id = ${recordingId}`);
    await expect(recording.openRecording(b, recordingId)).rejects.toThrow("not found");
  });
});

describe("the daily deletion", () => {
  it("deletes the files of expired recordings and keeps the rest; a recording whose call is over is closed first", async () => {
    await setRecording(true);
    const a = await makeUser("rec");
    const { callId } = await callOf(a, [await makeUser(), await makeUser()]);
    const { recordingId } = await recording.startRecording(a, { callId });
    await upload(a, recordingId, 0, EBML);
    const path = `recordings/${recordingId}/0`;
    // The call is over but the recording was never closed (a crash): the job closes it with 30 days to go.
    await db.execute(sql`update chat.calls set ended_at = now() where id = ${callId}`);
    await recording.expireRecordings();
    const closed = await recOf(callId);
    expect(closed.end_reason).toBe("call_ended");
    expect(closed.deleted_at).toBeNull();
    expect(await fake.read(BUCKETS.calls, path)).not.toBeNull();
    await db.execute(sql`update chat.call_recordings set expires_at = now() - interval '1 day' where id = ${recordingId}`);
    expect(await recording.expireRecordings()).toBeGreaterThanOrEqual(1);
    expect((await recOf(callId)).deleted_at).not.toBeNull();
    expect(await fake.read(BUCKETS.calls, path)).toBeNull();
  });

  it("does not mark a recording deleted when its files could not be removed (it tries again next time)", async () => {
    await setRecording(true);
    const a = await makeUser("rec");
    const { callId } = await callOf(a, [await makeUser(), await makeUser()]);
    const { recordingId } = await recording.startRecording(a, { callId });
    await upload(a, recordingId, 0, EBML);
    await recording.stopRecording(a, { callId });
    await db.execute(sql`update chat.call_recordings set expires_at = now() - interval '1 day' where id = ${recordingId}`);
    fake.failRemovals = 1;
    await recording.expireRecordings();
    expect((await recOf(callId)).deleted_at).toBeNull();
    await recording.expireRecordings();
    expect((await recOf(callId)).deleted_at).not.toBeNull();
  });
});

describe("who may record", () => {
  it("a Super Admin's pick is a flag on the person, audited with before and after, and never for a guest", async () => {
    const sa = { id: randomUUID(), email: "sa@example.com" };
    const person = await makeUser("p");
    await recording.setCanRecordCalls(sa, { userId: person.id, enabled: true });
    expect((await rows<{ can: boolean }>(sql`select can_record_calls as can from core.users where id = ${person.id}`))[0].can).toBe(true);
    await recording.setCanRecordCalls(sa, { userId: person.id, enabled: false });
    const logged = await rows<{ before: unknown; after: unknown }>(sql`select before, after from ops.audit_log where action = 'call.recorder.set' and target_id = ${person.id} order by id`);
    expect(logged).toEqual([
      { before: { canRecordCalls: false }, after: { canRecordCalls: true } },
      { before: { canRecordCalls: true }, after: { canRecordCalls: false } },
    ]);
    const guestId = randomUUID();
    await db.execute(sql`insert into core.users (id, email, is_guest) values (${guestId}, ${`${uniq("g")}@client.example`}, true)`);
    await expect(recording.setCanRecordCalls(sa, { userId: guestId, enabled: true })).rejects.toThrow("guest");
    await expect(recording.setCanRecordCalls(sa, { userId: randomUUID(), enabled: true })).rejects.toThrow("not found");
  });
});
