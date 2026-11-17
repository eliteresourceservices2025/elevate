import "server-only";
import { and, asc, eq, ilike, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { users } from "@/modules/core/schema";
import { employees } from "@/modules/people/schema";
import { conversationMembers, conversations } from "./schema";
import { deleteGroupSchema, loadMessagesSchema, loadThreadSchema, searchPeopleSchema } from "./validators";
import { bodyContext, revisionContext } from "./service";

// Reads for chat. Each starts by asking who is calling, and every conversation read checks membership: someone who is not a member
// gets the same "not found" as for a conversation that does not exist. Text is decrypted here, after that check, and only for what is returned.

const NOT_FOUND = "Conversation not found.";
const PREVIEW_CHARS = 80;
const LIST_LIMIT = 200;
/** An ordinary person finds someone to message; the people who build groups (HR Admin, Super Admin) can pull up to a whole 200-person group at once ("Add everyone shown"). */
const PEOPLE_LIMIT = 20;
const PEOPLE_LIMIT_MANAGER = 200;

export type ConversationSummary = {
  id: string;
  kind: "dm" | "group";
  title: string;
  memberCount: number;
  lastSeq: number;
  lastPreview: string | null;
  lastAt: string | null;
  unread: number;
  /** A direct message shows the other person's photo. */
  photoUserId: string | null;
};

export type ChatMessage = {
  id: string;
  seq: number;
  senderUserId: string;
  senderName: string;
  kind: "text" | "system" | "poll" | "image" | "file" | "voice" | "gif";
  /** Null once the message was removed: removed text is never returned. */
  body: string | null;
  deleted: boolean;
  edited: boolean;
  createdAt: string;
  /** The message this one replies to (null for a root message). */
  threadRootId: string | null;
  replyCount: number;
  lastReplyAt: string | null;
  reactions: { emoji: string; count: number; mine: boolean }[];
  pinned: boolean;
};

type Person = { name: string; position: string | null };

async function actorWithAccess() {
  const actor = await requireUser();
  await authorize(actor, "messages.use", { ownerUserId: actor.id });
  return actor;
}

/** Display names: the preferred name (or legal first name) and last name from the people record, else the email's first part. */
async function peopleByUserId(ids: string[]): Promise<Map<string, Person>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, Person>();
  if (unique.length === 0) return map;
  const rows = await db
    .select({ id: users.id, email: users.email, preferred: employees.preferredName, first: employees.legalFirstName, last: employees.legalLastName, position: employees.position })
    .from(users)
    .leftJoin(employees, and(eq(employees.userId, users.id), isNull(employees.archivedAt)))
    .where(sql`${users.id} in (${sql.join(unique.map((id) => sql`${id}`), sql`, `)})`);
  for (const r of rows) {
    const name = r.last ? `${r.preferred?.trim() || r.first} ${r.last}`.trim() : r.email.split("@")[0];
    map.set(r.id, { name, position: r.position ?? null });
  }
  return map;
}

const truncate = (text: string) => (text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text);

