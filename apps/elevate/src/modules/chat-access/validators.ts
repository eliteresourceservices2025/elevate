import { z } from "zod";

const id = z.uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
export const REASON_MIN = 10;
export const REASON_MAX = 1000;
const reason = z.string().trim().min(REASON_MIN, `Say why, in at least ${REASON_MIN} characters.`).max(REASON_MAX);

export const requestAccessSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat"), conversationId: id, from: day, to: day, reason }),
  z.object({ kind: z.literal("recording"), recordingId: id, reason }),
]);
export const decideAccessSchema = z.object({ requestId: id, approve: z.boolean(), note: z.string().trim().max(500).optional() });
export const requestIdSchema = z.object({ requestId: id });
