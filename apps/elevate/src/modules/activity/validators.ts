import { z } from "zod";
import { TRACKER_OS } from "./schema";

const uuid = z.uuid();

export const revokeDeviceSchema = z.object({ deviceId: uuid });

/** What the app sends to trade a typed code for a device token. */
export const enrollBodySchema = z.object({
  code: z.string().min(4).max(32),
  name: z.string().trim().min(1).max(60),
  os: z.enum(TRACKER_OS),
  appVersion: z.string().trim().min(1).max(32),
});
