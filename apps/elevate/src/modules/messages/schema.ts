import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, smallint, type AnyPgColumn, pgSchema, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { departments, teams } from "@/modules/org/schema";

// Messages (chat). Text is encrypted with fieldCrypto (context "chat_message:<conversationId>:<messageId>"; edits use
// "chat_message_rev:<messageId>:<revisionId>"), so ids are generated in the app. Messages are insert-only by trigger
// (migration 0147): a delete stamps deleted_at once, an edit stamps edited_at and adds a revision row. Realtime only ever
// carries ids; see docs/modules/messages.md.

export const chat = pgSchema("chat");

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const conversations = chat
  .table(
    "conversations",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** 'dm' (two people), 'group' (made by HR), 'team', 'department' or 'company' (automatic channels kept in sync with ELEVATE's teams). Phase 3 adds 'client'. */
      kind: text("kind").notNull(),
      /** The team or department a channel belongs to (one channel each). */
      teamId: uuid("team_id").references(() => teams.id),
      departmentId: uuid("department_id").references(() => departments.id),
      /** 'admins': only HR Admins and Super Admins post root messages here (the company channel); replies and reactions stay open. */
      posting: text("posting").notNull().default("everyone"),
      /** A group's name (plain text, shown to its members). Null for a direct message. */
      title: text("title"),
      /** "<smaller user id>:<larger user id>" for a direct message, so a pair has one conversation. */
      dmKey: text("dm_key"),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      createdAt: createdAt(),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("conversations_dm_key_idx").on(t.dmKey).where(sql`${t.dmKey} is not null`),
      uniqueIndex("conversations_team_idx").on(t.teamId).where(sql`${t.teamId} is not null`),
      uniqueIndex("conversations_department_idx").on(t.departmentId).where(sql`${t.departmentId} is not null`),
      uniqueIndex("conversations_company_idx").on(t.kind).where(sql`${t.kind} = 'company'`),
      check("conversations_kind_chk", sql`${t.kind} in ('dm','group','team','department','company')`),
      check("conversations_posting_chk", sql`${t.posting} in ('everyone','admins')`),
      check("conversations_dm_key_chk", sql`(${t.kind} = 'dm') = (${t.dmKey} is not null)`),
    ],
  )
  .enableRLS();

