import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { listRecordingsForAccess, openRecordingForAccess, type AccessibleRecording } from "@/modules/calls/recording";
import { callRecordings } from "@/modules/calls/schema";
import { listManagedGroups, loadWindowForAccess, peopleByUserId, type ChatMessage } from "@/modules/messages/queries";
import { conversations } from "@/modules/messages/schema";
import { accessRequests } from "./schema";
import { noteContext, reasonContext, recordRead } from "./service";
import { accessStateOf, type AccessState } from "./rules";

const NOT_FOUND = "Request not found.";
const PAGE = 100;

export type AccessItem = {
  id: string;
  kind: "chat" | "recording";
  state: AccessState;
  conversationId: string;
  title: string;
  chatKind: string;
  memberCount: number;
  requestedByName: string;
  mine: boolean;
  requestedAt: string;
  windowFrom: string | null;
  windowTo: string | null;
  recordingStartedAt: string | null;
  /** Shown to the person who asked and to Super Admins (who decide on it); never in the audit log. */
  reason: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
  accessExpiresAt: string | null;
  readCount: number;
};

/** HR sees their own requests; a Super Admin sees everyone's (waiting ones first). Facts about the chat, never any message text. */
export async function listAccessRequests(): Promise<AccessItem[]> {
  const actor = await requireUser();
  await authorize(actor, "chataccess.list", { ownerUserId: actor.id });
  const all = can(actor, "chataccess.decide");
  const rows = await db
    .select({ r: accessRequests, title: conversations.title, chatKind: conversations.kind, recordingStartedAt: callRecordings.startedAt })
    .from(accessRequests)
    .innerJoin(conversations, eq(conversations.id, accessRequests.conversationId))
    .leftJoin(callRecordings, eq(callRecordings.id, accessRequests.recordingId))
    .where(all ? undefined : eq(accessRequests.requestedBy, actor.id))
    .orderBy(sql`case when ${accessRequests.status} = 'pending' then 0 else 1 end`, desc(accessRequests.requestedAt))
    .limit(500);
  const people = await peopleByUserId(rows.flatMap((x) => [x.r.requestedBy, ...(x.r.decidedBy ? [x.r.decidedBy] : [])]));
  const ids = [...new Set(rows.map((x) => x.r.conversationId))];
  const counts = ids.length
    ? ((await db.execute(sql`select conversation_id as id, count(*)::int as n from chat.conversation_members where left_at is null and conversation_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) group by conversation_id`)) as unknown as { id: string; n: number }[])
    : [];
  const crypto = fieldCrypto();
  return rows.map(({ r, title, chatKind, recordingStartedAt }) => {
    const mine = r.requestedBy === actor.id;
    const canSee = mine || all; // the reason and the note: the person who asked, and Super Admins
    return {
      id: r.id,
      kind: r.kind as "chat" | "recording",
      state: accessStateOf(r),
      conversationId: r.conversationId,
      title: title ?? "Group",
      chatKind,
      memberCount: counts.find((c) => c.id === r.conversationId)?.n ?? 0,
      requestedByName: people.get(r.requestedBy)?.name ?? "Someone",
      mine,
      requestedAt: r.requestedAt.toISOString(),
      windowFrom: r.windowFrom?.toISOString() ?? null,
      windowTo: r.windowTo?.toISOString() ?? null,
      recordingStartedAt: recordingStartedAt?.toISOString() ?? null,
      reason: canSee ? crypto.decrypt(r.reasonEnc, reasonContext(r.id)) : null,
      decidedByName: r.decidedBy ? (people.get(r.decidedBy)?.name ?? "Someone") : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      note: canSee && r.decisionNoteEnc ? crypto.decrypt(r.decisionNoteEnc, noteContext(r.id)) : null,
      accessExpiresAt: r.accessExpiresAt?.toISOString() ?? null,
      readCount: r.readCount,
    };
  });
}

export type Requestable = { chats: { id: string; title: string; kind: string; memberCount: number }[]; recordings: AccessibleRecording[] };

