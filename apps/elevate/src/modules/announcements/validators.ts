import { z } from "zod";
import { MARKDOWN_MAX_LENGTH } from "@/lib/markdown";
import { isoDate } from "@/modules/people/validators";

const uuid = z.uuid();
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalDate = z.preprocess(blankToUndefined, isoDate.optional());
const title = z.string().trim().min(3, "Enter a title of at least 3 characters").max(120, "Use 120 characters or fewer");
const body = z.string().trim().min(1, "Write the message").max(MARKDOWN_MAX_LENGTH, `Use ${MARKDOWN_MAX_LENGTH.toLocaleString("en-US")} characters or fewer`);

const dueRule = (v: { requiresAck: boolean; dueOn?: string }) => !v.dueOn || v.requiresAck;
const DUE_MESSAGE = "A due date only applies when acknowledgment is required";

export const announcementSchema = z
  .object({
    title,
    body,
    audience: z.enum(["all", "teams"]),
    teamIds: z.array(uuid).max(50).default([]),
    pinned: z.boolean().default(false),
    requiresAck: z.boolean().default(false),
    dueOn: optionalDate,
    attachmentDocumentId: z.preprocess(blankToUndefined, uuid.optional()),
  })
  .refine(dueRule, { message: DUE_MESSAGE, path: ["dueOn"] })
  .refine((v) => v.audience === "all" || v.teamIds.length > 0, { message: "Choose at least one team", path: ["teamIds"] });

/** Audience and "requires acknowledgment" are fixed once posted; everything else can be edited. */
export const updateAnnouncementSchema = z.object({
  announcementId: uuid,
  title,
  body,
  pinned: z.boolean().default(false),
  dueOn: optionalDate,
  attachmentDocumentId: z.preprocess(blankToUndefined, uuid.optional()),
});

export const announcementIdSchema = z.object({ announcementId: uuid });

/** For policies, id is the policy VERSION id: people acknowledge a specific version. */
export const subjectSchema = z.object({ kind: z.enum(["announcement", "policy_version"]), id: uuid });
export const acknowledgeSchema = subjectSchema;

export const createPolicySchema = z.object({ title, body, requiresAck: z.boolean().default(true), dueOn: optionalDate });

export const saveDraftSchema = z
  .object({
    policyId: uuid,
    body,
    changeNote: z.preprocess(blankToUndefined, z.string().trim().max(500, "Use 500 characters or fewer").optional()),
    requiresAck: z.boolean().default(true),
    dueOn: optionalDate,
  })
  .refine(dueRule, { message: DUE_MESSAGE, path: ["dueOn"] });

export const policyIdSchema = z.object({ policyId: uuid });

export const digestPreferenceSchema = z.object({ optOut: z.boolean() });

export type AnnouncementInput = z.input<typeof announcementSchema>;
