import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { users } from "@/modules/core/schema";
import { notify } from "@/modules/notifications/service";
import { isAllowedEmoji } from "./emoji";
import { isAllowedGifUrl } from "./gif-rules";
import { membersFit } from "./guests";
import { extractMentions, mentionsEveryone } from "./mentions";
import { clearSearchIndex, indexMessage } from "./search-index";
import { broadcastChatSignal, type ChatSignal } from "./realtime";
import { conversationMembers, conversations, messageAttachments, messagePins, messageReactions, messageRevisions, messages, pollOptions, polls, pollVotes } from "./schema";
import { MAX_BODY, MAX_GROUP, MAX_POLL_OPTIONS, MAX_TITLE, MIN_GROUP } from "./validators";

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
export async function requireMember(executor: Db, userId: string, conversationId: string) {
  const [row] = await executor
    .select({ kind: conversations.kind, role: conversationMembers.role, posting: conversations.posting })
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

/** Staff who exist and are not archived. A client guest is never included: guests only ever join a client's own group (see guests.ts). */
async function activeUserIds(executor: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await executor.select({ id: users.id }).from(users).where(and(inArray(users.id, ids), isNull(users.archivedAt), eq(users.isGuest, false)));
  return rows.map((r) => r.id);
}

async function insertMessage(executor: Db, input: { conversationId: string; senderUserId: string; body: string; kind: "text" | "system" | "poll" | "image" | "file" | "voice" | "gif"; threadRootId?: string | null; quotedMessageId?: string | null }) {
  const id = randomUUID();
  const [row] = await executor
    .insert(messages)
    .values({
      id,
      conversationId: input.conversationId,
      senderUserId: input.senderUserId,
      bodyEnc: fieldCrypto().encrypt(input.body, bodyContext(input.conversationId, id)),
      kind: input.kind,
      threadRootId: input.threadRootId ?? null,
      quotedMessageId: input.quotedMessageId ?? null,
    })
    .returning({ seq: messages.seq });
  return { id, seq: row.seq };
}

const signal = (userIds: string[], s: ChatSignal) => broadcastChatSignal(userIds, s);

export async function openDirect(actor: Actor, otherUserId: string): Promise<{ conversationId: string; created: boolean }> {
  // Guests cannot start chats, and nobody can open a direct chat with one (clients talk in their client group only).
  if ((await activeUserIds(db, [actor.id])).length !== 1) throw new ActionFailure("You can't start a chat.");
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
 * Creates a channel by hand (HR Admin and Super Admin only; checked by the action): a named chat listed with the channels. Unlike the automatic
 * team, department and company channels it is not kept in sync with the organization: the people are chosen, and it can be set so only HR posts.
 */
export async function createChannel(actor: Actor, input: { title: string; memberUserIds: string[]; postingAdminsOnly: boolean }): Promise<{ conversationId: string }> {
  const title = input.title.trim();
  const others = [...new Set(input.memberUserIds)].filter((id) => id !== actor.id);
  if (!title || title.length > MAX_TITLE || others.length < 1 || others.length + 1 > MAX_GROUP) throw new ActionFailure("Check the channel and try again.");
  if ((await activeUserIds(db, others)).length !== others.length) throw new ActionFailure("Some of those people can't be added.");
  const conversationId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(conversations).values({ id: conversationId, kind: "channel", title, posting: input.postingAdminsOnly ? "admins" : "everyone", createdBy: actor.id });
    await tx.insert(conversationMembers).values([
      { conversationId, userId: actor.id, role: "owner" },
      ...others.map((userId) => ({ conversationId, userId, role: "member" })),
    ]);
    await writeAudit({ actor, action: "chat.channel.create", targetType: "chat_conversation", targetId: conversationId, metadata: { memberCount: others.length + 1, postingAdminsOnly: input.postingAdminsOnly } }, tx);
  });
  await signal([actor.id, ...others], { type: "members", conversationId });
  return { conversationId };
}

/**
 * Sets (or, with attachmentId null, removes) the picture of a group, channel or client group. The picture is a chat image the same person uploaded
 * for this conversation and has not used in a message. The action has already checked messages.manage_group.
 */
