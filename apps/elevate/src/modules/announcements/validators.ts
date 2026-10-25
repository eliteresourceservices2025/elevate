import { z } from "zod";
import { MARKDOWN_MAX_LENGTH } from "@/lib/markdown";
import { MAX_VIDEO_BYTES } from "@/modules/documents/files";
import { isoDate } from "@/modules/people/validators";

const uuid = z.uuid();
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalDate = z.preprocess(blankToUndefined, isoDate.optional());
const title = z.string().trim().min(3, "Enter a title of at least 3 characters").max(120, "Use 120 characters or fewer");
const body = z.string().trim().min(1, "Write the message").max(MARKDOWN_MAX_LENGTH, `Use ${MARKDOWN_MAX_LENGTH.toLocaleString("en-US")} characters or fewer`);

/** Ids of the pictures and files shown with the item (uploaded first, bound when saved). */
const attachmentIds = z.array(uuid).max(12, "At most 12 pictures and files").default([]);

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
    attachmentIds,
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
  attachmentIds,
  /** The revision the editor was opened on; refused when the announcement changed since. */
  expectedRevision: z.string().regex(/^\d{1,16}$/).optional(),
});

export const announcementIdSchema = z.object({ announcementId: uuid });

/** For policies, id is the policy VERSION id: people acknowledge a specific version. */
export const subjectSchema = z.object({ kind: z.enum(["announcement", "policy_version"]), id: uuid });
/** `revision` is what the reader was shown (announcements only; a policy version is frozen). */
export const acknowledgeSchema = subjectSchema.extend({ revision: z.string().regex(/^\d{1,16}$/).optional() });

export const createPolicySchema = z.object({ title, body, requiresAck: z.boolean().default(true), dueOn: optionalDate, attachmentIds });

export const saveDraftSchema = z
  .object({
    policyId: uuid,
    body,
    changeNote: z.preprocess(blankToUndefined, z.string().trim().max(500, "Use 500 characters or fewer").optional()),
    requiresAck: z.boolean().default(true),
    dueOn: optionalDate,
    attachmentIds,
  })
  .refine(dueRule, { message: DUE_MESSAGE, path: ["dueOn"] });

export const policyIdSchema = z.object({ policyId: uuid });

export const digestPreferenceSchema = z.object({ optOut: z.boolean() });

export type AnnouncementInput = z.input<typeof announcementSchema>;

// --- Announcement videos ---------------------------------------------------------------

export const requestVideoUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(["video/mp4", "video/webm"], { error: "Add an MP4 or WebM video." }),
  sizeBytes: z.number().int().min(1, "That video is empty.").max(MAX_VIDEO_BYTES, "A video can be up to 100 MB."),
});
export const videoIdSchema = z.object({ id: uuid });

/** A PDF or Word document, sent straight to storage after this request. The server checks the real type again when it is finalized. */
export const requestFileUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.enum(
    ["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    { error: "Attach a PDF or Word document." },
  ),
  sizeBytes: z.number().int().min(1, "That file is empty.").max(10 * 1024 * 1024, "A file can be up to 10 MB."),
});
