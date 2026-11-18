import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { assertGuestReady } from "@/modules/messages/guests";
import { peopleByUserId } from "@/modules/messages/queries";
import { broadcastChatSignal } from "@/modules/messages/realtime";
import { users } from "@/modules/core/schema";
import { conversationMembers, conversations } from "@/modules/messages/schema";
import { currentMemberIds, postSystemLine, requireMember } from "@/modules/messages/service";
import { notify } from "@/modules/notifications/service";
import { broadcastCallEvent } from "./realtime";
import { callParticipants, calls, callTracks, callUsage } from "./schema";
import { getSfu } from "./sfu-port";
import { isSafeSessionId, newTrackName } from "./sfu-rules";
import { mayPublish, MAX_MEETING_PARTICIPANTS, type CallMode, type ParticipantRole, type TrackKind } from "./track-selection";
import { estimateCallGb } from "./usage";

// The life of a call: start, join, leave, end, the 30-second heartbeat, and the media steps (publish, subscribe, renegotiate). Domain
// functions that take the acting user, so they live here (server-only); the actions in actions.ts check the permission first.
// Rules kept here: membership on every step (non-members and removed members get "not found"), a guest only in a client group's call and
// never as the one who starts it, at most 25 people in a meeting, the server decides which tracks anyone may pull, and nothing about
// what was said or shown is stored (only who was there and for how long).

export type Actor = { id: string; email: string; isGuest?: boolean };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Db = Pick<typeof db, "select" | "update" | "insert">;

const NOT_FOUND = "Call not found.";
const SEAT_SILENT_SECONDS = 90;
const START_GRACE_SECONDS = 60;
/** Ringing everyone is only for small chats: in a big channel people see a "call in progress" banner instead. */
export const RING_MAX_MEMBERS = 25;
const MAX_LOCAL_TRACKS = 4;

export type CallInfo = { id: string; conversationId: string; mode: CallMode; startedAt: string; startedBy: string; title: string; conversationKind: string };
export type Seat = { userId: string; name: string; role: ParticipantRole; joinedAt: string };
export type PublishedInfo = { userId: string; role: ParticipantRole; cfSessionId: string; trackName: string; kind: TrackKind };
export type CallState = { call: CallInfo; me: { userId: string; role: ParticipantRole; sessionId: string }; participants: Seat[]; tracks: PublishedInfo[] };
export type LiveCall = { callId: string; mode: CallMode; startedAt: string; startedByName: string; participantCount: number; iAmIn: boolean; conversationId: string };

/** Seats that have been silent too long are treated as left, and a call with nobody left in it ends. Returns the summary if it ended just now. */
async function sweep(tx: Tx, callId: string): Promise<Ended | null> {
  await tx
    .update(callParticipants)
    .set({ leftAt: sql`now()` })
    .where(and(eq(callParticipants.callId, callId), isNull(callParticipants.leftAt), sql`${callParticipants.lastSeenAt} < now() - make_interval(secs => ${SEAT_SILENT_SECONDS})`));
  const [open] = await tx.select({ n: sql<number>`count(*)::int` }).from(callParticipants).where(and(eq(callParticipants.callId, callId), isNull(callParticipants.leftAt)));
  if (open.n > 0) {
    await handOverHost(tx, callId);
    return null;
  }
  // A call just started that nobody has taken a seat in yet (the starter's browser is still joining) is not abandoned.
  const [fresh] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(calls)
    .where(and(eq(calls.id, callId), sql`${calls.startedAt} > now() - make_interval(secs => ${START_GRACE_SECONDS})`, sql`not exists (select 1 from chat.call_participants p where p.call_id = ${callId})`));
  if (fresh.n > 0) return null;
  return finish(tx, callId, "empty");
}

/** If the host is gone but others are still here, the person who has been here longest becomes host (so someone can always end the call or remove a person). */
async function handOverHost(tx: Tx, callId: string): Promise<void> {
  const seats = await tx
    .select({ id: callParticipants.id, role: callParticipants.role, isGuest: users.isGuest })
    .from(callParticipants)
    .innerJoin(users, eq(users.id, callParticipants.userId))
    .where(and(eq(callParticipants.callId, callId), isNull(callParticipants.leftAt)))
    .orderBy(asc(callParticipants.joinedAt));
  if (seats.some((s) => s.role === "host")) return;
  // Only staff can be host: a client guest never controls a call (mute, remove, end). With only guests left there is no host.
  const next = seats.find((s) => !s.isGuest);
  if (next) await tx.update(callParticipants).set({ role: "host" }).where(eq(callParticipants.id, next.id));
}

