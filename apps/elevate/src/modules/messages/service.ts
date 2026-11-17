import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { users } from "@/modules/core/schema";
import { broadcastChatSignal, type ChatSignal } from "./realtime";
import { conversationMembers, conversations, messageRevisions, messages } from "./schema";
import { MAX_BODY, MAX_GROUP, MAX_TITLE, MIN_GROUP } from "./validators";

// Domain functions for chat. They take the acting user, so they live here (server-only), never in a "use server" file.
// Every function checks membership first; "not a member" and "no such conversation" give the same answer so nothing leaks.
// Message text is encrypted with a context that binds it to its message, and is never written to audit rows, logs or signals.

export type Actor = { id: string; email: string };
type Db = Pick<typeof db, "select" | "insert" | "update">;

const NOT_FOUND = "Conversation not found.";
const MESSAGE_NOT_FOUND = "Message not found.";
const RATE_LIMIT = 30;
const RATE_WINDOW_SECONDS = 10;

const bodyContext = (conversationId: string, messageId: string) => `chat_message:${conversationId}:${messageId}`;
const revisionContext = (messageId: string, revisionId: string) => `chat_message_rev:${messageId}:${revisionId}`;

function cleanBody(body: string): string {
  const text = body.trim();
  if (!text || text.length > MAX_BODY) throw new ActionFailure("Check the message and try again.");
  return text;
}

/** The person's current membership in a live conversation, or the not-found failure. */
async function requireMember(executor: Db, userId: string, conversationId: string) {
  const [row] = await executor
    .select({ kind: conversations.kind, role: conversationMembers.role })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(
      and(
        eq(conversationMembers.conversationId, conversationId),
        eq(conversationMembers.userId, userId),
        isNull(conversationMembers.leftAt),
        isNull(conversations.archivedAt),
      ),
    )
    .limit(1);
  if (!row) throw new ActionFailure(NOT_FOUND);
  return row;
}

async function currentMemberIds(executor: Db, conversationId: string): Promise<string[]> {
  const rows = await executor
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));
  return rows.map((r) => r.userId);
}

/** People who exist and are not archived. */
async function activeUserIds(executor: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await executor.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), isNull(users.archivedAt)));
  return rows.map((r) => r.id);
}

async function insertMessage(executor: Db, input: { conversationId: string; senderUserId: string; body: string; kind: "text" | "system" }) {
  const id = randomUUID();
  const [row] = await executor
    .insert(messages)
    .values({
      id,
      conversationId: input.conversationId,
      senderUserId: input.senderUserId,
      bodyEnc: fieldCrypto().encrypt(input.body, bodyContext(input.conversationId, id)),
      kind: input.kind,
    })
    .returning({ seq: messages.seq });
  return { id, seq: row.seq };
}

const signal = (userIds: string[], s: ChatSignal) => broadcastChatSignal(userIds, s);

export async function openDirect(actor: Actor, otherUserId: string): Promise<{ conversationId: string; created: boolean }> {
  if (otherUserId === actor.id) throw new ActionFailure("You can't message yourself.");
  if ((await activeUserIds(db, [otherUserId])).length !== 1) throw new ActionFailure("That person can't be messaged.");
  const dmKey = [actor.id, otherUserId].sort().join(":");

  const result = await db.transaction(async (tx) => {
    const id = randomUUID();
    // The unique dm_key makes two people opening each other's chat at once end up with one conversation.
    const inserted = await tx.insert(conversations).values({ id, kind: "dm", dmKey, createdBy: actor.id }).onConflictDoNothing().returning({ id: conversations.id });
    if (inserted[0]) {
      await tx.insert(conversationMembers).values([
        { conversationId: id, userId: actor.id, role: "owner" },
        { conversationId: id, userId: otherUserId, role: "member" },
      ]);
      return { conversationId: id, created: true };
    }
    const [existing] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.dmKey, dmKey)).limit(1);
    return { conversationId: existing.id, created: false };
  });
  if (result.created) await signal([actor.id, otherUserId], { type: "members", conversationId: result.conversationId });
  return result;
}

