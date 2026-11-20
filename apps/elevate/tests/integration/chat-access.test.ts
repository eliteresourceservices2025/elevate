import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FakeStorage } from "./fake-storage";

// HR access to chats and recordings they are not part of (Phase 6): the two-person rule (service AND database), read-only dated windows,
// 72 hours, nothing in the audit log but ids and counts, the reason encrypted, and the members told afterwards only if it was used.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.97" }), cookies: async () => ({ get: () => undefined }) }));
vi.stubEnv("CALLS_FAKE", "1");

const { db } = await import("@/lib/db");
const messages = await import("@/modules/messages/service");
const access = await import("@/modules/chat-access/service");
const queries = await import("@/modules/chat-access/queries");
const jobs = await import("@/modules/chat-access/jobs");
const calls = await import("@/modules/calls/service");
const recording = await import("@/modules/calls/recording");
const settings = await import("@/modules/calls/settings");
const { setDocumentStorage, BUCKETS } = await import("@/modules/documents/storage");
const { addDays, startOfDay } = await import("@/modules/chat-access/rules");

type Actor = { id: string; email: string; roles: string[] };
let counter = 0;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const fake = new FakeStorage();
setDocumentStorage(fake);
const REASON = "A complaint about conduct in this chat.";
// The company day is in Phoenix (the feature counts days there), NOT UTC: between 5 PM and midnight Phoenix time the UTC date is already tomorrow.
const today = () => formatInTimeZone(new Date(), "America/Phoenix", "yyyy-MM-dd");

beforeAll(async () => {
  await db.execute(sql`create schema if not exists auth`);
  await db.execute(sql`create table if not exists auth.sessions (user_id uuid)`);
});

