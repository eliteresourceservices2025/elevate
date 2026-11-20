import { z } from "zod";
import { SEGMENT_STATES, TRACKER_OS } from "./schema";

const uuid = z.uuid();

export const revokeDeviceSchema = z.object({ deviceId: uuid });

/** What the app sends to trade a typed code for a device token. */
export const enrollBodySchema = z.object({
  code: z.string().min(4).max(32),
  name: z.string().trim().min(1).max(60),
  os: z.enum(TRACKER_OS),
  appVersion: z.string().trim().min(1).max(32),
});

const isoTime = z.string().refine((v) => Number.isFinite(Date.parse(v)), "Not a time");

/** A batch of merged stretches from the app. Only an app name: there is no title or URL field. */
export const segmentsBodySchema = z.object({
  segments: z
    .array(z.object({ start: isoTime, end: isoTime, app: z.string().max(120), state: z.enum(SEGMENT_STATES) }))
    .min(1)
    .max(200),
  appVersion: z.string().trim().min(1).max(32).optional(),
  permissionsOk: z.boolean().optional(),
  queueSize: z.number().int().min(0).max(1_000_000).optional(),
});
export type SegmentsBody = z.infer<typeof segmentsBodySchema>;

export const shotRequestSchema = z.object({ takenAt: isoTime });
export const shotFinalizeSchema = z.object({ shotId: uuid });