type Ended = { callId: string; conversationId: string; startedBy: string; missed: boolean; minutes: number; people: number };

/** Ends a call that is still live: closes seats and tracks, records a usage estimate, and says what kind of ending it was. Idempotent. */
async function finish(tx: Tx, callId: string, reason: "ended" | "empty" | "conversation_closed"): Promise<Ended | null> {
  const [call] = await tx.select().from(calls).where(and(eq(calls.id, callId), isNull(calls.endedAt))).for("update").limit(1);
  if (!call) return null;
  await tx.update(callParticipants).set({ leftAt: sql`now()` }).where(and(eq(callParticipants.callId, callId), isNull(callParticipants.leftAt)));
  await tx.update(callTracks).set({ endedAt: sql`now()` }).where(and(eq(callTracks.callId, callId), isNull(callTracks.endedAt)));
  const [stats] = await tx
    .select({
      people: sql<number>`count(distinct ${callParticipants.userId})::int`,
      seconds: sql<number>`coalesce(sum(extract(epoch from (${callParticipants.leftAt} - ${callParticipants.joinedAt}))), 0)::int`,
    })
    .from(callParticipants)
    .where(eq(callParticipants.callId, callId));
  const [span] = await tx.select({ seconds: sql<number>`extract(epoch from (now() - ${calls.startedAt}))::int` }).from(calls).where(eq(calls.id, callId));
  const participantMinutes = Math.round(stats.seconds / 60);
  await tx.update(calls).set({ endedAt: sql`now()`, endReason: reason }).where(eq(calls.id, callId));
  await tx.insert(callUsage).values({ callId, estimatedGb: String(estimateCallGb(call.mode as CallMode, participantMinutes)), participantMinutes }).onConflictDoNothing();
  await writeAudit({ actor: null, action: "call.end", targetType: "call", targetId: callId, metadata: { conversationId: call.conversationId, reason, people: stats.people, participantMinutes } }, tx);
  return { callId, conversationId: call.conversationId, startedBy: call.startedBy, missed: stats.people <= 1, minutes: Math.max(1, Math.round(span.seconds / 60)), people: stats.people };
}

/** After an ending commits: a line in the chat, a notice for a missed call, and a signal so rings and banners clear everywhere. */
async function announceEnd(ended: Ended): Promise<void> {
  const members = await currentMemberIds(db, ended.conversationId);
  await postSystemLine({ conversationId: ended.conversationId, senderUserId: ended.startedBy, body: ended.missed ? "Missed call" : `Call ended after ${ended.minutes} min` }).catch(() => {});
  if (ended.missed) {
    const others = members.filter((id) => id !== ended.startedBy);
    if (others.length > 0) await notify(db, others.map((userId) => ({ userId, kind: "chat.call", title: "You missed a call", link: `/messages/${ended.conversationId}` }))).catch(() => {});
  }
  await broadcastChatSignal(members, { type: "call", conversationId: ended.conversationId, callId: ended.callId });
  await broadcastCallEvent({ type: "ended", callId: ended.callId });
}

async function titleFor(conversationId: string, kind: string, title: string | null, selfId: string): Promise<string> {
  if (kind !== "dm") return title ?? "Group call";
  const ids = (await currentMemberIds(db, conversationId)).filter((id) => id !== selfId);
  const people = await peopleByUserId(ids);
  return ids.length > 0 ? (people.get(ids[0])?.name ?? "Direct message") : "Direct message";
}

async function loadCall(callId: string) {
  const [row] = await db
    .select({ call: calls, kind: conversations.kind, title: conversations.title, archivedAt: conversations.archivedAt })
    .from(calls)
    .innerJoin(conversations, eq(conversations.id, calls.conversationId))
    .where(eq(calls.id, callId))
    .limit(1);
  return row ?? null;
}

/** The call, only if the person is a current member of its conversation and the call is live (a guest must also have accepted the notice). */
async function requireLiveCall(actor: Actor, callId: string) {
  await assertGuestReady({ id: actor.id, isGuest: actor.isGuest });
  const row = await loadCall(callId);
  if (!row) throw new ActionFailure(NOT_FOUND);
  await requireMember(db, actor.id, row.call.conversationId).catch(() => {
    throw new ActionFailure(NOT_FOUND);
  });
  if (row.call.endedAt) throw new ActionFailure("This call has ended.");
  return row;
}

