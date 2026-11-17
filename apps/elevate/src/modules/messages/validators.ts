import { z } from "zod";

// One schema per action, used by the server action (never trust the form alone).

export const MAX_BODY = 4000;
/** People in a group besides the creator: at least 2 (a group is 3 or more in total), at most 49 (50 in total). */
export const MIN_GROUP = 3;
export const MAX_GROUP = 50;
export const MAX_TITLE = 80;
export const PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

const id = z.uuid();
const body = z
  .string()
  .trim()
  .min(1, "Write a message first.")
  .max(MAX_BODY, `Messages can be up to ${MAX_BODY} characters.`);

export const sendMessageSchema = z.object({ conversationId: id, body });
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
    .max(20)
    .refine((ids) => new Set(ids).size === ids.length, "Each person can be added once."),
});

export const leaveSchema = z.object({ conversationId: id });

export const loadMessagesSchema = z.object({
  conversationId: id,
  beforeSeq: z.number().int().min(0).optional(),
  afterSeq: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(PAGE_SIZE),
});

export const markReadSchema = z.object({ conversationId: id, seq: z.number().int().min(0) });
export const searchPeopleSchema = z.object({ q: z.string().trim().max(60) });
