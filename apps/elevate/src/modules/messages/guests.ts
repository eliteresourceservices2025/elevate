import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { invitations, users } from "@/modules/core/schema";
import { clients } from "@/modules/people/schema";
import { broadcastChatSignal } from "./realtime";
import { conversationMembers, conversations, guests } from "./schema";
import { MAX_GROUP } from "./validators";

// Client guests: a client's people who may use Messages only (owner decision 2026-11-17). A guest has no roles (a database trigger refuses
// one), reaches nothing but Messages (requireUser turns guests away unless a caller opts in), sees only conversations they were added to,
// cannot start chats or look people up, and cannot open anything until they accept the guest notice. These functions take the acting
// user, so they live here (server-only); the actions in actions.ts check `messages.invite_guests` first.

type Actor = { id: string; email: string };

export const INVITE_DAYS = 7;

/** The short notice a guest accepts before anything opens (counsel to finalize; see docs/policies/COUNSEL-NOTES.md). */
export const GUEST_NOTICE_TITLE = "Before you start: how to use ELEVATE Messages";
export const GUEST_NOTICE_BODY = `You are a guest in ELEVATE Messages, the chat of Elite Resource Services. You can only see the chats you were added to.

**Attendance matters only.** These chats are for attendance, schedules and who is working when.

**Never share patient details.** Do not write or upload names, dates of birth, record numbers, diagnoses, photos, screenshots or any other patient or client record here. If something like that is needed, use your own approved system instead.

**What we keep.** Messages and files are stored encrypted and kept for the retention period. Elite Resource Services may review a chat only through a logged, approved request.

By continuing you confirm you have read this and will follow it.`;

export type GuestRow = { userId: string; email: string; clientId: string; clientName: string; noticeAcceptedAt: string | null; createdAt: string; archivedAt: string | null };
export type PendingGuestInvite = { invitationId: string; email: string; clientId: string; clientName: string; expiresAt: string };

/** Invites one client person. Refuses an email that already has an account or is invited as staff. The action sends the email after the commit. */
export async function inviteGuest(actor: Actor, input: { email: string; clientId: string }): Promise<{ expiresAt: Date }> {
  const email = input.email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    const [client] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, input.clientId), isNull(clients.archivedAt), eq(clients.isActive, true)))
      .limit(1);
    if (!client) throw new ActionFailure("Choose an active client.");
    const [account] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
    if (account) throw new ActionFailure("That email already has an ELEVATE account.");
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
    const [existing] = await tx
      .select({ id: invitations.id, guestClientId: invitations.guestClientId })
      .from(invitations)
      .where(sql`lower(${invitations.email}) = ${email}`)
      .limit(1);
    if (existing && !existing.guestClientId) throw new ActionFailure("That email is already invited as ELEVATE staff.");
    if (existing) {
      await tx.update(invitations).set({ invitedBy: actor.id, expiresAt, acceptedAt: null, createdAt: new Date(), guestClientId: input.clientId }).where(eq(invitations.id, existing.id));
    } else {
      await tx.insert(invitations).values({ email, invitedBy: actor.id, expiresAt, roles: [], isSafevoiceHandler: false, guestClientId: input.clientId });
    }
    await writeAudit({ actor, action: "guest.invite", targetType: "invitation", targetId: email, after: { email, clientId: input.clientId, expiresAt } }, tx);
    return { expiresAt };
  });
}

/** Guests and waiting invitations, for the people who invite them. */
export async function listGuests(): Promise<{ guests: GuestRow[]; pending: PendingGuestInvite[] }> {
  const rows = await db
    .select({ userId: guests.userId, email: users.email, clientId: guests.clientId, clientName: clients.name, noticeAcceptedAt: guests.noticeAcceptedAt, createdAt: guests.createdAt, archivedAt: guests.archivedAt })
    .from(guests)
    .innerJoin(users, eq(users.id, guests.userId))
    .innerJoin(clients, eq(clients.id, guests.clientId))
    .orderBy(sql`${guests.archivedAt} is not null`, clients.name, users.email)
    .limit(1000);
  const waiting = await db
    .select({ invitationId: invitations.id, email: invitations.email, clientId: clients.id, clientName: clients.name, expiresAt: invitations.expiresAt })
    .from(invitations)
    .innerJoin(clients, eq(clients.id, invitations.guestClientId))
    .where(isNull(invitations.acceptedAt))
    .orderBy(invitations.createdAt)
    .limit(500);
  return {
    guests: rows.map((r) => ({ ...r, noticeAcceptedAt: r.noticeAcceptedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), archivedAt: r.archivedAt?.toISOString() ?? null })),
    pending: waiting.map((w) => ({ ...w, expiresAt: w.expiresAt.toISOString() })),
  };
}