export async function setConversationPhoto(actor: Actor, input: { conversationId: string; attachmentId: string | null }): Promise<void> {
  const everyone = await db.transaction(async (tx) => {
    await lockGroup(tx, input.conversationId);
    if (input.attachmentId) {
      const [att] = await tx
        .select({ id: messageAttachments.id })
        .from(messageAttachments)
        .where(and(eq(messageAttachments.id, input.attachmentId), eq(messageAttachments.conversationId, input.conversationId), eq(messageAttachments.uploaderUserId, actor.id), eq(messageAttachments.kind, "image"), eq(messageAttachments.status, "active"), isNull(messageAttachments.messageId)))
        .limit(1);
      if (!att) throw new ActionFailure("That picture cannot be used. Upload it again.");
    }
    await tx.update(conversations).set({ photoAttachmentId: input.attachmentId }).where(eq(conversations.id, input.conversationId));
    await writeAudit({ actor, action: input.attachmentId ? "chat.group.photo_set" : "chat.group.photo_removed", targetType: "chat_conversation", targetId: input.conversationId }, tx);
    return currentMemberIds(tx, input.conversationId);
  });
  await signal(everyone, { type: "members", conversationId: input.conversationId });
}

/** Who may start a conversation in a channel HR made: everyone in it, or only HR (replies and reactions stay open). */
export async function setChannelPosting(actor: Actor, input: { conversationId: string; posting: "everyone" | "admins" }): Promise<void> {
  const everyone = await db.transaction(async (tx) => {
    const group = await lockGroup(tx, input.conversationId);
    if (group.kind !== "channel") throw new ActionFailure("Only a channel you made can be changed this way.");
    await tx.update(conversations).set({ posting: input.posting }).where(eq(conversations.id, input.conversationId));
    await writeAudit({ actor, action: "chat.channel.posting", targetType: "chat_conversation", targetId: input.conversationId, metadata: { posting: input.posting } }, tx);
    return currentMemberIds(tx, input.conversationId);
  });
  await signal(everyone, { type: "members", conversationId: input.conversationId });
}

/**
 * Locks a live (not deleted) group for the rest of the transaction, so two changes at the same moment (two adds past the 200 cap, two
 * removals emptying it, a removal racing a re-add) take turns instead of both reading the old state. For the people who manage groups:
 * they need not be a member, and managing never lets them read the group. The action has already checked `messages.manage_group`.
 */
async function lockGroup(tx: Pick<typeof db, "select">, conversationId: string): Promise<{ kind: string; clientId: string | null }> {
  const [row] = await tx
    .select({ id: conversations.id, kind: conversations.kind, clientId: conversations.clientId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), inArray(conversations.kind, ["group", "client", "channel"]), isNull(conversations.archivedAt)))
    .for("update")
    .limit(1);
  if (!row) throw new ActionFailure("Group not found.");
  return { kind: row.kind, clientId: row.clientId };
}

export async function addMembers(actor: Actor, conversationId: string, userIds: string[]): Promise<void> {
  const wanted = [...new Set(userIds)];

  const everyone = await db.transaction(async (tx) => {
    const group = await lockGroup(tx, conversationId);
    // A plain group takes staff only; a client group takes staff and guests of exactly that client.
    const fits = group.kind === "client" && group.clientId ? await membersFit(tx, group.clientId, wanted) : (await activeUserIds(tx, wanted)).length === wanted.length;
    if (!fits) throw new ActionFailure("Some of those people can't be added.");
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

/** A message the person may see right now: a current member of a live conversation, from their join time on, and not removed. */
export async function requireVisibleMessage(executor: Db, userId: string, messageId: string) {
  const [row] = await executor
    .select({ id: messages.id, conversationId: messages.conversationId, threadRootId: messages.threadRootId, senderUserId: messages.senderUserId, kind: messages.kind })
    .from(messages)
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, userId), isNull(conversationMembers.leftAt)))
    .innerJoin(conversations, and(eq(conversations.id, messages.conversationId), isNull(conversations.archivedAt)))
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt), sql`${messages.createdAt} >= ${conversationMembers.joinedAt}`))
    .limit(1);
  if (!row) throw new ActionFailure(MESSAGE_NOT_FOUND);
  return row;
}