export async function createGroup(actor: Actor, input: { title: string; memberUserIds: string[] }): Promise<{ conversationId: string }> {
  const title = input.title.trim();
  const others = [...new Set(input.memberUserIds)].filter((id) => id !== actor.id);
  if (!title || others.length + 1 < MIN_GROUP || others.length + 1 > MAX_GROUP) throw new ActionFailure("Check the group and try again.");
  if ((await activeUserIds(db, others)).length !== others.length) throw new ActionFailure("Some of those people can't be added.");

  const conversationId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(conversations).values({ id: conversationId, kind: "group", title, createdBy: actor.id });
    await tx.insert(conversationMembers).values([
      { conversationId, userId: actor.id, role: "owner" },
      ...others.map((userId) => ({ conversationId, userId, role: "member" })),
    ]);
    await writeAudit({ actor, action: "chat.group.create", targetType: "chat_conversation", targetId: conversationId, metadata: { memberCount: others.length + 1 } }, tx);
  });
  await signal([actor.id, ...others], { type: "members", conversationId });
  return { conversationId };
}

/**
 * Locks a live (not deleted) group for the rest of the transaction, so two changes at the same moment (two adds past the 200 cap, two
 * removals emptying it, a removal racing a re-add) take turns instead of both reading the old state. For the people who manage groups:
 * they need not be a member, and managing never lets them read the group. The action has already checked `messages.manage_group`.
 */
async function lockGroup(tx: Pick<typeof db, "select">, conversationId: string): Promise<void> {
  const [row] = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.kind, "group"), isNull(conversations.archivedAt)))
    .for("update")
    .limit(1);
  if (!row) throw new ActionFailure("Group not found.");
}

export async function addMembers(actor: Actor, conversationId: string, userIds: string[]): Promise<void> {
  const wanted = [...new Set(userIds)];
  const valid = await activeUserIds(db, wanted);
  if (valid.length !== wanted.length) throw new ActionFailure("Some of those people can't be added.");

  const everyone = await db.transaction(async (tx) => {
    await lockGroup(tx, conversationId);
    const before = new Set(await currentMemberIds(tx, conversationId));
    // Adding yourself to a group you are not in would be a way to read it, which only an approved access request may do.
    if (wanted.includes(actor.id) && !before.has(actor.id)) throw new ActionFailure("You can't add yourself to a chat you're not in.");
    const adding = wanted.filter((id) => !before.has(id));
    if (adding.length === 0) return [...before];
    if (before.size + adding.length > MAX_GROUP) throw new ActionFailure(`A group can have up to ${MAX_GROUP} people.`);
    for (const userId of adding) {
      await tx
        .insert(conversationMembers)
        .values({ conversationId, userId, role: "member" })
        .onConflictDoUpdate({ target: [conversationMembers.conversationId, conversationMembers.userId], set: { leftAt: null, joinedAt: sql`now()` } });
    }
    await insertMessage(tx, { conversationId, senderUserId: actor.id, body: adding.length === 1 ? "A person was added" : `${adding.length} people were added`, kind: "system" });
    // Ids only (never names or text): who was added is reviewable, the way a removal already is.
    await writeAudit({ actor, action: "chat.members.add", targetType: "chat_conversation", targetId: conversationId, metadata: { count: adding.length, userIds: adding } }, tx);
    return [...before, ...adding];
  });
  await signal(everyone, { type: "members", conversationId });
}

/** Takes one person out of a group. They lose all access at once (list, history, sending); they can be added back as a fresh start. */
export async function removeMember(actor: Actor, input: { conversationId: string; userId: string }): Promise<void> {
  const everyone = await db.transaction(async (tx) => {
    await lockGroup(tx, input.conversationId);
    const members = await currentMemberIds(tx, input.conversationId);
    if (!members.includes(input.userId)) throw new ActionFailure("That person isn't in this group.");
    if (members.length <= 1) throw new ActionFailure("A group needs at least one person. Delete it instead.");
    await insertMessage(tx, { conversationId: input.conversationId, senderUserId: actor.id, body: "A person was removed", kind: "system" });
    await tx
      .update(conversationMembers)
      .set({ leftAt: sql`now()` })
      .where(and(eq(conversationMembers.conversationId, input.conversationId), eq(conversationMembers.userId, input.userId)));
    await writeAudit({ actor, action: "chat.members.remove", targetType: "chat_conversation", targetId: input.conversationId, metadata: { removedUserId: input.userId } }, tx);
    return members;
  });
  await signal(everyone, { type: "members", conversationId: input.conversationId });
}