async function makeUser(role: "hr_admin" | "super_admin" | "employee"): Promise<Actor> {
  const id = randomUUID();
  const email = `ca${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  await db.execute(sql`insert into core.user_roles (user_id, role_slug) values (${id}, ${role})`);
  return { id, email, roles: [role] };
}
const as = (u: Actor) => void (current.user = u);
async function group() {
  const hrChat = await makeUser("employee");
  const b = await makeUser("employee");
  const c = await makeUser("employee");
  const conversationId = (await messages.createGroup(hrChat, { title: "Crew", memberUserIds: [b.id, c.id] })).conversationId;
  await messages.sendMessage(b, { conversationId, body: "private words about the schedule" });
  return { conversationId, members: [hrChat, b, c] };
}
const ask = (hr: Actor, conversationId: string, from = today(), to = today()) => access.requestAccess(hr, { kind: "chat", conversationId, from, to, reason: REASON }, today());

describe("asking", () => {
  it("is refused for a direct message, a chat you are in, future days, too many days, and the same thing twice", async () => {
    const hr = await makeUser("hr_admin");
    const { conversationId, members } = await group();
    const dm = await messages.openDirect(members[0], members[1].id);
    await expect(ask(hr, dm.conversationId)).rejects.toThrow("Direct messages can't be requested");
    // In the chat already.
    const inChat = await makeUser("hr_admin");
    await messages.addMembers(members[0], conversationId, [inChat.id]);
    await expect(ask(inChat, conversationId)).rejects.toThrow("can already read");
    await expect(access.requestAccess(hr, { kind: "chat", conversationId, from: today(), to: addDays(today(), 3), reason: REASON }, today())).rejects.toThrow("already happened");
    await expect(access.requestAccess(hr, { kind: "chat", conversationId, from: addDays(today(), -120), to: today(), reason: REASON }, today())).rejects.toThrow("90 days");
    await expect(access.requestAccess(hr, { kind: "chat", conversationId, from: today(), to: addDays(today(), -1), reason: REASON }, today())).rejects.toThrow("can't be before");
    await ask(hr, conversationId);
    await expect(ask(hr, conversationId)).rejects.toThrow("already have a request");
  });

  it("keeps the reason encrypted, never puts it in the audit log, and tells the OTHER Super Admins only", async () => {
    const hr = await makeUser("hr_admin");
    const sa = await makeUser("super_admin");
    const { conversationId } = await group();
    const { id } = await ask(hr, conversationId);
    const [row] = await rows<{ reason_enc: string }>(sql`select reason_enc from chat.access_requests where id = ${id}`);
    expect(row.reason_enc).not.toContain("complaint");
    const audit = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from ops.audit_log where action = 'chat.access.request' and target_id = ${id}`);
    expect(JSON.stringify(audit[0].metadata)).not.toContain("complaint");
    expect(audit[0].metadata).toMatchObject({ kind: "chat", conversationId });
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${sa.id} and kind = 'chat.access'`)).toHaveLength(1);
    expect(await rows(sql`select 1 from ops.notifications where user_id = ${hr.id} and kind = 'chat.access'`)).toHaveLength(0);
  });

  it("limits how many wait at once", async () => {
    const hr = await makeUser("hr_admin");
    for (let i = 0; i < 5; i++) await ask(hr, (await group()).conversationId);
    await expect(ask(hr, (await group()).conversationId)).rejects.toThrow("waiting");
  });
});

describe("the dates asked for", () => {
  it("run from the start of the first day to the start of the day after the last, in Phoenix time", async () => {
    const hr = await makeUser("hr_admin");
    const { conversationId } = await group();
    const from = addDays(today(), -3);
    const to = addDays(today(), -2);
    const { id } = await ask(hr, conversationId, from, to);
    const [row] = await rows<{ window_from: string; window_to: string }>(sql`select window_from, window_to from chat.access_requests where id = ${id}`);
    expect(new Date(row.window_from).toISOString()).toBe(startOfDay(from).toISOString());
    expect(new Date(row.window_to).toISOString()).toBe(startOfDay(addDays(to, 1)).toISOString()); // the last day is included in full
    expect(new Date(row.window_to).getTime() - new Date(row.window_from).getTime()).toBe(48 * 3_600_000);
  });

  it("other days of the same chat can be asked for separately; the same days cannot", async () => {
    const hr = await makeUser("hr_admin");
    const { conversationId } = await group();
    await ask(hr, conversationId, addDays(today(), -10), addDays(today(), -8));
    await expect(ask(hr, conversationId, addDays(today(), -9), addDays(today(), -7))).rejects.toThrow("already have a request");
    await expect(ask(hr, conversationId, addDays(today(), -5), addDays(today(), -4))).resolves.toBeTruthy();
  });
});

describe("deciding: the two-person rule", () => {
  it("nobody decides their own request: refused by the service and by the database", async () => {
    const both = await makeUser("super_admin"); // asks as a Super Admin
    const { conversationId } = await group();
    const { id } = await ask(both, conversationId);
    await expect(access.decideAccess(both, { requestId: id, approve: true })).rejects.toThrow("different Super Admin");
    await expect(db.execute(sql`update chat.access_requests set status = 'approved', decided_by = requested_by, access_expires_at = now() + interval '72 hours' where id = ${id}`)).rejects.toThrow();
    const other = await makeUser("super_admin");
    await access.decideAccess(other, { requestId: id, approve: true });
    expect((await rows<{ status: string }>(sql`select status from chat.access_requests where id = ${id}`))[0].status).toBe("approved");
  });

  it("approval opens 72 hours, is audited with ids only, and a decided request never changes", async () => {
    const hr = await makeUser("hr_admin");
    const sa = await makeUser("super_admin");
    const { conversationId } = await group();
    const { id } = await ask(hr, conversationId);
    await access.decideAccess(sa, { requestId: id, approve: true, note: "Looks right, keep it to the complaint." });
    const [row] = await rows<{ decided_by: string; access_expires_at: string; decided_at: string; decision_note_enc: string }>(sql`select decided_by, access_expires_at, decided_at, decision_note_enc from chat.access_requests where id = ${id}`);
    expect(row.decided_by).toBe(sa.id);
    expect(Math.round((new Date(row.access_expires_at).getTime() - new Date(row.decided_at).getTime()) / 3_600_000)).toBe(72);
    expect(row.decision_note_enc).not.toContain("complaint");
    const audit = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from ops.audit_log where action = 'chat.access.approve' and target_id = ${id}`);
    expect(audit[0].metadata).toEqual({ kind: "chat", conversationId, requestedBy: hr.id, hours: 72 });
    await expect(access.decideAccess(sa, { requestId: id, approve: false })).rejects.toThrow("already decided");
    await expect(db.execute(sql`update chat.access_requests set status = 'denied' where id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`update chat.access_requests set access_expires_at = now() + interval '30 days' where id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`update chat.access_requests set window_to = now() where id = ${id}`)).rejects.toThrow();
    await expect(db.execute(sql`delete from chat.access_requests where id = ${id}`)).rejects.toThrow();
  });

  it("a denial opens nothing; a request too old is refused; the one who asked can withdraw a waiting one", async () => {
    const hr = await makeUser("hr_admin");
    const sa = await makeUser("super_admin");
    const { conversationId } = await group();
    const { id } = await ask(hr, conversationId);
    await access.decideAccess(sa, { requestId: id, approve: false });
    as(hr);
    await expect(queries.readGrantedChat({ requestId: id })).rejects.toThrow("ended");
    const second = await ask(hr, (await group()).conversationId);
    await db.execute(sql`alter table chat.access_requests disable trigger access_requests_no_change`);
    await db.execute(sql`update chat.access_requests set requested_at = now() - interval '8 days' where id = ${second.id}`);
    await db.execute(sql`alter table chat.access_requests enable trigger access_requests_no_change`);
    await expect(access.decideAccess(sa, { requestId: second.id, approve: true })).rejects.toThrow("too old");
    const third = await ask(hr, (await group()).conversationId);
    await expect(access.cancelAccess(sa, { requestId: third.id })).rejects.toThrow("not found");
    await access.cancelAccess(hr, { requestId: third.id });
    await expect(access.decideAccess(sa, { requestId: third.id, approve: true })).rejects.toThrow("already decided");
  });
});