/** Tells the mentioned people (current members, not the sender) that they were mentioned: where, never what. */
async function notifyMentions(actor: Actor, conversationId: string, body: string): Promise<void> {
  const everyone = mentionsEveryone(body);
  const mentioned = extractMentions(body).filter((id) => id !== actor.id).slice(0, 20);
  if (mentioned.length === 0 && !everyone) return;
  const memberIds = await currentMemberIds(db, conversationId);
  const members = new Set(memberIds);
  let targets = mentioned.filter((id) => members.has(id));
  if (everyone) {
    // "@everyone" / "@all" tells everyone else in the chat, except people who muted it (a muted chat stays quiet).
    const muted = new Set(
      (await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt), sql`${conversationMembers.mutedUntil} > now()`))).map((m) => m.userId),
    );
    targets = [...new Set([...targets, ...memberIds.filter((id) => id !== actor.id && !muted.has(id))])];
  }
  if (targets.length === 0) return;
  const [conv] = await db.select({ kind: conversations.kind, title: conversations.title }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  const where = conv?.title ? conv.title : "a direct message";
  await notify(db, targets.map((userId) => ({ userId, kind: "chat.mention", title: `You were mentioned in ${where}`, link: `/messages/${conversationId}` })));
}

/** `canManage` is whether the sender may post where only HR posts (the company channel); the action works it out from their role. */
/** Marks the attachments as part of a message. All must be the sender's finished, unsent uploads of this conversation. */
async function linkAttachments(tx: Pick<typeof db, "update">, input: { messageId: string; conversationId: string; senderId: string; attachmentIds: string[] }): Promise<void> {
  const linked = await tx
    .update(messageAttachments)
    .set({ messageId: input.messageId })
    .where(
      and(
        inArray(messageAttachments.id, input.attachmentIds),
        eq(messageAttachments.uploaderUserId, input.senderId),
        eq(messageAttachments.conversationId, input.conversationId),
        eq(messageAttachments.status, "active"),
        isNull(messageAttachments.messageId),
      ),
    )
    .returning({ id: messageAttachments.id });
  if (linked.length !== input.attachmentIds.length) throw new ActionFailure("One of those attachments can't be sent. Upload it again.");
}

export async function sendMessage(actor: Actor, input: { conversationId: string; body: string; threadRootId?: string | null; quotedMessageId?: string | null; canManage?: boolean; attachmentIds?: string[] }): Promise<{ id: string; seq: number }> {
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];
  if (attachmentIds.length > 5) throw new ActionFailure("A message can have up to 5 attachments.");
  // A message with attachments may have no text (a picture or a voice note on its own).
  const body = attachmentIds.length > 0 ? input.body.trim() : cleanBody(input.body);
  if (body.length > MAX_BODY) throw new ActionFailure("Check the message and try again.");
  const member = await requireMember(db, actor.id, input.conversationId);
  if (!input.threadRootId && member.posting === "admins" && !input.canManage) throw new ActionFailure("Only HR can post in this channel.");
  if (input.threadRootId) {
    // A reply goes under a message of the same conversation that is itself not a reply (a thread has one level).
    const [root] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, input.threadRootId), eq(messages.conversationId, input.conversationId), isNull(messages.threadRootId), isNull(messages.deletedAt)))
      .limit(1);
    if (!root) throw new ActionFailure(MESSAGE_NOT_FOUND);
  }

  // A quote reply points at a message of this same conversation that the sender can see (never a system line).
  if (input.quotedMessageId) {
    const quoted = await requireVisibleMessage(db, actor.id, input.quotedMessageId);
    if (quoted.conversationId !== input.conversationId || quoted.kind === "system") throw new ActionFailure(MESSAGE_NOT_FOUND);
  }

  // Counted in Postgres (not Upstash) so chat never spends the free Redis allowance.
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.senderUserId, actor.id), ne(messages.kind, "system"), sql`${messages.createdAt} > now() - make_interval(secs => ${RATE_WINDOW_SECONDS})`));
  if (recent.n >= RATE_LIMIT) throw new ActionFailure("You are sending messages too fast. Wait a few seconds.");

  let kind: "text" | "image" | "file" | "voice" = "text";
  if (attachmentIds.length > 0) {
    const kinds = await db.select({ kind: messageAttachments.kind }).from(messageAttachments).where(and(inArray(messageAttachments.id, attachmentIds), eq(messageAttachments.status, "active")));
    kind = kinds.length > 0 && kinds.every((k) => k.kind === "image") ? "image" : kinds.length > 0 && kinds.every((k) => k.kind === "voice") ? "voice" : "file";
  }
  const sent = await db.transaction(async (tx) => {
    const posted = await insertMessage(tx, { conversationId: input.conversationId, senderUserId: actor.id, body, kind, threadRootId: input.threadRootId ?? null, quotedMessageId: input.quotedMessageId ?? null });
    await indexMessage(tx, posted.id, input.conversationId, body);
    if (attachmentIds.length > 0) await linkAttachments(tx, { messageId: posted.id, conversationId: input.conversationId, senderId: actor.id, attachmentIds });
    return posted;
  });
  await notifyMentions(actor, input.conversationId, body);
  await signal(await currentMemberIds(db, input.conversationId), { type: "message", conversationId: input.conversationId, messageId: sent.id });
  return sent;
}

