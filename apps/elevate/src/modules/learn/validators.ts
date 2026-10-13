import { z } from "zod";
import { LEARN_COURSE_SLUGS } from "./constants";

const uuid = z.string().uuid("That does not look right. Please try again.");

/** HR gives someone more tries, or more time for the exam, with a reason. The database limits the amounts too. */
export const grantRetrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tries"), assignmentId: uuid, amount: z.number().int().min(1).max(5), reason: z.string().trim().min(3, "Give a short reason.").max(500) }),
  z.object({ kind: z.literal("time"), assignmentId: uuid, amount: z.number().int().min(5).max(60), reason: z.string().trim().min(3, "Give a short reason.").max(500) }),
]);

/** HR puts someone on the training now (the nightly job does this for everyone who needs it). */
export const assignTrainingSchema = z.object({
  userId: uuid,
  track: z.enum(["full", "essentials", "refresher"]),
  course: z.enum(LEARN_COURSE_SLUGS).default("hipaa"),
});

/** HR chooses who a course is assigned to automatically. Teams are needed (and only used) for the "teams" mode. */
export const autoAssignSchema = z
  .object({
    course: z.enum(LEARN_COURSE_SLUGS),
    mode: z.enum(["all", "teams", "paused"]),
    teamIds: z.array(uuid).max(200).default([]),
  })
  .refine((v) => v.mode !== "teams" || v.teamIds.length > 0, { message: "Tick at least one team, or choose Paused.", path: ["teamIds"] });

/** HR downloads the training evidence for one client on one date. */
export const evidenceExportSchema = z.object({
  clientId: uuid,
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Choose a date"),
  format: z.enum(["csv", "pdf"]),
});

export const trainingFilterSchema = z.object({
  state: z.enum(["overdue", "open", "passed", "none"]).optional(),
  q: z.string().trim().max(80).optional(),
  course: z.enum(LEARN_COURSE_SLUGS).optional(),
});
export type TrainingFilter = z.infer<typeof trainingFilterSchema>;
