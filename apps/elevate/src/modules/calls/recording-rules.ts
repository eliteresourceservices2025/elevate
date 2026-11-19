// The rules of call recording as plain functions (no server-only import), so the server and the browser share them and they can be tested.
// Owner decisions (2026-11-17/18): only people a Super Admin picks may record; everyone in the call says yes first (nobody is recorded
// before a yes, and a person can take it back); never in a client group or with a guest; kept 30 days, then deleted.

export const RECORDING_RETENTION_DAYS = 30;
/** One piece of a recording is about 10 MB (the browser cuts it); the server and the bucket refuse anything over this. */
export const RECORDING_PART_MAX_BYTES = 24 * 1024 * 1024;
/** What the browser aims for when it cuts a piece. */
export const RECORDING_PART_TARGET_BYTES = 8 * 1024 * 1024;
/** A recording stops by itself at this size (about 4 hours at 1 Mbps). */
export const RECORDING_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const RECORDING_MAX_PARTS = 600;
/** After a recording ends its last piece may still arrive for this long. */
export const UPLOAD_GRACE_MINUTES = 10;

export type ConsentAnswer = "allow" | "decline";
export type EndReason = "stopped" | "recorder_left" | "call_ended" | "guest_joined" | "too_big";

/** What everyone in the call sees; `allowedUserIds` is filled in only for the person recording (they need it to know whom to include). */
export type RecordingInfo = {
  id: string;
  recorderUserId: string;
  recorderName: string;
  startedAt: string;
  myAnswer: ConsentAnswer | null;
  allowedUserIds: string[];
};

/** Why a recording may not start, in plain words; null when it may. */
export function recordingRefusal(input: { settingOn: boolean; conversationKind: string; guestInCall: boolean; alreadyRecording: boolean; isGuest: boolean }): string | null {
  if (input.isGuest) return "You can't record a call.";
  if (!input.settingOn) return "Recording is switched off.";
  // A client group is where guests live: never recorded, whoever is in it today.
  if (input.conversationKind === "client") return "Calls with clients are never recorded.";
  if (input.guestInCall) return "A guest is in this call, so it can't be recorded.";
  if (input.alreadyRecording) return "This call is already being recorded.";
  return null;
}

/** Each person's LATEST answer (a changed mind counts, the older answer does not). */
export function latestAnswers(rows: { userId: string; answer: string; answeredAt: Date | string }[]): Map<string, ConsentAnswer> {
  const newest = new Map<string, { at: number; answer: ConsentAnswer }>();
  for (const row of rows) {
    if (row.answer !== "allow" && row.answer !== "decline") continue;
    const at = new Date(row.answeredAt).getTime();
    const seen = newest.get(row.userId);
    if (!seen || at >= seen.at) newest.set(row.userId, { at, answer: row.answer });
  }
  return new Map([...newest].map(([userId, v]) => [userId, v.answer]));
}

/** Only people who are in the call right now and whose latest answer is yes may appear in the recording. */
export function allowedForRecording(answers: Map<string, ConsentAnswer>, presentUserIds: string[]): string[] {
  return presentUserIds.filter((id) => answers.get(id) === "allow");
}

/**
 * Which picture goes into the recording: a shared screen first, then the person pinned or speaking, then anyone with video. Only people
 * who agreed (`allowed`) can be chosen; null means a plain title card (no one agreed to be filmed, or nobody has video on).
 */
export function pickRecordedVideo(input: {
  allowed: string[];
  pinnedUserId: string | null;
  activeSpeakerId: string | null;
  hasVideo: Record<string, boolean>;
  hasScreen: Record<string, boolean>;
}): { userId: string; slot: "main" | "screen" } | null {
  const allowed = new Set(input.allowed);
  const screen = input.allowed.find((id) => input.hasScreen[id]);
  if (screen) return { userId: screen, slot: "screen" };
  for (const id of [input.pinnedUserId, input.activeSpeakerId, ...input.allowed]) {
    if (id && allowed.has(id) && input.hasVideo[id]) return { userId: id, slot: "main" };
  }
  return null;
}

/** The first piece of a WebM file begins with the EBML header. Later pieces are continuations and have no header. */
export function startsWithEbml(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

/** When the pieces of a recording the browser has cut should be sent: once enough has built up (or at the end, whatever is left). */
export function shouldCutPart(bufferedBytes: number, ending: boolean): boolean {
  return bufferedBytes > 0 && (ending || bufferedBytes >= RECORDING_PART_TARGET_BYTES);
}