/** Sends a GIF the person picked: only an https KLIPY address is accepted; the address is stored (encrypted) and shown through our own route. */
export async function sendGif(actor: Actor, input: { conversationId: string; url: string; threadRootId?: string | null; canManage?: boolean }): Promise<{ id: string; seq: number }> {
  if (!isAllowedGifUrl(input.url)) throw new ActionFailure("That GIF can't be sent.");
  const member = await requireMember(db, actor.id, input.conversationId);
  if (!input.threadRootId && member.posting === "admins" && !input.canManage) throw new ActionFailure("Only HR can post in this channel.");
  if (input.threadRootId) {
    const [root] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, input.threadRootId), eq(messages.conversationId, input.conversationId), isNull(messages.threadRootId), isNull(messages.deletedAt)))
      .limit(1);
    if (!root) throw new ActionFailure(MESSAGE_NOT_FOUND);
  }
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(and(eq(messages.senderUserId, actor.id), ne(messages.kind, "system"), sql`${messages.createdAt} > now() - make_interval(secs => ${RATE_WINDOW_SECONDS})`));
  if (recent.n >= RATE_LIMIT) throw new ActionFailure("You are sending messages too fast. Wait a few seconds.");
  const posted = await insertMessage(db, { conversationId: input.conversationId, senderUserId: actor.id, body: input.url, kind: "gif", threadRootId: input.threadRootId ?? null });
  await signal(await currentMemberIds(db, input.conversationId), { type: "message", conversationId: input.conversationId, messageId: posted.id });
  return posted;
}

/** The address of a GIF message the person may see now (a current member, from their join time, not removed). */
export async function gifUrlForViewer(actor: Actor, messageId: string): Promise<string> {
  const msg = await requireVisibleMessage(db, actor.id, messageId);
  if (msg.kind !== "gif") throw new ActionFailure(MESSAGE_NOT_FOUND);
  const [row] = await db.select({ bodyEnc: messages.bodyEnc }).from(messages).where(eq(messages.id, msg.id)).limit(1);
  if (!row) throw new ActionFailure(MESSAGE_NOT_FOUND);
  const url = fieldCrypto().decrypt(row.bodyEnc, bodyContext(msg.conversationId, msg.id));
  if (!isAllowedGifUrl(url)) throw new ActionFailure(MESSAGE_NOT_FOUND);
  return url;
}

