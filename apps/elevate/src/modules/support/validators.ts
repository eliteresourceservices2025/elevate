import { z } from "zod";
import { MESSAGE_MAX, SUBJECT_MAX, TOPIC_VALUES } from "./constants";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const supportRequestSchema = z.object({
  topic: z.enum(TOPIC_VALUES),
  subject: z.string().trim().min(3, "Give it a short title").max(SUBJECT_MAX, `Use ${SUBJECT_MAX} characters or fewer`),
  message: z.string().trim().min(10, "Tell us a little more so we can help").max(MESSAGE_MAX, `Use ${MESSAGE_MAX} characters or fewer`),
  /** A page of ELEVATE the person was on. Only a path inside the app is kept. */
  page: z.preprocess(blankToUndefined, z.string().trim().max(200).regex(/^\/(?!\/)[A-Za-z0-9/_\-.?=&%#]*$/, "That is not a page of ELEVATE").optional()),
});

export const closeSupportRequestSchema = z.object({ id: z.string().uuid("Invalid id"), reopen: z.boolean().default(false) });
