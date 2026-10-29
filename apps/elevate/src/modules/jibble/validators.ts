import { z } from "zod";

export const setPersonSchema = z.object({
  employeeId: z.uuid(),
  /** The email used in Jibble, the member code, or Jibble's person id; empty removes a hand-made match. The server finds the account. */
  jibblePersonId: z.preprocess((v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v), z.string().max(120, "That is too long").nullable()),
});
export const retrySchema = z.object({ logId: z.uuid() });
export const mismatchReviewSchema = z.object({ mismatchId: z.uuid(), note: z.string().trim().max(300).optional() });
export const operationRecoverySchema = z.object({ employeeId: z.uuid() });
export const pauseSchema = z.object({ paused: z.boolean() });
