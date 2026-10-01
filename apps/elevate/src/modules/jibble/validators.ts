import { z } from "zod";

export const setPersonSchema = z.object({
  employeeId: z.uuid(),
  /** Jibble's id for the person (from Jibble), or empty to remove a hand-made match. */
  jibblePersonId: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.uuid("Paste the Jibble person id").nullable()),
});
export const retrySchema = z.object({ logId: z.uuid() });
