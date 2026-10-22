import { z } from "zod";
import { BULK_MAX, CLOSE_KINDS, CRITERIA, INTERVIEW_KINDS, MAX_TAGS_PER_APPLICATION, OPENING_STATUSES, RECOMMENDATIONS, SOURCES, STAGES, TAG_NAME_MAX, TAG_NAME_PATTERN } from "./constants";
import { SLUG_PATTERN } from "./slug";

const uuid = z.string().uuid("Invalid id");
const text = (max: number) => z.string().trim().max(max);
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const openingSchema = z.object({
  id: uuid.optional(),
  title: text(120).min(3, "Give the job a title"),
  /** The readable web address. Blank = made from the title. Only changeable while the job is a draft. */
  slug: z.preprocess(blankToUndefined, z.string().trim().toLowerCase().max(60).regex(SLUG_PATTERN, "Use lower-case letters, numbers and single dashes").optional()),
  description: text(10_000).min(20, "Describe the job (at least a few sentences)"),
  location: text(120).default("Remote"),
  payNote: z.preprocess(blankToUndefined, text(200).optional()),
  teamId: z.preprocess(blankToUndefined, uuid.optional()),
  clientId: z.preprocess(blankToUndefined, uuid.optional()),
  sendAck: z.boolean().default(true),
  sendRejection: z.boolean().default(true),
  /** Words to look for in resumes (commas or one per line). Parsed by parseKeywordList; used only for the keyword-match percentage. */
  keywordsRequired: z.string().max(2000).default(""),
  keywordsNice: z.string().max(2000).default(""),
  /** Users on the hiring team: leads who may see this opening and fill scorecards. */
  hiringTeamUserIds: z.array(uuid).max(20).default([]),
});
export type OpeningInput = z.input<typeof openingSchema>;

export const deleteOpeningSchema = z.object({ id: uuid });
export const deleteApplicationSchema = z.object({ applicationId: uuid, confirm: z.literal("DELETE", { error: "Type DELETE to confirm." }) });

export const setOpeningStatusSchema = z.object({ id: uuid, status: z.enum(OPENING_STATUSES) });

/** The public apply form. The honeypot must be empty; consent must be ticked. */
export const applySchema = z.object({
  openingId: uuid,
  fullName: text(120).min(2, "Enter your full name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  phone: z.preprocess(blankToUndefined, text(40).optional()),
  country: z.preprocess(blankToUndefined, text(80).optional()),
  note: z.preprocess(blankToUndefined, text(2000).optional()),
  /** Where they heard about the job. Optional; anything not on the list is ignored rather than refused. */
  source: z.preprocess(blankToUndefined, z.enum(SOURCES).optional().catch(undefined)),
  sourceDetail: z.preprocess(blankToUndefined, text(100).optional()),
  consent: z.literal(true, { message: "Please accept the privacy notice to apply" }),
  /** Real people leave this empty; bots fill every field they see. */
  website: z.string().max(0).default(""),
  /** The optional self-identification section. Checked on its own (demographics/validators.ts) and kept apart from the application. */
  gender: z.string().max(40).optional(),
  genderOther: z.string().max(200).optional(),
  orientation: z.string().max(40).optional(),
  orientationOther: z.string().max(200).optional(),
  religion: z.string().max(40).optional(),
  religionOther: z.string().max(200).optional(),
});
export type ApplyInput = z.input<typeof applySchema>;

export const moveSchema = z.object({
  applicationId: uuid,
  to: z.enum(STAGES).refine((s) => s !== "rejected", "Use Reject for that"),
  note: z.preprocess(blankToUndefined, text(500).optional()),
});
export const rejectSchema = z.object({
  applicationId: uuid,
  kind: z.enum(CLOSE_KINDS).default("rejected"),
  reason: text(500).min(3, "Give a short reason (it stays internal)"),
  notifyCandidate: z.boolean().default(false),
});
export const noteSchema = z.object({ applicationId: uuid, body: text(4000).min(1, "Write a note") });

export const interviewSchema = z
  .object({
    applicationId: uuid,
    kind: z.enum(INTERVIEW_KINDS).default("interview"),
    startsAt: z.coerce.date(),
    minutes: z.coerce.number().int().min(15).max(480),
    location: text(300).min(2, "Add a meeting link or place"),
    interviewerUserIds: z.array(uuid).min(1, "Pick at least one interviewer").max(8),
    emailCandidate: z.boolean().default(true),
    note: z.preprocess(blankToUndefined, text(1000).optional()),
  })
  .refine((v) => v.startsAt.getTime() > Date.now() - 5 * 60_000, { message: "The interview must be in the future", path: ["startsAt"] });
export type InterviewInput = z.input<typeof interviewSchema>;

export const cancelInterviewSchema = z.object({ interviewId: uuid });

export const scorecardSchema = z.object({
  interviewId: uuid,
  ratings: z.object(Object.fromEntries(CRITERIA.map((c) => [c.key, z.number().int().min(1).max(5)])) as Record<(typeof CRITERIA)[number]["key"], z.ZodNumber>),
  recommendation: z.enum(RECOMMENDATIONS),
  comments: text(4000).min(3, "Add a few words on why"),
});

export const retentionSchema = z.object({
  enabled: z.boolean(),
  rejectedMonths: z.coerce.number().int().min(1).max(120),
  withdrawnMonths: z.coerce.number().int().min(1).max(120),
});

export const resumeSchema = z.object({ applicationId: uuid });

export const careersPageSchema = z.object({
  title: z.preprocess(blankToUndefined, text(120).optional()),
  intro: z.preprocess(blankToUndefined, text(2000).optional()),
});

// ---- Sources, tags and bulk actions -----------------------------------------------------------------------------------------

export const tagNameSchema = z
  .string()
  .trim()
  .min(1, "Give the tag a name")
  .max(TAG_NAME_MAX, `Use ${TAG_NAME_MAX} characters or fewer`)
  .regex(TAG_NAME_PATTERN, "Use letters, numbers and spaces");
export const createTagSchema = z.object({ name: tagNameSchema });
export const archiveTagSchema = z.object({ tagId: uuid });
export const setTagsSchema = z.object({ applicationId: uuid, tagIds: z.array(uuid).max(MAX_TAGS_PER_APPLICATION, `At most ${MAX_TAGS_PER_APPLICATION} tags on one application`) });
export const setSourceSchema = z.object({
  applicationId: uuid,
  source: z.preprocess(blankToUndefined, z.enum(SOURCES).optional()),
  sourceDetail: z.preprocess(blankToUndefined, text(100).optional()),
});

const bulkIds = z.array(uuid).min(1, "Choose at least one applicant").max(BULK_MAX, `Choose ${BULK_MAX} applicants or fewer at a time`);
/** One action applied to many applications. Each application succeeds or fails on its own. */
export const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("move"), applicationIds: bulkIds, to: z.enum(STAGES).refine((s) => s !== "rejected" && s !== "hired", "Use Close for that; hiring is done one person at a time"), note: z.preprocess(blankToUndefined, text(500).optional()) }),
  z.object({ action: z.literal("close"), applicationIds: bulkIds, kind: z.enum(CLOSE_KINDS), reason: text(500).min(3, "Give a short reason (it stays internal)"), notifyCandidate: z.boolean().default(false) }),
  z.object({ action: z.literal("tag"), applicationIds: bulkIds, tagId: uuid }),
  z.object({ action: z.literal("untag"), applicationIds: bulkIds, tagId: uuid }),
]);
export type BulkInput = z.input<typeof bulkSchema>;

export const rescoreSchema = z.object({ openingId: uuid });
