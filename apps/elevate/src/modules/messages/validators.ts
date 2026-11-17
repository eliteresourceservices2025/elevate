import { z } from "zod";

// One schema per action, used by the server action (never trust the form alone).

export const MAX_BODY = 4000;
/** People in a group in total: at least 3, at most 200 (owner decision 2026-11-17, with the company growing in mind). */
export const MIN_GROUP = 3;
export const MAX_GROUP = 200;
/** People added to a group in one go (up to 200 can be there in total). */
export const MAX_ADD_AT_ONCE = 50;
export const MAX_TITLE = 80;
export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

const id = z.uuid();
const body = z
  .string()
  .trim()
  .min(1, "Write a message first.")
  .max(MAX_BODY, `Messages can be up to ${MAX_BODY} characters.`);

// A message with attachments may have no text (a picture or a voice note on its own).
const caption = z.string().trim().max(MAX_BODY, `Messages can be up to ${MAX_BODY} characters.`);
export const sendMessageSchema = z
  .object({ conversationId: id, body: caption, threadRootId: id.optional(), attachmentIds: z.array(id).max(5).optional() })
  .refine((m) => m.body.length > 0 || (m.attachmentIds?.length ?? 0) > 0, { message: "Write a message first.", path: ["body"] });
export const editMessageSchema = z.object({ messageId: id, body });
export const deleteMessageSchema = z.object({ messageId: id });
export const openDirectSchema = z.object({ userId: id });

export const createGroupSchema = z.object({
  title: z.string().trim().min(1, "Give the group a name.").max(MAX_TITLE),
  memberUserIds: z
    .array(id)
    .min(MIN_GROUP - 1, "A group needs at least 3 people, including you.")
    .max(MAX_GROUP - 1, `A group can have up to ${MAX_GROUP} people.`)
    .refine((ids) => new Set(ids).size === ids.length, "Each person can be added once."),
});

export const addMembersSchema = z.object({
  conversationId: id,
  userIds: z
    .array(id)
    .min(1)
    .max(MAX_ADD_AT_ONCE, `Add up to ${MAX_ADD_AT_ONCE} people at a time.`)
    .refine((ids) => new Set(ids).size === ids.length, "Each person can be added once."),
});

export const renameGroupSchema = z.object({ conversationId: id, title: z.string().trim().min(1, "Give the group a name.").max(MAX_TITLE) });
export const removeMemberSchema = z.object({ conversationId: id, userId: id });
export const deleteGroupSchema = z.object({ conversationId: id });

export const loadMessagesSchema = z.object({
  conversationId: id,
  beforeSeq: z.number().int().min(0).optional(),
  afterSeq: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(PAGE_SIZE),
});

export const markReadSchema = z.object({ conversationId: id, seq: z.number().int().min(0) });
export const searchPeopleSchema = z.object({ q: z.string().trim().max(60) });

export const loadThreadSchema = z.object({ conversationId: id, rootId: id });
export const reactSchema = z.object({ messageId: id, emoji: z.string().min(1).max(16) });
export const pinSchema = z.object({ messageId: id });

export const MAX_POLL_OPTIONS = 10;
export const createPollSchema = z.object({
  conversationId: id,
  question: z.string().trim().min(1, "Write the question.").max(200),
  options: z.array(z.string().trim().min(1, "An option can't be empty.").max(100)).min(2, "A poll needs at least 2 options.").max(MAX_POLL_OPTIONS),
  multiple: z.boolean().default(false),
  anonymous: z.boolean().default(false),
});
export const votePollSchema = z.object({ messageId: id, optionId: id });

export const requestUploadSchema = z.object({
  conversationId: id,
  fileName: z.string().min(1).max(200),
  size: z.number().int().min(1),
  mime: z.string().min(1).max(100),
  kind: z.enum(["image", "file", "voice"]),
  durationS: z.number().int().min(0).max(100000).optional(),
});
export const finalizeUploadSchema = z.object({ attachmentId: id });

export const searchMessagesSchema = z.object({ q: z.string().trim().max(100) });

export const inviteGuestSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254), clientId: id });
export const archiveGuestSchema = z.object({ userId: id });
export const createClientGroupSchema = z.object({
  clientId: id,
  title: z.string().trim().min(1, "Give the group a name.").max(MAX_TITLE),
  guestUserIds: z.array(id).max(MAX_GROUP),
  staffUserIds: z.array(id).max(MAX_GROUP),
});

export const searchGifsSchema = z.object({ q: z.string().trim().min(1).max(60) });
export const sendGifSchema = z.object({ conversationId: id, url: z.string().max(600), threadRootId: id.optional() });

export const muteSchema = z.object({ conversationId: id, until: z.enum(["1h", "8h", "forever", "off"]) });
export const chatSettingsSchema = z.object({ appearOffline: z.boolean(), emailDigest: z.boolean() });