/** The sender's own live text message, in a conversation they still belong to. */
async function ownMessage(actor: Actor, messageId: string) {
  const [msg] = await db
    .select({ id: messages.id, conversationId: messages.conversationId, senderUserId: messages.senderUserId, deletedAt: messages.deletedAt, kind: messages.kind })
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);
  if (!msg || msg.senderUserId !== actor.id || msg.kind === "system") throw new ActionFailure(MESSAGE_NOT_FOUND);
  await requireMember(db, actor.id, msg.conversationId);
  if (msg.deletedAt) throw new ActionFailure("This message was removed.");
  return msg;
}

export async function editMessage(actor: Actor, input: { messageId: string; body: string }): Promise<void> {
  const body = cleanBody(input.body);
  const msg = await ownMessage(actor, input.messageId);
  if (msg.kind !== "text") throw new ActionFailure("A poll can't be edited. Remove it and post a new one.");
  const revisionId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(messageRevisions).values({ id: revisionId, messageId: msg.id, bodyEnc: fieldCrypto().encrypt(body, revisionContext(msg.id, revisionId)) });
    await indexMessage(tx, msg.id, msg.conversationId, body);
    await tx.update(messages).set({ editedAt: new Date() }).where(eq(messages.id, msg.id));
  });
  await signal(await currentMemberIds(db, msg.conversationId), { type: "edit", conversationId: msg.conversationId, messageId: msg.id });
}

export async function deleteMessage(actor: Actor, messageId: string): Promise<void> {
  const msg = await ownMessage(actor, messageId);
  await db.transaction(async (tx) => {
    await tx.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, msg.id));
    await clearSearchIndex(tx, msg.id);
    await writeAudit({ actor, action: "chat.message.delete", targetType: "chat_message", targetId: msg.id, metadata: { conversationId: msg.conversationId } }, tx);
  });
  await signal(await currentMemberIds(db, msg.conversationId), { type: "delete", conversationId: msg.conversationId, messageId: msg.id });
}

export async function markRead(actor: Actor, input: { conversationId: string; seq: number }): Promise<void> {
  await requireMember(db, actor.id, input.conversationId);
  await db
    .update(conversationMembers)
    // Never beyond the newest message that exists, so a made-up number can't hide messages that have not arrived yet.
    .set({ lastReadSeq: sql`greatest(${conversationMembers.lastReadSeq}, least(${input.seq}, coalesce((select max(m.seq) from chat.messages m where m.conversation_id = ${input.conversationId}), 0)))` })
    .where(and(eq(conversationMembers.conversationId, input.conversationId), eq(conversationMembers.userId, actor.id)));
  await signal([actor.id], { type: "read", conversationId: input.conversationId });
}

export { bodyContext, revisionContext, currentMemberIds };

/** Adds the person's reaction, or removes it if they already made it. */
export async function toggleReaction(actor: Actor, input: { messageId: string; emoji: string }): Promise<{ active: boolean }> {
  if (!isAllowedEmoji(input.emoji)) throw new ActionFailure("That reaction isn't available.");
  const msg = await requireVisibleMessage(db, actor.id, input.messageId);
  const removed = await db
    .delete(messageReactions)
    .where(and(eq(messageReactions.messageId, msg.id), eq(messageReactions.userId, actor.id), eq(messageReactions.emoji, input.emoji)))
    .returning({ emoji: messageReactions.emoji });
  const active = removed.length === 0;
  if (active) await db.insert(messageReactions).values({ messageId: msg.id, userId: actor.id, emoji: input.emoji }).onConflictDoNothing();
  await signal(await currentMemberIds(db, msg.conversationId), { type: "reaction", conversationId: msg.conversationId, messageId: msg.id });
  return { active };
}

/** Pins a message for everyone in the chat (pinning an already pinned message changes nothing). */
export async function pinMessage(actor: Actor, input: { messageId: string }): Promise<void> {
  const msg = await requireVisibleMessage(db, actor.id, input.messageId);
  await db.insert(messagePins).values({ conversationId: msg.conversationId, messageId: msg.id, pinnedBy: actor.id }).onConflictDoNothing();
  await signal(await currentMemberIds(db, msg.conversationId), { type: "pin", conversationId: msg.conversationId, messageId: msg.id });
}