async function openSeat(executor: Db, callId: string, userId: string) {
  const [seat] = await executor
    .select()
    .from(callParticipants)
    .where(and(eq(callParticipants.callId, callId), eq(callParticipants.userId, userId), isNull(callParticipants.leftAt)))
    .limit(1);
  return seat ?? null;
}

/** Starts a call in a chat the person belongs to, or returns the one already live there. Rings everyone in small chats. */
export async function startCall(actor: Actor, input: { conversationId: string }): Promise<{ callId: string; created: boolean }> {
  if (actor.isGuest) throw new ActionFailure("You can't start a call.");
  await requireMember(db, actor.id, input.conversationId);
  const members = await currentMemberIds(db, input.conversationId);
  const existing = await liveCallIdFor(input.conversationId);
  if (existing) return { callId: existing, created: false };

  const callId = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(calls).values({ id: callId, conversationId: input.conversationId, startedBy: actor.id, mode: "meeting" });
      await writeAudit({ actor, action: "call.start", targetType: "call", targetId: callId, metadata: { conversationId: input.conversationId, mode: "meeting", members: members.length } }, tx);
    });
  } catch (error) {
    // Two people pressed "call" together: the one live call wins.
    const winner = await liveCallIdFor(input.conversationId);
    if (winner) return { callId: winner, created: false };
    throw error;
  }
  await postSystemLine({ conversationId: input.conversationId, senderUserId: actor.id, body: "Call started" }).catch(() => {});
  if (members.length <= RING_MAX_MEMBERS) await broadcastChatSignal(members.filter((id) => id !== actor.id), { type: "call", conversationId: input.conversationId, callId });
  else await broadcastChatSignal(members, { type: "call", conversationId: input.conversationId, callId });
  return { callId, created: true };
}

async function liveCallIdFor(conversationId: string): Promise<string | null> {
  const [row] = await db.select({ id: calls.id }).from(calls).where(and(eq(calls.conversationId, conversationId), isNull(calls.endedAt))).limit(1);
  if (!row) return null;
  // A call whose seats all went silent is over: tidy it now instead of letting a dead call block a new one.
  const ended = await db.transaction((tx) => sweep(tx, row.id));
  if (ended) {
    await announceEnd(ended);
    return null;
  }
  return row.id;
}

/** What a chat shows: is a call live here, who started it, how many are in it, and am I in it. Null when there is none. */
export async function getLiveCall(actor: Actor, input: { conversationId: string }): Promise<LiveCall | null> {
  await assertGuestReady({ id: actor.id, isGuest: actor.isGuest });
  await requireMember(db, actor.id, input.conversationId);
  const callId = await liveCallIdFor(input.conversationId);
  if (!callId) return null;
  const [call] = await db.select().from(calls).where(eq(calls.id, callId)).limit(1);
  const seats = await db.select({ userId: callParticipants.userId }).from(callParticipants).where(and(eq(callParticipants.callId, callId), isNull(callParticipants.leftAt)));
  const names = await peopleByUserId([call.startedBy]);
  return { callId, conversationId: input.conversationId, mode: call.mode as CallMode, startedAt: call.startedAt.toISOString(), startedByName: names.get(call.startedBy)?.name ?? "Someone", participantCount: seats.length, iAmIn: seats.some((s) => s.userId === actor.id) };
}