export const conversationMembers = chat
  .table(
    "conversation_members",
    {
      conversationId: uuid("conversation_id")
        .notNull()
        .references(() => conversations.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      /** 'owner' or 'member'. */
      role: text("role").notNull().default("member"),
      joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
      /** Set when the person leaves; they keep seeing what came before and nothing after. */
      leftAt: timestamp("left_at", { withTimezone: true }),
      /** The newest message seq this person has seen; unread = others' messages above it. */
      lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
      mutedUntil: timestamp("muted_until", { withTimezone: true }),
    },
    (t) => [
      primaryKey({ columns: [t.conversationId, t.userId] }),
      index("conversation_members_user_idx").on(t.userId, t.leftAt),
      check("conversation_members_role_chk", sql`${t.role} in ('owner','member')`),
    ],
  )
  .enableRLS();

export const messages = chat
  .table(
    "messages",
    {
      /** Generated in the app so the encryption context is known before insert. */
      id: uuid("id").primaryKey(),
      /** Orders messages and marks read position. */
      seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
      conversationId: uuid("conversation_id")
        .notNull()
        .references(() => conversations.id),
      senderUserId: uuid("sender_user_id")
        .notNull()
        .references(() => users.id),
      bodyEnc: text("body_enc").notNull(),
      /** 'text', 'system' (for example "A person left"), and from Phase 2 'poll', 'image', 'file', 'voice' and 'gif'. */
      kind: text("kind").notNull().default("text"),
      /** A reply in a thread points at the message that started it (a thread has one level: a reply is never a root). */
      threadRootId: uuid("thread_root_id").references((): AnyPgColumn => messages.id),
      createdAt: createdAt(),
      editedAt: timestamp("edited_at", { withTimezone: true }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (t) => [
      index("messages_conversation_seq_idx").on(t.conversationId, t.seq),
      index("messages_sender_created_idx").on(t.senderUserId, t.createdAt),
      uniqueIndex("messages_seq_idx").on(t.seq),
      index("messages_thread_idx").on(t.threadRootId, t.seq),
      check("messages_kind_chk", sql`${t.kind} in ('text','system','poll','image','file','voice','gif')`),
    ],
  )
  .enableRLS();

/** An edit adds a row here; the original body in messages never changes. The newest revision is what people see. */
export const messageRevisions = chat
  .table(
    "message_revisions",
    {
      id: uuid("id").primaryKey(),
      messageId: uuid("message_id")
        .notNull()
        .references(() => messages.id),
      bodyEnc: text("body_enc").notNull(),
      createdAt: createdAt(),
    },
    (t) => [index("message_revisions_message_idx").on(t.messageId, t.createdAt)],
  )
  .enableRLS();

/** A person's emoji reaction to a message. Toggling removes the row (reactions are not history, unlike messages). */
export const messageReactions = chat
  .table(
    "message_reactions",
    {
      messageId: uuid("message_id")
        .notNull()
        .references(() => messages.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      emoji: text("emoji").notNull(),
      createdAt: createdAt(),
    },
    (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] }), index("message_reactions_message_idx").on(t.messageId)],
  )
  .enableRLS();

/** A pinned message. Unpinning stamps unpinned_at, so the history of pins stays. */
export const messagePins = chat
  .table(
    "message_pins",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      conversationId: uuid("conversation_id")
        .notNull()
        .references(() => conversations.id),
      messageId: uuid("message_id")
        .notNull()
        .references(() => messages.id),
      pinnedBy: uuid("pinned_by")
        .notNull()
        .references(() => users.id),
      pinnedAt: timestamp("pinned_at", { withTimezone: true }).notNull().defaultNow(),
      unpinnedAt: timestamp("unpinned_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("message_pins_open_idx").on(t.messageId).where(sql`${t.unpinnedAt} is null`),
      index("message_pins_conversation_idx").on(t.conversationId, t.pinnedAt),
    ],
  )
  .enableRLS();

/** A poll is a message of kind 'poll' (its body is the question) plus these rows. Options and the question are encrypted. */
export const polls = chat
  .table("polls", {
    messageId: uuid("message_id")
      .primaryKey()
      .references(() => messages.id),
    /** People may pick several options. */
    multiple: boolean("multiple").notNull().default(false),
    /** Counts only: nobody sees who voted for what. */
    anonymous: boolean("anonymous").notNull().default(false),
  })
  .enableRLS();

export const pollOptions = chat
  .table(
    "poll_options",
    {
      id: uuid("id").primaryKey(),
      messageId: uuid("message_id")
        .notNull()
        .references(() => polls.messageId),
      position: smallint("position").notNull(),
      /** Encrypted with context "chat_poll_option:<messageId>:<optionId>". */
      labelEnc: text("label_enc").notNull(),
    },
    (t) => [uniqueIndex("poll_options_position_idx").on(t.messageId, t.position)],
  )
  .enableRLS();

export const pollVotes = chat
  .table(
    "poll_votes",
    {
      messageId: uuid("message_id")
        .notNull()
        .references(() => polls.messageId),
      optionId: uuid("option_id")
        .notNull()
        .references(() => pollOptions.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      votedAt: timestamp("voted_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.optionId, t.userId] }), index("poll_votes_message_idx").on(t.messageId, t.userId)],
  )
  .enableRLS();

/** A file, picture or voice note. Uploaded first (status 'pending'), checked by its bytes, then 'active'; it joins a message when that is sent. */
export const messageAttachments = chat
  .table(
    "message_attachments",
    {
      id: uuid("id").primaryKey(),
      conversationId: uuid("conversation_id")
        .notNull()
        .references(() => conversations.id),
      messageId: uuid("message_id").references(() => messages.id),
      uploaderUserId: uuid("uploader_user_id")
        .notNull()
        .references(() => users.id),
      kind: text("kind").notNull(),
      bucket: text("bucket").notNull(),
      path: text("path").notNull(),
      /** The real type, judged by the file's bytes (never the name or what the browser said). */
      mime: text("mime").notNull(),
      size: integer("size").notNull().default(0),
      sha256: text("sha256"),
      durationS: integer("duration_s"),
      /** The file name, encrypted with context "chat_attachment_name:<id>". */
      nameEnc: text("name_enc").notNull(),
      status: text("status").notNull().default("pending"),
      createdAt: createdAt(),
    },
    (t) => [
      uniqueIndex("message_attachments_path_idx").on(t.bucket, t.path),
      index("message_attachments_message_idx").on(t.messageId),
      index("message_attachments_uploader_idx").on(t.uploaderUserId, t.status, t.createdAt),
      check("message_attachments_kind_chk", sql`${t.kind} in ('image','file','voice')`),
      check("message_attachments_status_chk", sql`${t.status} in ('pending','active','rejected')`),
    ],
  )
  .enableRLS();

/**
 * The search index. A message's text is encrypted, so each word (and its first 3 to 10 letters) is stored only as a keyed hash
 * (see search-index.ts): search can find a word without the database ever holding it.
 */
export const searchTokens = chat
  .table(
    "search_tokens",
    {
      messageId: uuid("message_id")
        .notNull()
        .references(() => messages.id),
      conversationId: uuid("conversation_id")
        .notNull()
        .references(() => conversations.id),
      token: text("token").notNull(),
    },
    (t) => [primaryKey({ columns: [t.messageId, t.token] }), index("search_tokens_lookup_idx").on(t.conversationId, t.token, t.messageId)],
  )
  .enableRLS();

/** A person's own chat settings. No row means the defaults: appear online, daily email digest on. */
export const userSettings = chat
  .table("user_settings", {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id),
    /** Do not show "online" to others. */
    appearOffline: boolean("appear_offline").notNull().default(false),
    /** One email a day when there are unread messages (a count and a link, never the messages). */
    emailDigest: boolean("email_digest").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();
