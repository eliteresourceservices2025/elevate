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

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => Number.isFinite(Date.parse(`${v}T00:00:00Z`)), "Not a date");

export const daySchema = z.object({ date: dateOnly });
export const personDaySchema = z.object({ employeeId: uuid, date: dateOnly });
export const floorSchema = z.object({ teamId: uuid.optional() });
export const deviceListSchema = z.object({ employeeId: uuid.optional() });

export const SHOT_VIEW_REASONS = ["quality_check", "dispute", "coaching", "client_request"] as const;
export const viewShotSchema = z.object({ shotId: uuid, reason: z.enum(SHOT_VIEW_REASONS) });

export const categorySchema = z.object({
  pattern: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((p) => {
      try {
        new RegExp(p, "i");
        return true;
      } catch {
        return false;
      }
    }, "Not a valid pattern"),
  category: z.enum(["work", "non_work"]),
  rank: z.number().int().min(1).max(100),
});
