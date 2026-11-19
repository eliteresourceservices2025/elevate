"use client";

import {
  answerCallOffer,
  closeCallTracks,
  muteCallParticipant,
  removeCallParticipant,
  unsubscribeCallTracks,
  getIncomingCall,
  getLiveCall,
  joinCall,
  leaveCall,
  publishCallTracks,
  sendCallHeartbeat,
  startCall,
  endCallForEveryone,
  subscribeCallTracks,
  setCallSpeaker,
  startCallRecording,
  stopCallRecording,
  answerCallRecording,
  requestRecordingUpload,
  finishRecordingUpload,
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
  start: (conversationId: string, mode: "meeting" | "townhall" = "meeting") => unwrap(startCall({ conversationId, mode })),
  join: (callId: string) => unwrap(joinCall({ callId })),
  heartbeat: (callId: string) => unwrap(sendCallHeartbeat({ callId })),
  leave: (callId: string) => unwrap(leaveCall({ callId })),
  end: (callId: string) => unwrap(endCallForEveryone({ callId })),
  publish: (callId: string, offerSdp: string, tracks: { mid: string; kind: "audio" | "video" | "screen" }[]) => unwrap(publishCallTracks({ callId, offer: { type: "offer", sdp: offerSdp }, tracks })),
  close: (callId: string, trackNames: string[]) => unwrap(closeCallTracks({ callId, trackNames })),
  subscribe: (callId: string, trackNames: string[]) => unwrap(subscribeCallTracks({ callId, trackNames })),
  answer: (callId: string, sdp: string) => unwrap(answerCallOffer({ callId, answer: { type: "answer", sdp } })),
  mute: (callId: string, userId: string) => unwrap(muteCallParticipant({ callId, userId })),
  remove: (callId: string, userId: string) => unwrap(removeCallParticipant({ callId, userId })),
  setSpeaker: (callId: string, userId: string, speaker: boolean) => unwrap(setCallSpeaker({ callId, userId, speaker })),
  startRecording: (callId: string) => unwrap(startCallRecording({ callId })),
  stopRecording: (callId: string) => unwrap(stopCallRecording({ callId })),
  answerRecording: (callId: string, answer: "allow" | "decline") => unwrap(answerCallRecording({ callId, answer })),
  requestPart: (recordingId: string, seq: number) => unwrap(requestRecordingUpload({ recordingId, seq })),
  finishPart: (recordingId: string, seq: number) => unwrap(finishRecordingUpload({ recordingId, seq })),
  unsubscribe: (callId: string, mids: string[]) => unwrap(unsubscribeCallTracks({ callId, mids })),
  live: (conversationId: string) => unwrap(getLiveCall({ conversationId })),
  incoming: (callId: string) => unwrap(getIncomingCall({ callId })),
};

export type CallApi = typeof callApi;
