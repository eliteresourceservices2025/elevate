"use client";

import {
  answerCallOffer,
  closeCallTracks,
  getIncomingCall,
  getLiveCall,
  joinCall,
  leaveCall,
  publishCallTracks,
  sendCallHeartbeat,
  startCall,
  endCallForEveryone,
  subscribeCallTracks,
} from "../actions";

// The browser's view of the server actions: each one returns its data or throws an Error with the plain message to show. Kept in one place
// so the transport and the provider never deal with { ok, error } shapes, and so tests can swap it.

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await promise;
  } catch {
    throw new Error("Could not reach ELEVATE. Check your connection and try again.");
  }
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

export const callApi = {
  start: (conversationId: string) => unwrap(startCall({ conversationId })),
  join: (callId: string) => unwrap(joinCall({ callId })),
  heartbeat: (callId: string) => unwrap(sendCallHeartbeat({ callId })),
  leave: (callId: string) => unwrap(leaveCall({ callId })),
  end: (callId: string) => unwrap(endCallForEveryone({ callId })),
  publish: (callId: string, offerSdp: string, tracks: { mid: string; kind: "audio" | "video" | "screen" }[]) => unwrap(publishCallTracks({ callId, offer: { type: "offer", sdp: offerSdp }, tracks })),
  close: (callId: string, trackNames: string[]) => unwrap(closeCallTracks({ callId, trackNames })),
  subscribe: (callId: string, trackNames: string[]) => unwrap(subscribeCallTracks({ callId, trackNames })),
  answer: (callId: string, sdp: string) => unwrap(answerCallOffer({ callId, answer: { type: "answer", sdp } })),
  live: (conversationId: string) => unwrap(getLiveCall({ conversationId })),
  incoming: (callId: string) => unwrap(getIncomingCall({ callId })),
};

export type CallApi = typeof callApi;
