"use server";

import type { z } from "zod";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import * as queries from "./queries";
import type { ChatMessage, ConversationSummary } from "./queries";
import * as service from "./service";
import {
  addMembersSchema,
  createGroupSchema,
  deleteMessageSchema,
  editMessageSchema,
  leaveSchema,
  markReadSchema,
  openDirectSchema,
  sendMessageSchema,
} from "./validators";

// Every action: who is calling (requireUser), may they chat at all (authorize), is the input valid (Zod), and only then the domain
// function, which checks membership. Failures become plain messages; nothing here ever logs message text.
// (Not exported, so it is not an endpoint.)

const BAD = "Check the request and try again.";
type Actor = Awaited<ReturnType<typeof requireUser>>;

function run<S extends z.ZodType, T>(
  actor: Actor,
  action: "messages.use" | "messages.create_group",
  schema: S,
  input: unknown,
  body: (actor: Actor, data: z.infer<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  return runAction(async () => {
    await authorize(actor, action, { ownerUserId: actor.id });
    const parsed = schema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    return { ok: true, data: await body(actor, parsed.data) };
  });
}

export async function openDirectMessage(input: unknown): Promise<ActionResult<{ conversationId: string }>> {
  const actor = await requireUser();
  return run(actor, "messages.use", openDirectSchema, input, async (a, data) => ({ conversationId: (await service.openDirect(a, data.userId)).conversationId }));
}

export async function createGroupConversation(input: unknown): Promise<ActionResult<{ conversationId: string }>> {
  const actor = await requireUser();
  return run(actor, "messages.create_group", createGroupSchema, input, (a, data) => service.createGroup(a, data));
}

export async function sendChatMessage(input: unknown): Promise<ActionResult<{ id: string; seq: number }>> {
  const actor = await requireUser();
  return run(actor, "messages.use", sendMessageSchema, input, (a, data) => service.sendMessage(a, data));
}

export async function editChatMessage(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "messages.use", editMessageSchema, input, async (a, data) => void (await service.editMessage(a, data)));
}

export async function deleteChatMessage(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "messages.use", deleteMessageSchema, input, async (a, data) => void (await service.deleteMessage(a, data.messageId)));
}

export async function markConversationRead(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "messages.use", markReadSchema, input, async (a, data) => void (await service.markRead(a, data)));
}

export async function addGroupMembers(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "messages.use", addMembersSchema, input, async (a, data) => void (await service.addMembers(a, data.conversationId, data.userIds)));
}

export async function leaveGroupConversation(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "messages.use", leaveSchema, input, async (a, data) => void (await service.leaveConversation(a, data.conversationId)));
}

export async function loadChatMessages(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof queries.loadMessages>>>> {
  await requireUser();
  return runAction(async () => ({ ok: true, data: await queries.loadMessages(input) }));
}

export async function loadConversationList(): Promise<ActionResult<ConversationSummary[]>> {
  await requireUser();
  return runAction(async () => ({ ok: true, data: await queries.listMyConversations() }));
}

export async function searchPeopleForChat(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof queries.searchChatPeople>>>> {
  await requireUser();
  return runAction(async () => ({ ok: true, data: await queries.searchChatPeople(input) }));
}

export type { ChatMessage, ConversationSummary };