export async function unpinMessage(actor: Actor, input: { messageId: string }): Promise<void> {
  const msg = await requireVisibleMessage(db, actor.id, input.messageId);
  await db
    .update(messagePins)
    .set({ unpinnedAt: sql`now()` })
    .where(and(eq(messagePins.messageId, msg.id), isNull(messagePins.unpinnedAt)));
  await signal(await currentMemberIds(db, msg.conversationId), { type: "pin", conversationId: msg.conversationId, messageId: msg.id });
}

const pollOptionContext = (messageId: string, optionId: string) => `chat_poll_option:${messageId}:${optionId}`;

/** Posts a poll: a message whose text is the question, with 2 to 10 options (encrypted like any message text). */
export async function createPoll(
  actor: Actor,
  input: { conversationId: string; question: string; options: string[]; multiple: boolean; anonymous: boolean; canManage?: boolean },
): Promise<{ id: string; seq: number }> {
  const question = cleanBody(input.question);
  const options = input.options.map((o) => o.trim());
  if (options.length < 2 || options.length > MAX_POLL_OPTIONS || options.some((o) => !o || o.length > 100) || question.length > 200) throw new ActionFailure("Check the poll and try again.");
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new ActionFailure("Each option must be different.");
  const member = await requireMember(db, actor.id, input.conversationId);
  if (member.posting === "admins" && !input.canManage) throw new ActionFailure("Only HR can post in this channel.");
  const sent = await db.transaction(async (tx) => {
    const posted = await insertMessage(tx, { conversationId: input.conversationId, senderUserId: actor.id, body: question, kind: "poll" });
    await indexMessage(tx, posted.id, input.conversationId, question);
    await tx.insert(polls).values({ messageId: posted.id, multiple: input.multiple, anonymous: input.anonymous });
    await tx.insert(pollOptions).values(
      options.map((label, position) => {
        const optionId = randomUUID();
        return { id: optionId, messageId: posted.id, position, labelEnc: fieldCrypto().encrypt(label, pollOptionContext(posted.id, optionId)) };
      }),
    );
    return posted;
  });
  await signal(await currentMemberIds(db, input.conversationId), { type: "message", conversationId: input.conversationId, messageId: sent.id });
  return sent;
}

/** Votes for an option, or takes the vote back. In a single-choice poll a new vote replaces the old one. */
export async function votePoll(actor: Actor, input: { messageId: string; optionId: string }): Promise<void> {
  const msg = await requireVisibleMessage(db, actor.id, input.messageId);
  if (msg.kind !== "poll") throw new ActionFailure("That isn't a poll.");
  const [option] = await db.select({ id: pollOptions.id }).from(pollOptions).where(and(eq(pollOptions.id, input.optionId), eq(pollOptions.messageId, msg.id))).limit(1);
  if (!option) throw new ActionFailure("That option isn't in this poll.");
  const [poll] = await db.select({ multiple: polls.multiple }).from(polls).where(eq(polls.messageId, msg.id)).limit(1);
  await db.transaction(async (tx) => {
    // Two quick votes from one person take turns, so a single-choice poll never counts both.
    await tx.select({ id: polls.messageId }).from(polls).where(eq(polls.messageId, msg.id)).for("update");
    const mine = await tx.select({ optionId: pollVotes.optionId }).from(pollVotes).where(and(eq(pollVotes.messageId, msg.id), eq(pollVotes.userId, actor.id)));
    const already = mine.some((v) => v.optionId === option.id);
    if (already) {
      await tx.delete(pollVotes).where(and(eq(pollVotes.optionId, option.id), eq(pollVotes.userId, actor.id)));
      return;
    }
    if (!poll?.multiple && mine.length > 0) await tx.delete(pollVotes).where(and(eq(pollVotes.messageId, msg.id), eq(pollVotes.userId, actor.id)));
    await tx.insert(pollVotes).values({ messageId: msg.id, optionId: option.id, userId: actor.id });
  });
  await signal(await currentMemberIds(db, msg.conversationId), { type: "poll", conversationId: msg.conversationId, messageId: msg.id });
}
