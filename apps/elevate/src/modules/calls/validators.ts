import { z } from "zod";
import { isSafeTrackName } from "./sfu-rules";

const id = z.uuid();
const trackName = z.string().refine(isSafeTrackName, "Invalid track.");
const mid = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, "Invalid track.");
const sdp = z.string().min(1).max(60_000);

export const startCallSchema = z.object({ conversationId: id });
export const callIdSchema = z.object({ callId: id });
export const liveCallSchema = z.object({ conversationId: id });

export const publishTracksSchema = z.object({
  callId: id,
  offer: z.object({ type: z.literal("offer"), sdp }),
  tracks: z.array(z.object({ mid, kind: z.enum(["audio", "video", "screen"]) })).min(1).max(4),
});
export const closeTracksSchema = z.object({ callId: id, trackNames: z.array(trackName).min(1).max(8) });
export const subscribeTracksSchema = z.object({ callId: id, trackNames: z.array(trackName).min(1).max(64) });
export const renegotiateSchema = z.object({ callId: id, answer: z.object({ type: z.literal("answer"), sdp }) });
