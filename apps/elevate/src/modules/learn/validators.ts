import { z } from "zod";

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
});

export const trainingFilterSchema = z.object({
  state: z.enum(["overdue", "open", "passed", "none"]).optional(),
  q: z.string().trim().max(80).optional(),
});
export type TrainingFilter = z.infer<typeof trainingFilterSchema>;
