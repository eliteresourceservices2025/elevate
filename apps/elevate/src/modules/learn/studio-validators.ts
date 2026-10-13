import { z } from "zod";
import { blockSchema } from "../../../../learn/src/content/schema";
import { LEARN_COURSE_SLUGS } from "./constants";

const uuid = z.string().uuid("That does not look right. Please try again.");
const stamp = z.number().int().min(0);
const short = z.string().trim().min(1, "This cannot be empty").max(160, "Use 160 characters or fewer");

export const createDraftSchema = z.object({
  course: z.enum(LEARN_COURSE_SLUGS),
  fromVersion: z.number().int().min(1).optional(),
  note: z.string().trim().min(3, "Say what this draft is for").max(300),
});

export const courseMetaSchema = z.object({
  versionId: uuid,
  stamp,
  title: short,
  attestationVersion: z.string().regex(/^[a-z0-9._-]{1,30}$/, "Use letters, numbers, dots, dashes (30 characters at most)"),
  attestationText: z.string().trim().min(40, "At least 40 characters").max(1500),
});

export const moduleMetaSchema = z.object({
  versionId: uuid,
  stamp,
  moduleKey: z.string().regex(/^[a-z0-9_]{1,40}$/),
  title: short,
  summary: z.string().trim().min(10, "At least 10 characters").max(300),
  estimatedMinutes: z.number().int().min(1).max(120),
  tracks: z.array(z.enum(["full", "essentials", "refresher"])).min(1, "Pick at least one track"),
  keyPoints: z.array(short).min(3, "At least 3 key points").max(8, "At most 8 key points"),
});

export const screenSchemaInput = z.object({
  versionId: uuid,
  stamp,
  moduleKey: z.string().regex(/^[a-z0-9_]{1,40}$/),
  screenId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  title: short,
  blocks: z.array(blockSchema).min(1).max(6),
});

export const questionEditSchema = z.object({
  versionId: uuid,
  stamp,
  questionId: uuid,
  topic: z.string().trim().min(2).max(60),
  stem: z.string().trim().min(15, "At least 15 characters").max(600),
  options: z.array(z.object({ id: z.enum(["a", "b", "c", "d", "e", "f"]), text: z.string().trim().min(1, "Options cannot be empty").max(260) })).min(2).max(6),
  correctIds: z.array(z.enum(["a", "b", "c", "d", "e", "f"])).min(1).max(5),
  rationale: z.string().trim().min(20, "At least 20 characters").max(700),
});

export const publishDraftSchema = z.object({
  versionId: uuid,
  reviewerEmail: z.string().trim().toLowerCase().email("Enter the reviewer's sign-in email"),
  counselApprovedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date as YYYY-MM-DD").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Enter a real date"),
  material: z.boolean().default(false),
});

export const discardDraftSchema = z.object({ versionId: uuid, stamp });
