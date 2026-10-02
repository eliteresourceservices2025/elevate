import { z } from "zod";
import { CYCLE_TYPES, GOAL_STATUSES, QUESTION_TYPES } from "./constants";

const uuid = z.string().uuid("Invalid id");
const text = (max: number) => z.string().trim().max(max);
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = (max: number) => z.preprocess(blankToUndefined, text(max).optional());
const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const rating = z.coerce.number().int().min(1, "Ratings are 1 to 5").max(5, "Ratings are 1 to 5");

export const questionInputSchema = z.object({
  section: text(80).min(1, "Every question needs a section"),
  prompt: text(300).min(3, "Every question needs a prompt"),
  type: z.enum(QUESTION_TYPES),
  required: z.boolean().default(true),
});

export const reviewTemplateSchema = z.object({
  id: uuid.optional(),
  name: text(120).min(3, "Give the template a name"),
  questions: z.array(questionInputSchema).min(1, "Add at least one question").max(40, "At most 40 questions"),
});
export type ReviewTemplateInput = z.input<typeof reviewTemplateSchema>;

export const templateIdSchema = z.object({ templateId: uuid });
export const reviewIdSchema = z.object({ reviewId: uuid });
export const cycleIdSchema = z.object({ cycleId: uuid });

export const launchCycleSchema = z
  .object({
    name: text(120).min(3, "Give the cycle a name"),
    type: z.enum(CYCLE_TYPES),
    templateId: uuid,
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("everyone") }),
      z.object({ kind: z.literal("teams"), teamIds: z.array(uuid).min(1, "Choose at least one team").max(100) }),
      z.object({ kind: z.literal("people"), employeeIds: z.array(uuid).min(1, "Choose at least one person").max(500) }),
    ]),
    selfDueOn: date,
    leadDueOn: date,
    calibrateDueOn: date,
  })
  .superRefine((v, ctx) => {
    if (v.leadDueOn < v.selfDueOn) ctx.addIssue({ code: "custom", message: "The lead's due date cannot be before the self review's", path: ["leadDueOn"] });
    if (v.calibrateDueOn < v.leadDueOn) ctx.addIssue({ code: "custom", message: "The calibration date cannot be before the lead's", path: ["calibrateDueOn"] });
  });

const answers = z.record(z.string().uuid(), z.object({ rating: rating.optional(), text: optionalText(4000) })).default({});

export const submitReviewSchema = z.object({
  reviewId: uuid,
  answers,
  overallRating: z.preprocess(blankToUndefined, rating.optional()),
  comments: optionalText(4000),
});

export const calibrateSchema = z.object({
  reviewId: uuid,
  finalRating: rating,
  summary: optionalText(4000),
  changeReason: optionalText(1000),
});

export const acknowledgeSchema = z.object({ reviewId: uuid, comment: optionalText(2000) });
export const reassignSchema = z.object({ reviewId: uuid, leadUserId: uuid });
export const earlySettingsSchema = z.object({ enabled: z.boolean(), templateId: z.preprocess(blankToUndefined, uuid.optional()) });

export const goalSchema = z.object({
  id: uuid.optional(),
  employeeId: uuid,
  title: text(160).min(3, "Give the goal a title"),
  description: optionalText(2000),
  targetOn: z.preprocess(blankToUndefined, date.optional()),
});
export const goalStatusSchema = z.object({ goalId: uuid, status: z.enum(GOAL_STATUSES) });
export const goalNoteSchema = z.object({ goalId: uuid, note: text(1000).min(1, "Write a note") });
export const goalIdSchema = z.object({ goalId: uuid });
