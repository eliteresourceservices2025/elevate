"use server";

import type { z } from "zod";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import * as service from "./service";
import * as settings from "./settings";
import { callsAvailable } from "./sfu-port";
import { callIdSchema, callSettingsSchema, callUserSchema, closeTracksSchema, unsubscribeSchema, liveCallSchema, publishTracksSchema, renegotiateSchema, startCallSchema, subscribeTracksSchema } from "./validators";

// Every action: who is calling (requireUser), may they use calls at all (authorize), is the input valid (Zod), and only then the domain
// function in service.ts, which checks membership. A guest has no calls permission: they pass through Messages access (messages.use) and
// can join a client group's call, never start one. Failures become plain messages; no media, text or ids of other people are logged.

const BAD = "Check the request and try again.";
const OFF = "Calls aren't set up yet. Ask an administrator.";
type Actor = Awaited<ReturnType<typeof requireUser>>;
type Policy = "callRing" | "callJoin" | "callMedia";

function run<S extends z.ZodType, T>(actor: Actor, action: "calls.start" | "calls.join" | "messages.use", schema: S, input: unknown, policy: Policy, body: (data: z.infer<S>) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(async () => {
    await authorize(actor, action, { ownerUserId: actor.id });
    const parsed = schema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    if (!callsAvailable()) return fail(OFF);
    if (!(await allowRequest(policy, actor.id))) return fail("Too many requests. Wait a moment and try again.");
    return { ok: true, data: await body(parsed.data) };
  });
}

/** A guest's calls access is their Messages access (own, plus membership checked in the service). */
const joinAction = (actor: Actor) => (actor.isGuest ? "messages.use" : "calls.join");

export async function startCall(input: unknown): Promise<ActionResult<{ callId: string; created: boolean }>> {
  const actor = await requireUser();
  return run(actor, "calls.start", startCallSchema, input, "callRing", (data) => service.startCall(actor, data));
}

export async function joinCall(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof service.joinCall>>>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), callIdSchema, input, "callJoin", (data) => service.joinCall(actor, data));
}

export async function sendCallHeartbeat(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof service.heartbeat>>>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), callIdSchema, input, "callMedia", (data) => service.heartbeat(actor, data));
}

export async function leaveCall(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), callIdSchema, input, "callJoin", async (data) => void (await service.leaveCall(actor, data)));
}

export async function endCallForEveryone(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return run(actor, "calls.start", callIdSchema, input, "callJoin", async (data) => void (await service.endCall(actor, data)));
}

export async function publishCallTracks(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof service.publishTracks>>>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), publishTracksSchema, input, "callMedia", (data) => service.publishTracks(actor, data));
}

export async function closeCallTracks(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), closeTracksSchema, input, "callMedia", async (data) => void (await service.closeTracks(actor, data)));
}

export async function subscribeCallTracks(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof service.subscribeTracks>>>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), subscribeTracksSchema, input, "callMedia", (data) => service.subscribeTracks(actor, data));
}

export async function answerCallOffer(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), renegotiateSchema, input, "callMedia", async (data) => void (await service.renegotiate(actor, data)));
}

export async function muteCallParticipant(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), callUserSchema, input, "callMedia", async (data) => void (await service.muteParticipant(actor, data)));
}

export async function removeCallParticipant(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), callUserSchema, input, "callMedia", async (data) => void (await service.removeParticipant(actor, data)));
}

export async function unsubscribeCallTracks(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), unsubscribeSchema, input, "callMedia", async (data) => void (await service.unsubscribeTracks(actor, data)));
}

/** Super Admin: the warning level and the all-hands switch. Works without Cloudflare set up. */
export async function saveCallSettings(input: unknown): Promise<ActionResult<undefined>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "calls.settings");
    const parsed = callSettingsSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    await settings.saveCallSettings(actor, parsed.data);
    return { ok: true, data: undefined };
  });
}

/** Is a call live in this chat (for the "Join" banner and the call button)? */
export async function getLiveCall(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof service.getLiveCall>>>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), liveCallSchema, input, "callMedia", (data) => service.getLiveCall(actor, data));
}

/** The pop-up for a ring: who is calling and where; null when the call is over, already joined, or the chat is muted. */
export async function getIncomingCall(input: unknown): Promise<ActionResult<Awaited<ReturnType<typeof service.incomingCall>>>> {
  const actor = await requireUser({ allowGuest: true });
  return run(actor, joinAction(actor), callIdSchema, input, "callMedia", (data) => service.incomingCall(actor, data));
}
