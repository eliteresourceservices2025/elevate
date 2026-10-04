import { z } from "zod";

const uuid = z.string().uuid("Invalid id");

export const batchIdSchema = z.object({ batchId: uuid });
export const commitSchema = z.object({ batchId: uuid, skipErrors: z.boolean().default(false) });
export const dateFormatSchema = z.enum(["mdy", "dmy", "iso"]);

/** What the upload form sends next to the file. */
export const stageFormSchema = z.object({
  dateFormat: dateFormatSchema.default("mdy"),
  mapping: z.record(z.string().max(120), z.string().max(80)),
});