async function stateFor(callId: string, selfId: string): Promise<CallState> {
  const row = await loadCall(callId);
  if (!row) throw new ActionFailure(NOT_FOUND);
  const seat = await openSeat(db, callId, selfId);
  if (!seat?.cfSessionId) throw new ActionFailure(NOT_FOUND);
  const seats = await db.select().from(callParticipants).where(and(eq(callParticipants.callId, callId), isNull(callParticipants.leftAt))).orderBy(asc(callParticipants.joinedAt));
  const published = await db.select().from(callTracks).where(and(eq(callTracks.callId, callId), isNull(callTracks.endedAt)));
  const names = await peopleByUserId(seats.map((s) => s.userId));
  const roleByUser = new Map(seats.map((s) => [s.userId, s.role as ParticipantRole]));
  return {
    call: { id: callId, conversationId: row.call.conversationId, mode: row.call.mode as CallMode, startedAt: row.call.startedAt.toISOString(), startedBy: row.call.startedBy, title: await titleFor(row.call.conversationId, row.kind, row.title, selfId), conversationKind: row.kind },
    me: { userId: selfId, role: seat.role as ParticipantRole, sessionId: seat.cfSessionId },
    participants: seats.map((s) => ({ userId: s.userId, name: names.get(s.userId)?.name ?? "Someone", role: s.role as ParticipantRole, joinedAt: s.joinedAt.toISOString() })),
    // Only tracks of people still in the call.
    tracks: published.filter((t) => roleByUser.has(t.userId)).map((t) => ({ userId: t.userId, role: roleByUser.get(t.userId) as ParticipantRole, cfSessionId: t.cfSessionId, trackName: t.trackName, kind: t.kind as TrackKind })),
  };
}

/** Takes a seat in a live call: a Cloudflare session for this person, relay credentials, and the current roster. Joining again replaces the old seat. */
export async function joinCall(actor: Actor, input: { callId: string }): Promise<CallState & { iceServers: Awaited<ReturnType<ReturnType<typeof getSfu>["iceServers"]>> }> {
  const row = await requireLiveCall(actor, input.callId);
  if (actor.isGuest && row.kind !== "client") throw new ActionFailure(NOT_FOUND);
  const sfu = getSfu();
  // A Cloudflare session is ONE connection, so each person gets two: one to send their own media, one to receive other people's.
  const [{ sessionId }, { sessionId: pullSessionId }] = await Promise.all([sfu.createSession(), sfu.createSession()]);
  if (!isSafeSessionId(sessionId) || !isSafeSessionId(pullSessionId)) throw new ActionFailure("Calls aren't working right now. Try again in a moment.");

  await db.transaction(async (tx) => {
    const [live] = await tx.select().from(calls).where(and(eq(calls.id, input.callId), isNull(calls.endedAt))).for("update").limit(1);
    if (!live) throw new ActionFailure("This call has ended.");
    const old = await openSeat(tx, input.callId, actor.id);
    if (old) {
      await tx.update(callParticipants).set({ leftAt: sql`now()` }).where(eq(callParticipants.id, old.id));
      await tx.update(callTracks).set({ endedAt: sql`now()` }).where(and(eq(callTracks.callId, input.callId), eq(callTracks.userId, actor.id), isNull(callTracks.endedAt)));
    }
    await tx.update(callParticipants).set({ leftAt: sql`now()` }).where(and(eq(callParticipants.callId, input.callId), isNull(callParticipants.leftAt), sql`${callParticipants.lastSeenAt} < now() - make_interval(secs => ${SEAT_SILENT_SECONDS})`));
    const [others] = await tx.select({ n: sql<number>`count(*)::int` }).from(callParticipants).where(and(eq(callParticipants.callId, input.callId), isNull(callParticipants.leftAt)));
    if (others.n >= MAX_MEETING_PARTICIPANTS) throw new ActionFailure(`This call is full (${MAX_MEETING_PARTICIPANTS} people).`);
    const role: ParticipantRole = live.startedBy === actor.id ? "host" : "attendee";
    await tx.insert(callParticipants).values({ callId: input.callId, userId: actor.id, role, cfSessionId: sessionId, cfPullSessionId: pullSessionId });
    await tx.update(calls).set({ maxParticipants: sql`greatest(${calls.maxParticipants}, ${others.n + 1})` }).where(eq(calls.id, input.callId));
  });
  await broadcastCallEvent({ type: "roster", callId: input.callId });
  return { ...(await stateFor(input.callId, actor.id)), iceServers: await sfu.iceServers() };
}

/** The browser reports in every 30 seconds and gets the current roster and tracks back. Tells a removed or finished seat so it can close. */
export async function heartbeat(actor: Actor, input: { callId: string }): Promise<{ status: "ok"; state: CallState } | { status: "ended" } | { status: "removed" }> {
  const row = await loadCall(input.callId);
  if (!row) throw new ActionFailure(NOT_FOUND);
  await requireMember(db, actor.id, row.call.conversationId).catch(() => {
    throw new ActionFailure(NOT_FOUND);
  });
  if (row.call.endedAt) return { status: "ended" };
  const ended = await db.transaction(async (tx) => {
    await tx.update(callParticipants).set({ lastSeenAt: sql`now()` }).where(and(eq(callParticipants.callId, input.callId), eq(callParticipants.userId, actor.id), isNull(callParticipants.leftAt)));
    return sweep(tx, input.callId);
  });
  if (ended) {
    await announceEnd(ended);
    return { status: "ended" };
  }
  if (!(await openSeat(db, input.callId, actor.id))) return { status: "removed" };
  return { status: "ok", state: await stateFor(input.callId, actor.id) };
}