/** Ends a guest's access (the client relationship ended): the account is archived and they leave every chat. Nothing is deleted. */
export async function archiveGuest(actor: Actor, userId: string): Promise<void> {
  const affected = await db.transaction(async (tx) => {
    const [guest] = await tx
      .select({ userId: guests.userId, clientId: guests.clientId })
      .from(guests)
      .where(and(eq(guests.userId, userId), isNull(guests.archivedAt)))
      .for("update")
      .limit(1);
    if (!guest) throw new ActionFailure("That guest was not found.");
    await tx.update(guests).set({ archivedAt: sql`now()` }).where(eq(guests.userId, userId));
    await tx.update(users).set({ archivedAt: sql`now()` }).where(and(eq(users.id, userId), isNull(users.archivedAt)));
    const left = await tx
      .update(conversationMembers)
      .set({ leftAt: sql`now()` })
      .where(and(eq(conversationMembers.userId, userId), isNull(conversationMembers.leftAt)))
      .returning({ conversationId: conversationMembers.conversationId });
    await writeAudit({ actor, action: "guest.archive", targetType: "user", targetId: userId, after: { clientId: guest.clientId }, metadata: { conversations: left.length } }, tx);
    return left.map((l) => l.conversationId);
  });
  for (const conversationId of affected) {
    const members = await db
      .select({ userId: conversationMembers.userId })
      .from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));
    await broadcastChatSignal([userId, ...members.map((m) => m.userId)], { type: "members", conversationId });
  }
}

/** Creates a chat for a client: guests of that client (and no other client's) plus the staff HR picks. HR or a Super Admin only (checked by the action). */
export async function createClientGroup(
  actor: Actor,
  input: { clientId: string; title: string; guestUserIds: string[]; staffUserIds: string[] },
): Promise<{ conversationId: string }> {
  const title = input.title.trim();
  const people = [...new Set([...input.guestUserIds, ...input.staffUserIds])].filter((id) => id !== actor.id);
  // At least one other person; the creator makes it two.
  if (!title || people.length < 1 || people.length + 1 > MAX_GROUP) throw new ActionFailure("Check the group and try again.");
  const conversationId = randomUUID();
  await db.transaction(async (tx) => {
    const [client] = await tx.select({ id: clients.id }).from(clients).where(and(eq(clients.id, input.clientId), isNull(clients.archivedAt))).limit(1);
    if (!client) throw new ActionFailure("Choose an active client.");
    if (!(await membersFit(tx, input.clientId, people))) throw new ActionFailure("Some of those people can't be added.");
    await tx.insert(conversations).values({ id: conversationId, kind: "client", clientId: input.clientId, title, createdBy: actor.id });
    await tx.insert(conversationMembers).values([
      { conversationId, userId: actor.id, role: "owner" },
      ...people.map((userId) => ({ conversationId, userId, role: "member" })),
    ]);
    await writeAudit({ actor, action: "chat.client_group.create", targetType: "chat_conversation", targetId: conversationId, metadata: { clientId: input.clientId, memberCount: people.length + 1 } }, tx);
  });
  await broadcastChatSignal([actor.id, ...people], { type: "members", conversationId });
  return { conversationId };
}

/** True when every id is a live person who may be in a chat for this client: staff, or a guest of exactly this client who is not archived. */
export async function membersFit(executor: Pick<typeof db, "select">, clientId: string, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const rows = await executor
    .select({ id: users.id, isGuest: users.isGuest })
    .from(users)
    .where(and(inArray(users.id, ids), isNull(users.archivedAt)));
  if (rows.length !== ids.length) return false;
  const guestIds = rows.filter((r) => r.isGuest).map((r) => r.id);
  if (guestIds.length === 0) return true;
  const mine = await executor
    .select({ userId: guests.userId })
    .from(guests)
    .where(and(inArray(guests.userId, guestIds), eq(guests.clientId, clientId), isNull(guests.archivedAt)));
  return mine.length === guestIds.length;
}

/** Whether this guest may use Messages now: not archived and has accepted the notice. */
export async function guestStatus(userId: string): Promise<{ ready: boolean; noticeAccepted: boolean; clientName: string | null }> {
  const [row] = await db
    .select({ noticeAcceptedAt: guests.noticeAcceptedAt, archivedAt: guests.archivedAt, clientName: clients.name })
    .from(guests)
    .innerJoin(clients, eq(clients.id, guests.clientId))
    .where(eq(guests.userId, userId))
    .limit(1);
  if (!row || row.archivedAt) return { ready: false, noticeAccepted: false, clientName: null };
  return { ready: row.noticeAcceptedAt !== null, noticeAccepted: row.noticeAcceptedAt !== null, clientName: row.clientName };
}

/** A guest who has not accepted the notice (or whose access ended) is turned away from everything in Messages. */
export async function assertGuestReady(actor: { id: string; isGuest?: boolean }): Promise<void> {
  if (!actor.isGuest) return;
  if (!(await guestStatus(actor.id)).ready) throw new ActionFailure("Accept the guest notice to continue.");
}

export async function acceptGuestNotice(actor: Actor): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(guests)
      .set({ noticeAcceptedAt: sql`now()` })
      .where(and(eq(guests.userId, actor.id), isNull(guests.noticeAcceptedAt), isNull(guests.archivedAt)))
      .returning({ userId: guests.userId });
    if (updated.length > 0) await writeAudit({ actor, action: "guest.notice_accepted", targetType: "user", targetId: actor.id }, tx);
  });
}

/** Active clients, for choosing who a guest or a client group belongs to. */
export async function listActiveClients(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: clients.id, name: clients.name }).from(clients).where(and(isNull(clients.archivedAt), eq(clients.isActive, true))).orderBy(clients.name).limit(500);
}