/** Renames a group. The new name is shown to its members as a system message (encrypted like any message); the audit row has ids only. */
export async function renameGroup(actor: Actor, input: { conversationId: string; title: string }): Promise<void> {
  const title = input.title.trim();
  if (!title || title.length > MAX_TITLE) throw new ActionFailure("Check the name and try again.");
  const everyone = await db.transaction(async (tx) => {
    await lockGroup(tx, input.conversationId);
    await tx.update(conversations).set({ title }).where(eq(conversations.id, input.conversationId));
    await insertMessage(tx, { conversationId: input.conversationId, senderUserId: actor.id, body: `The group was renamed to "${title}"`, kind: "system" });
    await writeAudit({ actor, action: "chat.group.rename", targetType: "chat_conversation", targetId: input.conversationId }, tx);
    return currentMemberIds(tx, input.conversationId);
  });
  await signal(everyone, { type: "members", conversationId: input.conversationId });
}

/**
 * Deletes a group the way ELEVATE deletes everything: it is archived (disappears for everyone, nobody can read or send), and the
 * encrypted messages stay until the retention period counsel approves ends.
 */
export async function deleteGroup(actor: Actor, conversationId: string): Promise<void> {
  const everyone = await db.transaction(async (tx) => {
    await lockGroup(tx, conversationId);
    const members = await currentMemberIds(tx, conversationId);
    await tx.update(conversations).set({ archivedAt: sql`now()` }).where(eq(conversations.id, conversationId));
    await writeAudit({ actor, action: "chat.group.delete", targetType: "chat_conversation", targetId: conversationId, metadata: { memberCount: members.length } }, tx);
    return members;
  });
  await signal(everyone, { type: "members", conversationId });
}

export async function sendMessage(actor: Actor, input: { conversationId: string; body: string }): Promise<{ id: string; seq: number }> {
  const body = cleanBody(input.body);
  await requireMember(db, actor.id, input.conversationId);

  // Counted in Postgres (not Upstash) so chat never spends the free Redis allowance.
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.senderUserId, actor.id), eq(messages.kind, "text"), sql`${messages.createdAt} > now() - make_interval(secs => ${RATE_WINDOW_SECONDS})`));
  if (recent.n >= RATE_LIMIT) throw new ActionFailure("You are sending messages too fast. Wait a few seconds.");

  const sent = await insertMessage(db, { conversationId: input.conversationId, senderUserId: actor.id, body, kind: "text" });
  await signal(await currentMemberIds(db, input.conversationId), { type: "message", conversationId: input.conversationId, messageId: sent.id });
  return sent;
}

/** The sender's own live text message, in a conversation they still belong to. */
async function ownMessage(actor: Actor, messageId: string) {
  const [msg] = await db
    .select({ id: messages.id, conversationId: messages.conversationId, senderUserId: messages.senderUserId, deletedAt: messages.deletedAt, kind: messages.kind })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!msg || msg.senderUserId !== actor.id || msg.kind !== "text") throw new ActionFailure(MESSAGE_NOT_FOUND);
  await requireMember(db, actor.id, msg.conversationId);
  if (msg.deletedAt) throw new ActionFailure("This message was removed.");
  return msg;
}

export async function editMessage(actor: Actor, input: { messageId: string; body: string }): Promise<void> {
  const body = cleanBody(input.body);
  const msg = await ownMessage(actor, input.messageId);
  const revisionId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(messageRevisions).values({ id: revisionId, messageId: msg.id, bodyEnc: fieldCrypto().encrypt(body, revisionContext(msg.id, revisionId)) });
    await tx.update(messages).set({ editedAt: new Date() }).where(eq(messages.id, msg.id));
  });
  await signal(await currentMemberIds(db, msg.conversationId), { type: "edit", conversationId: msg.conversationId, messageId: msg.id });
}

export async function deleteMessage(actor: Actor, messageId: string): Promise<void> {
  const msg = await ownMessage(actor, messageId);
  await db.transaction(async (tx) => {
    await tx.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, msg.id));
    await writeAudit({ actor, action: "chat.message.delete", targetType: "chat_message", targetId: msg.id, metadata: { conversationId: msg.conversationId } }, tx);
  });
  await signal(await currentMemberIds(db, msg.conversationId), { type: "delete", conversationId: msg.conversationId, messageId: msg.id });
}

export async function markRead(actor: Actor, input: { conversationId: string; seq: number }): Promise<void> {
  await requireMember(db, actor.id, input.conversationId);
  await db
    .update(conversationMembers)
    .set({ lastReadSeq: sql`greatest(${conversationMembers.lastReadSeq}, ${input.seq})` })
    .where(and(eq(conversationMembers.conversationId, input.conversationId), eq(conversationMembers.userId, actor.id)));
  await signal([actor.id], { type: "read", conversationId: input.conversationId });
}

export { bodyContext, revisionContext, requireMember, currentMemberIds };
