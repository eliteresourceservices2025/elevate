import { z } from "zod";
import { COURSE_SLUG_PATTERN } from "./constants";

const uuid = z.string().uuid("That does not look right. Please try again.");
/** A course address. Whether the course exists is checked against the catalog on the server (client add-ons are data). */
const courseSlug = z.string().max(80).regex(COURSE_SLUG_PATTERN, "That course was not found.");
const date = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Choose a real date");

/** HR gives someone more tries, or more time for the exam, with a reason. The database limits the amounts too. */
export const grantRetrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tries"), assignmentId: uuid, amount: z.number().int().min(1).max(5), reason: z.string().trim().min(3, "Give a short reason.").max(500) }),
  z.object({ kind: z.literal("time"), assignmentId: uuid, amount: z.number().int().min(5).max(60), reason: z.string().trim().min(3, "Give a short reason.").max(500) }),
]);

/** HR puts someone on the training now (the nightly job does this for everyone who needs it). */
export const assignTrainingSchema = z
  .object({
    /** The person's account. Someone with no account yet (a new hire who has not signed in) is given as employeeId instead. */
    userId: uuid.optional(),
    employeeId: uuid.optional(),
    track: z.enum(["full", "essentials", "refresher"]),
    course: courseSlug.default("hipaa"),
  })
  .refine((v) => Boolean(v.userId) !== Boolean(v.employeeId), { message: "Choose one person." });

/** An HR adjustment to a course deadline. The original deadline is retained in the audit trail. */
export const changeDueDateSchema = z.object({
  assignmentId: uuid,
  dueOn: date,
  reason: z.string().trim().min(3, "Give a short reason.").max(500),
});

/** A reviewed transfer from an orphaned learning account to a current profile. */
export const repairLearnHistorySchema = z.object({
  sourceUserId: uuid,
  targetEmployeeId: uuid,
  reason: z.string().trim().min(10, "Explain how you verified this is the same person.").max(500),
});

/** HR chooses who a course is assigned to automatically. Teams are needed (and only used) for the "teams" mode. */
export const autoAssignSchema = z
  .object({
    course: courseSlug,
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
  course: courseSlug.optional(),
});
export type TrainingFilter = z.infer<typeof trainingFilterSchema>;