/** Leaves the call (the last person out ends it). */
export async function leaveCall(actor: Actor, input: { callId: string }): Promise<void> {
  const row = await loadCall(input.callId);
  if (!row) throw new ActionFailure(NOT_FOUND);
  await requireMember(db, actor.id, row.call.conversationId).catch(() => {
    throw new ActionFailure(NOT_FOUND);
  });
  const ended = await db.transaction(async (tx) => {
    await tx.update(callParticipants).set({ leftAt: sql`now()` }).where(and(eq(callParticipants.callId, input.callId), eq(callParticipants.userId, actor.id), isNull(callParticipants.leftAt)));
    await tx.update(callTracks).set({ endedAt: sql`now()` }).where(and(eq(callTracks.callId, input.callId), eq(callTracks.userId, actor.id), isNull(callTracks.endedAt)));
    return sweep(tx, input.callId);
  });
  if (ended) await announceEnd(ended);
  else await Promise.all([broadcastCallEvent({ type: "roster", callId: input.callId }), broadcastCallEvent({ type: "tracks", callId: input.callId })]);
}

/** Ends the call for everyone. Only the host (the person who started it). */
export async function endCall(actor: Actor, input: { callId: string }): Promise<void> {
  const { seat } = await requireSeat(actor, input.callId);
  if (seat.role !== "host") throw new ActionFailure("Only the host can end the call for everyone.");
  const ended = await db.transaction((tx) => finish(tx, input.callId, "ended"));
  if (ended) await announceEnd({ ...ended, missed: false });
}

/** The other person's open seat in this call, for a host's action on them (never on yourself). */
async function targetSeat(actor: Actor, callId: string, userId: string) {
  const mine = await requireSeat(actor, callId);
  if (mine.seat.role !== "host") throw new ActionFailure("Only the host can do that.");
  if (userId === actor.id) throw new ActionFailure("Use the buttons for yourself.");
  const seat = await openSeat(db, callId, userId);
  if (!seat) throw new ActionFailure("That person isn't in the call.");
  return seat;
}

/** Host: switches off someone's microphone. The server closes their audio at Cloudflare, so it doesn't depend on their browser obeying. They can unmute themselves. */
export async function muteParticipant(actor: Actor, input: { callId: string; userId: string }): Promise<void> {
  const seat = await targetSeat(actor, input.callId, input.userId);
  const audio = await db.select().from(callTracks).where(and(eq(callTracks.callId, input.callId), eq(callTracks.userId, input.userId), eq(callTracks.kind, "audio"), isNull(callTracks.endedAt)));
  if (audio.length > 0) {
    await db.update(callTracks).set({ endedAt: sql`now()` }).where(inArray(callTracks.id, audio.map((t) => t.id)));
    const mids = audio.map((t) => t.mid).filter((m): m is string => Boolean(m));
    if (seat.cfSessionId && mids.length > 0) await getSfu().closeTracks(seat.cfSessionId, mids).catch(() => {});
  }
  await writeAudit({ actor, action: "call.mute", targetType: "call", targetId: input.callId, metadata: { userId: input.userId } });
  await broadcastCallEvent({ type: "tracks", callId: input.callId });
}

