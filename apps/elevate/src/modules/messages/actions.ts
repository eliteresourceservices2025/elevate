"use server";

import type { z } from "zod";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import * as queries from "./queries";
import type { ChatMessage, ConversationSummary, ManagedGroup } from "./queries";
import { syncChannels, type SyncResult } from "./channels";
import * as service from "./service";
import { writeAudit } from "@/modules/audit/write";
import {
  addMembersSchema,
  createGroupSchema,
  createPollSchema,
  deleteGroupSchema,
  deleteMessageSchema,
  editMessageSchema,
  markReadSchema,
  openDirectSchema,
  pinSchema,
  reactSchema,
  removeMemberSchema,
  renameGroupSchema,
  sendMessageSchema,
  votePollSchema,
} from "./validators";

// Every action: who is calling (requireUser), may they chat at all (authorize), is the input valid (Zod), and only then the domain
// function, which checks membership. Failures become plain messages; nothing here ever logs message text.
// (Not exported, so it is not an endpoint.)

const BAD = "Check the request and try again.";
type Actor = Awaited<ReturnType<typeof requireUser>>;

function run<S extends z.ZodType, T>(
  actor: Actor,
  action: "messages.use" | "messages.create_group" | "messages.manage_group",
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
  return run(actor, "messages.use", sendMessageSchema, input, (a, data) => service.sendMessage(a, { ...data, canManage: can(a, "messages.manage_group") }));
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
  return run(actor, "messages.manage_group", addMembersSchema, input, async (a, data) => void (await service.addMembers(a, data.conversationId, data.userIds)));
}

export async function removeGroupMember(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "messages.manage_group", removeMemberSchema, input, async (a, data) => void (await service.removeMember(a, data)));
}

export async function renameGroupChat(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "messages.manage_group", renameGroupSchema, input, async (a, data) => void (await service.renameGroup(a, data)));
}

export async function deleteGroupChat(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "messages.manage_group", deleteGroupSchema, input, async (a, data) => void (await service.deleteGroup(a, data.conversationId)));
}

export async function listGroupsToManage(): Promise<ActionResult<ManagedGroup[]>> {
  await requireUser();
  return runAction(async () => ({ ok: true, data: await queries.listManagedGroups() }));
}

export async function loadGroupPeopleToManage(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof queries.loadGroupPeople>>>> {
  await requireUser();
  return runAction(async () => ({ ok: true, data: await queries.loadGroupPeople(input) }));
}

export async function toggleChatReaction(input: unknown): Promise<ActionResult<{ active: boolean }>> {
  const actor = await requireUser();
  return run(actor, "messages.use", reactSchema, input, (a, data) => service.toggleReaction(a, data));
}

export async function pinChatMessage(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "messages.use", pinSchema, input, async (a, data) => void (await service.pinMessage(a, data)));
}

export async function unpinChatMessage(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "messages.use", pinSchema, input, async (a, data) => void (await service.unpinMessage(a, data)));
}

export async function loadChatThread(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof queries.loadThread>>>> {
  await requireUser();
  return runAction(async () => ({ ok: true, data: await queries.loadThread(input) }));
}

export async function listChatPins(input: unknown): Promise<ActionResult<queries.PinnedMessage[]>> {
  await requireUser();
  return runAction(async () => ({ ok: true, data: await queries.listPins(input) }));
}

/** HR's "Update channels now": brings the team, department and company channels in line with the organization. */
export async function syncChatChannels(): Promise<ActionResult<SyncResult & { skipped?: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "messages.manage_group");
    const result = await syncChannels();
    await writeAudit({ actor, action: "chat.channels.sync", targetType: "chat_channels", metadata: { ...result } });
    return { ok: true, data: result };
  });
}

export async function createChatPoll(input: unknown): Promise<ActionResult<{ id: string; seq: number }>> {
  const actor = await requireUser();
  return run(actor, "messages.use", createPollSchema, input, (a, data) => service.createPoll(a, { ...data, canManage: can(a, "messages.manage_group") }));
}

export async function voteChatPoll(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "messages.use", votePollSchema, input, async (a, data) => void (await service.votePoll(a, data)));
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

export type { ChatMessage, ConversationSummary, ManagedGroup };
