import { z } from "zod";
import { MESSAGE_MAX, REPORT_TYPES } from "./constants";

export const reportRefSchema = z.object({ type: z.enum(REPORT_TYPES), id: z.uuid() });
export const postReportMessageSchema = reportRefSchema.extend({
  body: z.string().trim().min(1, "Write a message").max(MESSAGE_MAX, `Use ${MESSAGE_MAX.toLocaleString("en-US")} characters or fewer`),
});