/** Host: takes someone out of the call. Their media is closed at Cloudflare and they can't pull anything; they can rejoin only if a host lets the call stand (they are still a member of the chat). */
export async function removeParticipant(actor: Actor, input: { callId: string; userId: string }): Promise<void> {
  const seat = await targetSeat(actor, input.callId, input.userId);
  const theirs = await db.select().from(callTracks).where(and(eq(callTracks.callId, input.callId), eq(callTracks.userId, input.userId), isNull(callTracks.endedAt)));
  await db.transaction(async (tx) => {
    await tx.update(callParticipants).set({ leftAt: sql`now()` }).where(eq(callParticipants.id, seat.id));
    await tx.update(callTracks).set({ endedAt: sql`now()` }).where(and(eq(callTracks.callId, input.callId), eq(callTracks.userId, input.userId), isNull(callTracks.endedAt)));
    await writeAudit({ actor, action: "call.remove", targetType: "call", targetId: input.callId, metadata: { userId: input.userId } }, tx);
  });
  const mids = theirs.map((t) => t.mid).filter((m): m is string => Boolean(m));
  if (seat.cfSessionId && mids.length > 0) await getSfu().closeTracks(seat.cfSessionId, mids).catch(() => {});
  await Promise.all([broadcastCallEvent({ type: "roster", callId: input.callId }), broadcastCallEvent({ type: "tracks", callId: input.callId })]);
}

/** Closes tracks THIS person pulled (video that scrolled off the page) at Cloudflare, so we stop paying for pictures nobody is looking at. Their own session only. */
export async function unsubscribeTracks(actor: Actor, input: { callId: string; mids: string[] }): Promise<void> {
  const { pullSessionId } = await requireSeat(actor, input.callId);
  await getSfu().closeTracks(pullSessionId, input.mids).catch(() => {});
}

/** Ends calls whose chat was deleted, and any call nobody is left in. Used by the cleanup job. Returns how many were ended. */
export async function endAbandonedCalls(): Promise<number> {
  const live = await db
    .select({ id: calls.id, archivedAt: conversations.archivedAt })
    .from(calls)
    .innerJoin(conversations, eq(conversations.id, calls.conversationId))
    .where(isNull(calls.endedAt));
  let count = 0;
  for (const call of live) {
    const ended = await db.transaction((tx) => (call.archivedAt ? finish(tx, call.id, "conversation_closed") : sweep(tx, call.id)));
    if (ended) {
      await announceEnd(ended);
      count++;
    }
  }
  return count;
}

async function requireSeat(actor: Actor, callId: string) {
  const row = await requireLiveCall(actor, callId);
  const seat = await openSeat(db, callId, actor.id);
  if (!seat?.cfSessionId) throw new ActionFailure("Join the call first.");
  // sessionId sends this person's media; pullSessionId receives other people's (older seats had one session for both).
  return { row, seat, sessionId: seat.cfSessionId, pullSessionId: seat.cfPullSessionId ?? seat.cfSessionId };
}

/** Publish: forwards the person's own offer for their microphone, camera or screen. We name the tracks; the mode decides who may publish. */
export async function publishTracks(actor: Actor, input: { callId: string; offer: { type: "offer"; sdp: string }; tracks: { mid: string; kind: TrackKind }[] }) {
  const { row, seat, sessionId } = await requireSeat(actor, input.callId);
  if (!mayPublish(row.call.mode as CallMode, seat.role as ParticipantRole)) throw new ActionFailure("You're watching this call. A host can make you a speaker.");
  const [mine] = await db.select({ n: sql<number>`count(*)::int` }).from(callTracks).where(and(eq(callTracks.callId, input.callId), eq(callTracks.userId, actor.id), isNull(callTracks.endedAt)));
  if (mine.n + input.tracks.length > MAX_LOCAL_TRACKS) throw new ActionFailure("Too many tracks. Turn one off first.");
  const named = input.tracks.map((t) => ({ mid: t.mid, kind: t.kind, trackName: newTrackName(t.kind, randomUUID()) }));
  const answer = await getSfu().pushTracks(sessionId, input.offer, named.map((t) => ({ mid: t.mid, trackName: t.trackName })));
  const failed = answer.tracks.find((t) => t.errorCode);
  if (failed || !answer.sessionDescription) throw new ActionFailure("Couldn't start sharing. Try again.");
  await db.insert(callTracks).values(named.map((t) => ({ callId: input.callId, userId: actor.id, cfSessionId: sessionId, trackName: t.trackName, mid: t.mid, kind: t.kind })));
  await broadcastCallEvent({ type: "tracks", callId: input.callId });
  return { answer: answer.sessionDescription, tracks: named.map((t) => ({ mid: t.mid, kind: t.kind, trackName: t.trackName })) };
}

