import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { recordingFactsForAccess } from "@/modules/calls/recording";
import { userRoles, users } from "@/modules/core/schema";
import { conversationMembers, conversations } from "@/modules/messages/schema";
import { notify } from "@/modules/notifications/service";
import { ACCESS_HOURS, MAX_PENDING_PER_PERSON } from "./constants";
import { accessStateOf, addDays, startOfDay } from "./rules";
import { accessRequests } from "./schema";

// The two-person rule for reading what you are not part of (Phase 6). HR Admin asks (a reason is required), a DIFFERENT Super Admin decides,
// approval lasts 72 hours and covers only the requested dates (or one recording). The audit rows and notices carry ids, kinds and dates:
// never the reason, the decision note or any message text. The reason and the note are encrypted at rest.

export type Actor = { id: string; email: string };

const NOT_FOUND = "Request not found.";

export const reasonContext = (id: string) => `chat_access_reason:${id}`;
export const noteContext = (id: string) => `chat_access_note:${id}`;

type ChatInput = { kind: "chat"; conversationId: string; from: string; to: string; reason: string };
type RecordingInput = { kind: "recording"; recordingId: string; reason: string };

async function superAdminIds(except: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.roleSlug, "super_admin"), isNull(users.archivedAt)));
  return rows.map((r) => r.id).filter((id) => id !== except);
}

/** An HR Admin asks to read a chat for some dates, or to watch one recording. Nothing opens until a different Super Admin approves. */
export async function requestAccess(actor: Actor, input: ChatInput | RecordingInput, today: string): Promise<{ id: string }> {
  const id = randomUUID();
  let conversationId: string;
  let recordingId: string | null = null;
  let windowFrom: Date | null = null;
  let windowTo: Date | null = null;

  if (input.kind === "chat") {
    if (input.from > input.to) throw new ActionFailure("The last day can't be before the first.");
    if (input.to > today) throw new ActionFailure("Choose days that have already happened.");
    windowFrom = startOfDay(input.from);
    windowTo = startOfDay(addDays(input.to, 1));
    if (windowTo.getTime() - windowFrom.getTime() > 92 * 86_400_000) throw new ActionFailure("Ask for at most 90 days at a time.");
    const [conv] = await db.select({ id: conversations.id, kind: conversations.kind, archivedAt: conversations.archivedAt }).from(conversations).where(eq(conversations.id, input.conversationId)).limit(1);
    if (!conv || conv.archivedAt) throw new ActionFailure("That chat wasn't found.");
    // Owner decision (2026-11-19): direct messages stay private to the two people; groups, channels and client groups can be asked for.
    if (conv.kind === "dm") throw new ActionFailure("Direct messages can't be requested.");
    const [member] = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, conv.id), eq(conversationMembers.userId, actor.id), isNull(conversationMembers.leftAt))).limit(1);
    if (member) throw new ActionFailure("You are in this chat, so you can already read it.");
    conversationId = conv.id;
  } else {
    const facts = await recordingFactsForAccess(input.recordingId, actor.id);
    if (!facts || !facts.usable) throw new ActionFailure("That recording wasn't found.");
    if (facts.kind === "dm") throw new ActionFailure("Recordings of direct messages can't be requested.");
    if (facts.wasThere) throw new ActionFailure("You were in this call, so you can already watch it.");
    conversationId = facts.conversationId;
    recordingId = input.recordingId;
  }

  await db.transaction(async (tx) => {
    // One person's pending requests are limited, and the same thing is not asked for twice at once.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`access:${actor.id}`}))`);
    const open = await tx
      .select({ id: accessRequests.id, recordingId: accessRequests.recordingId, conversationId: accessRequests.conversationId, kind: accessRequests.kind, status: accessRequests.status, requestedAt: accessRequests.requestedAt, accessExpiresAt: accessRequests.accessExpiresAt, windowFrom: accessRequests.windowFrom, windowTo: accessRequests.windowTo })
      .from(accessRequests)
      .where(and(eq(accessRequests.requestedBy, actor.id), inArray(accessRequests.status, ["pending", "approved"])));
    const live = open.filter((r) => ["pending", "approved"].includes(accessStateOf(r)));
    if (live.filter((r) => r.status === "pending").length >= MAX_PENDING_PER_PERSON) throw new ActionFailure(`You have ${MAX_PENDING_PER_PERSON} requests waiting. Wait for a decision or cancel one.`);
    // The same thing is not asked for twice at once; other days of the same chat can be asked for separately (each needs its own approval).
    const overlaps = (r: { windowFrom: Date | null; windowTo: Date | null }) => Boolean(r.windowFrom && r.windowTo && windowFrom && windowTo && r.windowFrom < windowTo && r.windowTo > windowFrom);
    if (live.some((r) => (recordingId ? r.recordingId === recordingId : r.kind === "chat" && r.conversationId === conversationId && overlaps(r)))) throw new ActionFailure("You already have a request for these days that is waiting or open.");
    await tx.insert(accessRequests).values({
      id,
      kind: input.kind,
      conversationId,
      recordingId,
      requestedBy: actor.id,
      windowFrom,
      windowTo,
      reasonEnc: fieldCrypto().encrypt(input.reason, reasonContext(id)),
    });
    await writeAudit(
      { actor, action: "chat.access.request", targetType: "chat_access_request", targetId: id, metadata: { kind: input.kind, conversationId, recordingId, from: input.kind === "chat" ? input.from : null, to: input.kind === "chat" ? input.to : null } },
      tx,
    );
  });
  // The other Super Admins are told there is something to decide (no reason, no names of the people in the chat).
  const approvers = await superAdminIds(actor.id);
  await notify(db, approvers.map((userId) => ({ userId, kind: "chat.access", title: "HR asked to read a chat", body: "A request is waiting for your decision.", link: "/messages/access" }))).catch(() => {});
  return { id };
}