/** What an HR Admin can ask for: chats they are not in (never direct messages), and recordings of calls they were not in. Facts only. */
export async function listRequestable(): Promise<Requestable> {
  const actor = await requireUser();
  await authorize(actor, "chataccess.request");
  const groups = await listManagedGroups();
  return {
    chats: groups.filter((g) => !g.amMember).map((g) => ({ id: g.id, title: g.title, kind: g.kind, memberCount: g.memberCount })),
    recordings: await listRecordingsForAccess(actor.id),
  };
}

async function grantedRequest(requestId: string, actor: Awaited<ReturnType<typeof requireUser>>) {
  const [row] = await db.select().from(accessRequests).where(eq(accessRequests.id, requestId)).limit(1);
  if (!row) throw new ActionFailure(NOT_FOUND);
  // Only the person who asked can read what was granted (the registry says "own"); everyone else gets "not found", not "no access".
  await authorize(actor, "chataccess.read", { ownerUserId: row.requestedBy }).catch(() => {
    throw new ActionFailure(NOT_FOUND);
  });
  if (accessStateOf(row) !== "approved") throw new ActionFailure("This access has ended.");
  return row;
}

export type GrantedChat = {
  id: string;
  title: string;
  chatKind: string;
  windowFrom: string;
  windowTo: string;
  accessExpiresAt: string;
  messages: ChatMessage[];
  hasMore: boolean;
  members: { userId: string; name: string }[];
};

/**
 * The messages HR was granted, read-only. Checks on every call: the request is approved, it is the person who asked, the 72 hours are not
 * over, and the dates are the requested ones. Every opening is counted and audited (ids and counts only).
 */
export async function readGrantedChat(input: { requestId: string; afterSeq?: number }): Promise<GrantedChat> {
  const actor = await requireUser();
  const row = await grantedRequest(input.requestId, actor);
  if (row.kind !== "chat" || !row.windowFrom || !row.windowTo || !row.accessExpiresAt) throw new ActionFailure(NOT_FOUND);
  const [conv] = await db.select({ title: conversations.title, kind: conversations.kind }).from(conversations).where(eq(conversations.id, row.conversationId)).limit(1);
  const { messages, hasMore, members } = await loadWindowForAccess({ readerId: actor.id, conversationId: row.conversationId, from: row.windowFrom, to: row.windowTo, afterSeq: input.afterSeq, limit: PAGE });
  await recordRead(actor, row.id, { kind: "chat", conversationId: row.conversationId, messages: messages.length, afterSeq: input.afterSeq ?? 0 });
  return { id: row.id, title: conv?.title ?? "Group", chatKind: conv?.kind ?? "group", windowFrom: row.windowFrom.toISOString(), windowTo: row.windowTo.toISOString(), accessExpiresAt: row.accessExpiresAt.toISOString(), messages, hasMore, members };
}

/** The granted recording as a stream (for the playback route). Same checks as reading a chat. */
export async function openGrantedRecording(requestId: string): Promise<ReadableStream<Uint8Array>> {
  const actor = await requireUser();
  const row = await grantedRequest(requestId, actor);
  if (row.kind !== "recording" || !row.recordingId) throw new ActionFailure(NOT_FOUND);
  const stream = await openRecordingForAccess(actor, row.recordingId, row.id);
  await recordRead(actor, row.id, { kind: "recording", conversationId: row.conversationId, recordingId: row.recordingId });
  return stream;
}

/** What the viewer needs to know about ONE request of the signed-in person: its kind and whether it is open. Null for anything else (not theirs, not found). */
export async function myGrant(requestId: string): Promise<{ kind: "chat" | "recording"; open: boolean; title: string; accessExpiresAt: string | null } | null> {
  const actor = await requireUser();
  const [row] = await db
    .select({ r: accessRequests, title: conversations.title })
    .from(accessRequests)
    .innerJoin(conversations, eq(conversations.id, accessRequests.conversationId))
    .where(and(eq(accessRequests.id, requestId), eq(accessRequests.requestedBy, actor.id)))
    .limit(1);
  if (!row) return null;
  await authorize(actor, "chataccess.read", { ownerUserId: row.r.requestedBy });
  return { kind: row.r.kind as "chat" | "recording", open: accessStateOf(row.r) === "approved", title: row.title ?? "Group", accessExpiresAt: row.r.accessExpiresAt?.toISOString() ?? null };
}