/** Stops the person's own tracks (camera off, screen share stopped). */
export async function closeTracks(actor: Actor, input: { callId: string; trackNames: string[] }): Promise<void> {
  const { sessionId } = await requireSeat(actor, input.callId);
  const mine = await db
    .select()
    .from(callTracks)
    .where(and(eq(callTracks.callId, input.callId), eq(callTracks.userId, actor.id), inArray(callTracks.trackName, input.trackNames), isNull(callTracks.endedAt)));
  if (mine.length === 0) return;
  await db.update(callTracks).set({ endedAt: sql`now()` }).where(inArray(callTracks.id, mine.map((t) => t.id)));
  const mids = mine.map((t) => t.mid).filter((m): m is string => Boolean(m));
  if (mids.length > 0) await getSfu().closeTracks(sessionId, mids).catch(() => {});
  await broadcastCallEvent({ type: "tracks", callId: input.callId });
}

/** Subscribe: the server checks each wanted track (live, in this call, from someone still here, allowed in this mode) before Cloudflare is asked. */
export async function subscribeTracks(actor: Actor, input: { callId: string; trackNames: string[] }) {
  const { row, pullSessionId } = await requireSeat(actor, input.callId);
  const wanted = [...new Set(input.trackNames)];
  const found = await db
    .select({ track: callTracks, role: callParticipants.role })
    .from(callTracks)
    .innerJoin(callParticipants, and(eq(callParticipants.callId, callTracks.callId), eq(callParticipants.userId, callTracks.userId), isNull(callParticipants.leftAt)))
    .where(and(eq(callTracks.callId, input.callId), inArray(callTracks.trackName, wanted), isNull(callTracks.endedAt)));
  const allowed = found.filter((f) => f.track.userId !== actor.id && mayPublish(row.call.mode as CallMode, f.role as ParticipantRole));
  if (allowed.length === 0) throw new ActionFailure("Nothing to watch yet.");
  const result = await getSfu().pullTracks(pullSessionId, allowed.map((f) => ({ sessionId: f.track.cfSessionId, trackName: f.track.trackName })));
  // Cloudflare's per-track answers (codes only: no media, no ids of people) so a failed pull can be understood.
  const failures = result.tracks.filter((t) => t.errorCode).map((t) => `${t.errorCode}${t.errorDescription ? `: ${t.errorDescription.slice(0, 80)}` : ""}`);
  if (failures.length > 0 || !result.sessionDescription) console.error("calls: pull problem", { asked: allowed.length, answered: result.tracks.length, hasOffer: Boolean(result.sessionDescription), failures: failures.slice(0, 5) });
  if (!result.sessionDescription) throw new ActionFailure("Couldn't load the video. Try again.");
  return {
    offer: result.sessionDescription,
    requiresImmediateRenegotiation: result.requiresImmediateRenegotiation,
    tracks: result.tracks.filter((t) => t.mid && t.trackName && !t.errorCode).map((t) => ({ mid: t.mid as string, trackName: t.trackName as string })),
  };
}

/** The person's answer to the offer from a subscribe. */
export async function renegotiate(actor: Actor, input: { callId: string; answer: { type: "answer"; sdp: string } }): Promise<void> {
  const { pullSessionId } = await requireSeat(actor, input.callId);
  await getSfu().renegotiate(pullSessionId, input.answer);
}

/** A ring the person has not answered yet: a live call in a chat of theirs they are not in, for the ring pop-up. */
export async function incomingCall(actor: Actor, input: { callId: string }): Promise<(LiveCall & { title: string }) | null> {
  const row = await loadCall(input.callId);
  if (!row || row.call.endedAt) return null;
  const member = await requireMember(db, actor.id, row.call.conversationId).catch(() => null);
  if (!member) return null;
  await assertGuestReady({ id: actor.id, isGuest: actor.isGuest }).catch(() => {
    throw new ActionFailure(NOT_FOUND);
  });
  const live = await getLiveCall(actor, { conversationId: row.call.conversationId });
  if (!live || live.callId !== input.callId || live.iAmIn) return null;
  const [mine] = await db
    .select({ mutedUntil: conversationMembers.mutedUntil })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, row.call.conversationId), eq(conversationMembers.userId, actor.id), isNull(conversationMembers.leftAt)))
    .limit(1);
  // A muted chat doesn't ring.
  if (mine?.mutedUntil && mine.mutedUntil.getTime() > Date.now()) return null;
  return { ...live, title: await titleFor(row.call.conversationId, row.kind, row.title, actor.id) };
}