export async function listMyConversations(): Promise<ConversationSummary[]> {
  const actor = await actorWithAccess();
  const mine = await db
    .select({ id: conversations.id, kind: conversations.kind, title: conversations.title, createdAt: conversations.createdAt })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.userId, actor.id), isNull(conversationMembers.leftAt), isNull(conversations.archivedAt)))
    .limit(LIST_LIMIT);
  if (mine.length === 0) return [];
  const ids = mine.map((c) => c.id);
  const inIds = (column: string) => sql`${sql.raw(column)} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;

  const stats = (await db.execute(sql`
    select m.conversation_id as id, max(m.seq)::int as last_seq,
      (count(*) filter (where m.sender_user_id <> ${actor.id} and m.kind = 'text' and m.deleted_at is null and m.seq > cm.last_read_seq))::int as unread
    from chat.messages m
    join chat.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${actor.id}
    where ${inIds("m.conversation_id")} and m.created_at >= cm.joined_at
    group by m.conversation_id`)) as unknown as { id: string; last_seq: number; unread: number }[];
  const counts = (await db.execute(sql`
    select conversation_id as id, count(*)::int as n from chat.conversation_members
    where left_at is null and ${inIds("conversation_id")} group by conversation_id`)) as unknown as { id: string; n: number }[];
  const latest = (await db.execute(sql`
    select distinct on (m.conversation_id) m.id, m.conversation_id, m.body_enc, m.created_at
    from chat.messages m
    join chat.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${actor.id}
    where m.deleted_at is null and m.created_at >= cm.joined_at and ${inIds("m.conversation_id")}
    order by m.conversation_id, m.seq desc`)) as unknown as { id: string; conversation_id: string; body_enc: string; created_at: Date }[];
  const revisions = latest.length
    ? ((await db.execute(sql`
        select distinct on (message_id) message_id, id, body_enc from chat.message_revisions
        where message_id in (${sql.join(latest.map((l) => sql`${l.id}`), sql`, `)}) order by message_id, created_at desc`)) as unknown as { message_id: string; id: string; body_enc: string }[])
    : [];

  const dmIds = mine.filter((c) => c.kind === "dm").map((c) => c.id);
  const others = dmIds.length
    ? await db
        .select({ conversationId: conversationMembers.conversationId, userId: conversationMembers.userId })
        .from(conversationMembers)
        .where(and(sql`${conversationMembers.conversationId} in (${sql.join(dmIds.map((id) => sql`${id}`), sql`, `)})`, ne(conversationMembers.userId, actor.id)))
    : [];
  const people = await peopleByUserId(others.map((o) => o.userId));
  const otherOf = new Map(others.map((o) => [o.conversationId, o.userId]));

  const crypto = fieldCrypto();
  const rows = mine.map((c): { summary: ConversationSummary; sortAt: number } => {
    const s = stats.find((x) => x.id === c.id);
    const msg = latest.find((l) => l.conversation_id === c.id);
    let preview: string | null = null;
    if (msg) {
      const rev = revisions.find((r) => r.message_id === msg.id);
      preview = truncate(rev ? crypto.decrypt(rev.body_enc, revisionContext(msg.id, rev.id)) : crypto.decrypt(msg.body_enc, bodyContext(c.id, msg.id)));
    }
    const otherId = otherOf.get(c.id) ?? null;
    const lastAt = msg ? new Date(msg.created_at) : c.createdAt;
    return {
      sortAt: lastAt.getTime(),
      summary: {
        id: c.id,
        kind: c.kind as "dm" | "group",
        title: c.kind === "dm" ? (otherId ? (people.get(otherId)?.name ?? "Someone") : "Someone") : (c.title ?? "Group"),
        memberCount: counts.find((x) => x.id === c.id)?.n ?? 0,
        lastSeq: s?.last_seq ?? 0,
        lastPreview: preview,
        lastAt: lastAt.toISOString(),
        unread: s?.unread ?? 0,
        photoUserId: c.kind === "dm" ? otherId : null,
      },
    };
  });
  return rows.sort((a, b) => b.sortAt - a.sortAt).map((r) => r.summary);
}

type MessageRow = { id: string; seq: number; sender_user_id: string; body_enc: string; kind: ChatMessage["kind"]; created_at: Date; edited_at: Date | null; deleted_at: Date | null; thread_root_id: string | null };
const MESSAGE_COLUMNS = sql`id, seq::int as seq, sender_user_id, body_enc, kind, created_at, edited_at, deleted_at, thread_root_id`;

/** Succeeds when the person may read the conversation right now (current member, live conversation), or throws the not-found failure. */
async function requireReader(actorId: string, conversationId: string): Promise<void> {
  const [membership] = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, actorId), isNull(conversationMembers.leftAt), isNull(conversations.archivedAt)))
    .limit(1);
  // Someone who was removed (or a deleted group) gets nothing: not even what was said before.
  if (!membership) throw new ActionFailure(NOT_FOUND);
}

/** A person sees only what was created from the moment they joined (or were added back). Compared in the database so microseconds are kept. */
const windowFor = (conversationId: string, actorId: string) =>
  sql`and created_at >= (select joined_at from chat.conversation_members where conversation_id = ${conversationId} and user_id = ${actorId})`;

/** Turns rows into what the screen shows: text decrypted (latest edit wins, removed messages have none), names, reactions, pins, reply counts. */
async function buildMessages(actorId: string, conversationId: string, page: MessageRow[]): Promise<{ messages: ChatMessage[]; nameOf: (id: string) => string }> {
  const live = page.filter((m) => !m.deleted_at);
  const idList = (rows: { id: string }[]) => sql.join(rows.map((m) => sql`${m.id}`), sql`, `);
  const revisions = live.length
    ? ((await db.execute(sql`
        select distinct on (message_id) message_id, id, body_enc from chat.message_revisions
        where message_id in (${idList(live)}) order by message_id, created_at desc`)) as unknown as { message_id: string; id: string; body_enc: string }[])
    : [];
  const reactionRows = live.length
    ? ((await db.execute(sql`
        select message_id, emoji, count(*)::int as n, bool_or(user_id = ${actorId}) as mine
        from chat.message_reactions where message_id in (${idList(live)})
        group by message_id, emoji order by min(created_at)`)) as unknown as { message_id: string; emoji: string; n: number; mine: boolean }[])
    : [];
  const pinRows = live.length
    ? ((await db.execute(sql`select message_id from chat.message_pins where unpinned_at is null and message_id in (${idList(live)})`)) as unknown as { message_id: string }[])
    : [];
  const roots = live.filter((m) => !m.thread_root_id);
  const replyRows = roots.length
    ? ((await db.execute(sql`
        select thread_root_id as id, count(*)::int as n, max(created_at) as last_at from chat.messages
        where deleted_at is null and thread_root_id in (${idList(roots)}) group by thread_root_id`)) as unknown as { id: string; n: number; last_at: Date }[])
    : [];
  const memberRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  const people = await peopleByUserId([...memberRows.map((r) => r.userId), ...page.map((m) => m.sender_user_id)]);
  const nameOf = (id: string) => people.get(id)?.name ?? "Someone";

  const crypto = fieldCrypto();
  const messages: ChatMessage[] = page.map((m) => {
    let body: string | null = null;
    if (!m.deleted_at) {
      const rev = revisions.find((r) => r.message_id === m.id);
      body = rev ? crypto.decrypt(rev.body_enc, revisionContext(m.id, rev.id)) : crypto.decrypt(m.body_enc, bodyContext(conversationId, m.id));
    }
    const replies = replyRows.find((r) => r.id === m.id);
    return {
      id: m.id,
      seq: m.seq,
      senderUserId: m.sender_user_id,
      senderName: nameOf(m.sender_user_id),
      kind: m.kind,
      body,
      deleted: !!m.deleted_at,
      edited: !!m.edited_at,
      createdAt: new Date(m.created_at).toISOString(),
      threadRootId: m.thread_root_id,
      replyCount: replies?.n ?? 0,
      lastReplyAt: replies ? new Date(replies.last_at).toISOString() : null,
      reactions: m.deleted_at ? [] : reactionRows.filter((r) => r.message_id === m.id).map((r) => ({ emoji: r.emoji, count: r.n, mine: r.mine })),
      pinned: pinRows.some((r) => r.message_id === m.id),
    };
  });
  return { messages, nameOf };
}

export async function loadMessages(input: unknown): Promise<{ messages: ChatMessage[]; hasMore: boolean; members: { userId: string; name: string; lastReadSeq: number }[] }> {
  const actor = await actorWithAccess();
  const parsed = loadMessagesSchema.safeParse(input);
  if (!parsed.success) throw new ActionFailure("Check the request and try again.");
  const { conversationId, beforeSeq, afterSeq, limit } = parsed.data;
  await requireReader(actor.id, conversationId);

  const range = beforeSeq !== undefined ? sql`and seq < ${beforeSeq}` : afterSeq !== undefined ? sql`and seq > ${afterSeq}` : sql``;
  const newestFirst = afterSeq === undefined;
  // The main list holds root messages only: replies live in their thread.
  const fetched = (await db.execute(sql`
    select ${MESSAGE_COLUMNS} from chat.messages
    where conversation_id = ${conversationId} and thread_root_id is null ${windowFor(conversationId, actor.id)} ${range}
    order by seq ${newestFirst ? sql`desc` : sql`asc`} limit ${limit + 1}`)) as unknown as MessageRow[];
  const hasMore = fetched.length > limit;
  const page = (hasMore ? fetched.slice(0, limit) : fetched).sort((a, b) => a.seq - b.seq);
  const { messages, nameOf } = await buildMessages(actor.id, conversationId, page);

  // The people list: current members only (so someone who was removed can be added back).
  const memberRows = await db
    .select({ userId: conversationMembers.userId, lastReadSeq: conversationMembers.lastReadSeq })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)))
    .orderBy(asc(conversationMembers.joinedAt));
  return { messages, hasMore, members: memberRows.map((r) => ({ userId: r.userId, name: nameOf(r.userId), lastReadSeq: r.lastReadSeq })) };
}

/** One thread: the message that started it and its replies, oldest first. */
export async function loadThread(input: unknown): Promise<{ root: ChatMessage; replies: ChatMessage[] }> {
  const actor = await actorWithAccess();
  const parsed = loadThreadSchema.safeParse(input);
  if (!parsed.success) throw new ActionFailure("Check the request and try again.");
  const { conversationId, rootId } = parsed.data;
  await requireReader(actor.id, conversationId);
  const rows = (await db.execute(sql`
    select ${MESSAGE_COLUMNS} from chat.messages
    where conversation_id = ${conversationId} ${windowFor(conversationId, actor.id)} and (id = ${rootId} or thread_root_id = ${rootId})
    order by seq asc limit 501`)) as unknown as MessageRow[];
  const rootRow = rows.find((r) => r.id === rootId && !r.thread_root_id);
  if (!rootRow) throw new ActionFailure("Message not found.");
  const { messages } = await buildMessages(actor.id, conversationId, rows);
  return { root: messages.find((m) => m.id === rootId)!, replies: messages.filter((m) => m.threadRootId === rootId) };
}

export type PinnedMessage = { pinId: string; messageId: string; body: string; senderName: string; pinnedAt: string };

/** The messages pinned in a conversation (newest pin first). Removed messages are never listed. */
export async function listPins(input: unknown): Promise<PinnedMessage[]> {
  const actor = await actorWithAccess();
  const parsed = deleteGroupSchema.safeParse(input);
  if (!parsed.success) throw new ActionFailure("Check the request and try again.");
  const conversationId = parsed.data.conversationId;
  await requireReader(actor.id, conversationId);
  const pins = (await db.execute(sql`
    select p.id as pin_id, p.message_id, p.pinned_at from chat.message_pins p
    join chat.messages m on m.id = p.message_id
    where p.conversation_id = ${conversationId} and p.unpinned_at is null and m.deleted_at is null
      and m.created_at >= (select joined_at from chat.conversation_members where conversation_id = ${conversationId} and user_id = ${actor.id})
    order by p.pinned_at desc limit 20`)) as unknown as { pin_id: string; message_id: string; pinned_at: Date }[];
  if (pins.length === 0) return [];
  const rows = (await db.execute(sql`
    select ${MESSAGE_COLUMNS} from chat.messages where id in (${sql.join(pins.map((p) => sql`${p.message_id}`), sql`, `)})`)) as unknown as MessageRow[];
  const { messages } = await buildMessages(actor.id, conversationId, rows);
  return pins.flatMap((p) => {
    const m = messages.find((x) => x.id === p.message_id);
    return m && m.body !== null ? [{ pinId: p.pin_id, messageId: m.id, body: m.body, senderName: m.senderName, pinnedAt: new Date(p.pinned_at).toISOString() }] : [];
  });
}

export type ManagedGroup = { id: string; title: string; memberCount: number; createdAt: string; createdByName: string; amMember: boolean };

/**
 * Every live group, for the people who manage groups (HR Admin, Super Admin): name, size, who made it and whether they are in it.
 * Never any message text, and being listed here does not let them read the group.
 */
export async function listManagedGroups(): Promise<ManagedGroup[]> {
  const actor = await requireUser();
  await authorize(actor, "messages.manage_group");
  const rows = (await db.execute(sql`
    select c.id, c.title, c.created_by, c.created_at,
      (select count(*)::int from chat.conversation_members m where m.conversation_id = c.id and m.left_at is null) as member_count,
      exists (select 1 from chat.conversation_members m where m.conversation_id = c.id and m.user_id = ${actor.id} and m.left_at is null) as am_member
    from chat.conversations c
    where c.kind = 'group' and c.archived_at is null
    order by c.created_at desc
    limit 500`)) as unknown as { id: string; title: string | null; created_by: string; created_at: Date; member_count: number; am_member: boolean }[];
  const people = await peopleByUserId(rows.map((r) => r.created_by));
  return rows.map((r) => ({
    id: r.id,
    title: r.title ?? "Group",
    memberCount: r.member_count,
    createdAt: new Date(r.created_at).toISOString(),
    createdByName: people.get(r.created_by)?.name ?? "Someone",
    amMember: r.am_member,
  }));
}

/** The current people of one live group, for managing it (names only). */
export async function loadGroupPeople(input: unknown): Promise<{ userId: string; name: string }[]> {
  const actor = await requireUser();
  await authorize(actor, "messages.manage_group");
  const parsed = deleteGroupSchema.safeParse(input);
  if (!parsed.success) throw new ActionFailure("Check the request and try again.");
  const [group] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.id, parsed.data.conversationId), eq(conversations.kind, "group"), isNull(conversations.archivedAt)))
    .limit(1);
  if (!group) throw new ActionFailure("Group not found.");
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, group.id), isNull(conversationMembers.leftAt)))
    .orderBy(asc(conversationMembers.joinedAt));
  const people = await peopleByUserId(rows.map((r) => r.userId));
  return rows.map((r) => ({ userId: r.userId, name: people.get(r.userId)?.name ?? "Someone" }));
}

export async function countMyUnread(): Promise<number> {
  const actor = await actorWithAccess();
  const [row] = (await db.execute(sql`
    select count(*)::int as n
    from chat.messages m
    join chat.conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${actor.id} and cm.left_at is null
    join chat.conversations c on c.id = m.conversation_id and c.archived_at is null
    where m.sender_user_id <> ${actor.id} and m.kind = 'text' and m.deleted_at is null and m.seq > cm.last_read_seq and m.created_at >= cm.joined_at`)) as unknown as { n: number }[];
  return row?.n ?? 0;
}

export async function searchChatPeople(input: unknown): Promise<{ userId: string; name: string; position: string | null }[]> {
  const actor = await actorWithAccess();
  const parsed = searchPeopleSchema.safeParse(input);
  if (!parsed.success) throw new ActionFailure("Check the request and try again.");
  const q = parsed.data.q;
  const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
  const fullName = sql`coalesce(nullif(${employees.preferredName}, ''), ${employees.legalFirstName}) || ' ' || ${employees.legalLastName}`;
  const rows = await db
    .select({ userId: employees.userId, preferred: employees.preferredName, first: employees.legalFirstName, last: employees.legalLastName, position: employees.position })
    .from(employees)
    .innerJoin(users, eq(users.id, employees.userId))
    .where(
      and(
        isNotNull(employees.userId),
        ne(employees.userId, actor.id),
        isNull(employees.archivedAt),
        isNull(employees.retentionArchivedAt),
        isNull(users.archivedAt),
        q ? or(sql`${fullName} ilike ${like}`, ilike(employees.legalFirstName, like), ilike(employees.legalLastName, like), ilike(employees.position, like)) : undefined,
      ),
    )
    .orderBy(asc(employees.legalLastName), asc(employees.legalFirstName))
    .limit(can(actor, "messages.manage_group") ? PEOPLE_LIMIT_MANAGER : PEOPLE_LIMIT);
  return rows.map((r) => ({ userId: r.userId!, name: `${r.preferred?.trim() || r.first} ${r.last}`.trim(), position: r.position ?? null }));
}