/** A Super Admin who is not the person asking approves or denies. Approval opens 72 hours of read-only access. Decided requests never change. */
export async function decideAccess(actor: Actor, input: { requestId: string; approve: boolean; note?: string }): Promise<void> {
  const requesterId = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(accessRequests).where(eq(accessRequests.id, input.requestId)).for("update").limit(1);
    if (!row) throw new ActionFailure(NOT_FOUND);
    // The two-person rule (also a database check): nobody decides their own request.
    if (row.requestedBy === actor.id) throw new ActionFailure("You asked for this yourself, so a different Super Admin has to decide it.");
    const state = accessStateOf(row);
    if (state === "lapsed") throw new ActionFailure("This request is too old. Ask HR to make a new one.");
    if (state !== "pending") throw new ActionFailure("This request was already decided.");
    await tx
      .update(accessRequests)
      .set({
        status: input.approve ? "approved" : "denied",
        decidedBy: actor.id,
        decidedAt: sql`now()`,
        decisionNoteEnc: input.note ? fieldCrypto().encrypt(input.note, noteContext(row.id)) : null,
        accessExpiresAt: input.approve ? sql`now() + make_interval(hours => ${ACCESS_HOURS})` : null,
      })
      .where(eq(accessRequests.id, row.id));
    await writeAudit(
      { actor, action: input.approve ? "chat.access.approve" : "chat.access.deny", targetType: "chat_access_request", targetId: row.id, metadata: { kind: row.kind, conversationId: row.conversationId, requestedBy: row.requestedBy, hours: input.approve ? ACCESS_HOURS : 0 } },
      tx,
    );
    return row.requestedBy;
  });
  await notify(db, { userId: requesterId, kind: "chat.access", title: input.approve ? `Your request was approved: open for ${ACCESS_HOURS} hours` : "Your request was denied", link: "/messages/access" }).catch(() => {});
}

/** The person who asked withdraws a request that has not been decided. */
export async function cancelAccess(actor: Actor, input: { requestId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(accessRequests).where(and(eq(accessRequests.id, input.requestId), eq(accessRequests.requestedBy, actor.id))).for("update").limit(1);
    if (!row) throw new ActionFailure(NOT_FOUND);
    if (row.status !== "pending") throw new ActionFailure("Only a request that is waiting can be cancelled.");
    await tx.update(accessRequests).set({ status: "cancelled" }).where(eq(accessRequests.id, row.id));
    await writeAudit({ actor, action: "chat.access.cancel", targetType: "chat_access_request", targetId: row.id, metadata: { kind: row.kind, conversationId: row.conversationId } }, tx);
  });
}

/** Counts one opening of approved access (and when), in the same step as its audit row. */
export async function recordRead(actor: Actor, requestId: string, metadata: Record<string, unknown>): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(accessRequests)
      .set({ readCount: sql`${accessRequests.readCount} + 1`, firstReadAt: sql`coalesce(${accessRequests.firstReadAt}, now())`, lastReadAt: sql`now()` })
      .where(eq(accessRequests.id, requestId));
    await writeAudit({ actor, action: "chat.access.read", targetType: "chat_access_request", targetId: requestId, metadata }, tx);
  });
}
