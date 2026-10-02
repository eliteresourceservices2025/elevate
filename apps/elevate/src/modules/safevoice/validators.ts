import { z } from "zod";
import { SAFEVOICE_OUTCOMES } from "./constants";

const uuid = z.string().uuid("Invalid id");
const body = (label: string) => z.string().trim().min(1, `Write ${label} first.`).max(4000, "Keep it under 4,000 characters.");

export const caseIdSchema = z.object({ caseId: uuid });
export const replySchema = z.object({ caseId: uuid, body: body("a reply"), expectReply: z.boolean() });
/** Handlers move a case between "in review" and "waiting for the reporter" (also how a closed case is reopened). Closing has its own action. */
export const statusSchema = z.object({ caseId: uuid, status: z.enum(["in_review", "awaiting_reporter"]) });
export const closeSchema = z.object({
  caseId: uuid,
  outcome: z.enum(SAFEVOICE_OUTCOMES, { error: "Choose an outcome." }),
  message: z.string().trim().max(4000, "Keep it under 4,000 characters.").optional(),
});

export const LIST_FILTERS = ["open", "new", "in_review", "awaiting_reporter", "closed", "all"] as const;
export const listFilterSchema = z.enum(LIST_FILTERS).catch("open");