describe("reading what was granted", () => {
  async function approved(from = today(), to = today()) {
    const hr = await makeUser("hr_admin");
    const sa = await makeUser("super_admin");
    const g = await group();
    const { id } = await ask(hr, g.conversationId, from, to);
    await access.decideAccess(sa, { requestId: id, approve: true });
    return { hr, sa, id, ...g };
  }

  it("shows the messages of the requested days to the person who asked, counts and logs the opening (ids and counts only)", async () => {
    const { hr, id, conversationId } = await approved();
    as(hr);
    const chat = await queries.readGrantedChat({ requestId: id });
    expect(chat.messages.some((m) => m.body === "private words about the schedule")).toBe(true);
    expect(chat.members).toHaveLength(3);
    const [req] = await rows<{ read_count: number }>(sql`select read_count from chat.access_requests where id = ${id}`);
    expect(req.read_count).toBe(1);
    const audit = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from ops.audit_log where action = 'chat.access.read' and target_id = ${id}`);
    expect(audit[0].metadata).toMatchObject({ kind: "chat", conversationId });
    expect(JSON.stringify(audit[0].metadata)).not.toContain("private words");
  });

  it("only for the requested days: another day shows nothing", async () => {
    const { hr, id } = await approved(addDays(today(), -10), addDays(today(), -9));
    as(hr);
    expect((await queries.readGrantedChat({ requestId: id })).messages).toEqual([]);
  });

  it("is not available to anyone else: not the approver, not another HR Admin, not a member; nothing before approval; nothing after the 72 hours", async () => {
    const { hr, sa, id, members } = await approved();
    const otherHr = await makeUser("hr_admin");
    for (const who of [sa, otherHr, members[1]]) {
      as(who);
      await expect(queries.readGrantedChat({ requestId: id })).rejects.toThrow("not found");
    }
    // Waiting (not yet approved).
    const waiting = await ask(hr, (await group()).conversationId);
    as(hr);
    await expect(queries.readGrantedChat({ requestId: waiting.id })).rejects.toThrow("ended");
    // Approved, but its 72 hours are over (inserted directly: a decided request cannot be edited).
    const g = await group();
    const gone = randomUUID();
    await db.execute(sql`insert into chat.access_requests (id, kind, conversation_id, requested_by, window_from, window_to, reason_enc, status, decided_by, decided_at, access_expires_at) values (${gone}, 'chat', ${g.conversationId}, ${hr.id}, now() - interval '2 days', now() + interval '1 day', 'x', 'approved', ${sa.id}, now() - interval '4 days', now() - interval '1 day')`);
    await expect(queries.readGrantedChat({ requestId: gone })).rejects.toThrow("ended");
    // The requester may not read a chat they were never granted by guessing another request's id.
    await expect(queries.readGrantedChat({ requestId: randomUUID() })).rejects.toThrow("not found");
  });

  it("includes replies in threads, oldest first", async () => {
    const { hr, id, conversationId, members } = await approved();
    const root = await messages.sendMessage(members[1], { conversationId, body: "the question" });
    await messages.sendMessage(members[2], { conversationId, body: "the answer", threadRootId: root.id });
    as(hr);
    const chat = await queries.readGrantedChat({ requestId: id });
    const reply = chat.messages.find((m) => m.body === "the answer");
    expect(reply?.threadRootId).toBe(root.id);
    expect(chat.messages.findIndex((m) => m.body === "the question")).toBeLessThan(chat.messages.findIndex((m) => m.body === "the answer"));
  });

  it("removed messages stay removed: their text is never returned", async () => {
    const { hr, id, conversationId, members } = await approved();
    const sent = await messages.sendMessage(members[2], { conversationId, body: "oops wrong chat" });
    await messages.deleteMessage(members[2], sent.id);
    as(hr);
    const chat = await queries.readGrantedChat({ requestId: id });
    const gone = chat.messages.find((m) => m.id === sent.id);
    expect(gone?.deleted).toBe(true);
    expect(gone?.body).toBeNull();
    expect(JSON.stringify(chat)).not.toContain("oops wrong chat");
  });
});

describe("telling the people in the chat afterwards", () => {
  async function ended(readCount: number) {
    const hr = await makeUser("hr_admin");
    const sa = await makeUser("super_admin");
    const { conversationId } = await group();
    const id = randomUUID();
    await db.execute(sql`insert into chat.access_requests (id, kind, conversation_id, requested_by, window_from, window_to, reason_enc, status, decided_by, decided_at, access_expires_at, read_count) values (${id}, 'chat', ${conversationId}, ${hr.id}, now() - interval '5 days', now() - interval '3 days', 'x', 'approved', ${sa.id}, now() - interval '4 days', now() - interval '1 day', ${readCount})`);
    return { id, conversationId };
  }
  const lines = async (conversationId: string) => (await rows<{ n: number }>(sql`select count(*)::int as n from chat.messages where conversation_id = ${conversationId} and kind = 'system'`))[0].n;

  it("one plain line once access ended AND was used, only once; nothing when it was never opened", async () => {
    const used = await ended(2);
    const unused = await ended(0);
    expect(await jobs.runChatAccessNotices()).toBeGreaterThanOrEqual(1);
    expect(await lines(used.conversationId)).toBe(1);
    expect(await lines(unused.conversationId)).toBe(0);
    await jobs.runChatAccessNotices();
    expect(await lines(used.conversationId)).toBe(1);
    expect((await rows<{ members_notified_at: string | null }>(sql`select members_notified_at from chat.access_requests where id = ${used.id}`))[0].members_notified_at).not.toBeNull();
    expect((await rows<{ members_notified_at: string | null }>(sql`select members_notified_at from chat.access_requests where id = ${unused.id}`))[0].members_notified_at).toBeNull();
  });
});

describe("a call recording HR was not part of", () => {
  it("follows the same rule: ask, a different Super Admin approves, only the requester plays it, every play logged with the request", async () => {
    await settings.saveCallSettings({ id: randomUUID(), email: "sa@example.com" }, { monthlyGbWarning: 700, townhallEnabled: true, recordingEnabled: true });
    const host = await makeUser("employee");
    const other = await makeUser("employee");
    const third = await makeUser("employee");
    const conversationId = (await messages.createGroup(host, { title: "Crew", memberUserIds: [other.id, third.id] })).conversationId;
    const { callId } = await calls.startCall(host, { conversationId });
    await calls.joinCall(host, { callId });
    await calls.joinCall(other, { callId });
    const { recordingId } = await recording.startRecording(host, { callId });
    const ticket = await recording.requestRecordingPart(host, { recordingId, seq: 0 });
    const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 7, 7, 7]);
    fake.put(ticket.bucket, ticket.path, bytes);
    await recording.finalizeRecordingPart(host, { recordingId, seq: 0 });
    await recording.stopRecording(host, { callId });
    await calls.endCall(host, { callId });
    expect(await fake.read(BUCKETS.calls, ticket.path)).not.toBeNull();

    const hr = await makeUser("hr_admin");
    const sa = await makeUser("super_admin");
    expect((await recording.listRecordingsForAccess(hr.id)).map((r) => r.id)).toContain(recordingId);
    expect((await recording.listRecordingsForAccess(host.id)).map((r) => r.id)).not.toContain(recordingId); // they were there
    await expect(access.requestAccess(host, { kind: "recording", recordingId, reason: REASON }, today())).rejects.toThrow("already watch");
    const { id } = await access.requestAccess(hr, { kind: "recording", recordingId, reason: REASON }, today());
    as(hr);
    await expect(queries.openGrantedRecording(id)).rejects.toThrow("ended"); // not approved yet
    await access.decideAccess(sa, { requestId: id, approve: true });
    const stream = await queries.openGrantedRecording(id);
    const reader = stream.getReader();
    const out: number[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.push(...value);
    }
    expect(out).toEqual([...bytes]);
    const played = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from ops.audit_log where action = 'call.recording.play' and target_id = ${recordingId}`);
    expect(played[0].metadata).toMatchObject({ accessRequestId: id });
    expect((await rows<{ read_count: number }>(sql`select read_count from chat.access_requests where id = ${id}`))[0].read_count).toBe(1);
    as(sa);
    await expect(queries.openGrantedRecording(id)).rejects.toThrow("not found");
    await settings.saveCallSettings({ id: randomUUID(), email: "sa@example.com" }, { monthlyGbWarning: 700, townhallEnabled: true, recordingEnabled: false });
  });
});
