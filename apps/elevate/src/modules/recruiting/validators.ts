import { z } from "zod";
import { CLOSE_KINDS, CRITERIA, INTERVIEW_KINDS, OPENING_STATUSES, RECOMMENDATIONS, STAGES } from "./constants";

const uuid = z.string().uuid("Invalid id");
const text = (max: number) => z.string().trim().max(max);
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const openingSchema = z.object({
  id: uuid.optional(),
  title: text(120).min(3, "Give the job a title"),
  description: text(10_000).min(20, "Describe the job (at least a few sentences)"),
  location: text(120).default("Remote"),
  payNote: z.preprocess(blankToUndefined, text(200).optional()),
  teamId: z.preprocess(blankToUndefined, uuid.optional()),
  clientId: z.preprocess(blankToUndefined, uuid.optional()),
  sendAck: z.boolean().default(true),
  sendRejection: z.boolean().default(true),
  /** Users on the hiring team: leads who may see this opening and fill scorecards. */
  hiringTeamUserIds: z.array(uuid).max(20).default([]),
});
export type OpeningInput = z.input<typeof openingSchema>;

export const setOpeningStatusSchema = z.object({ id: uuid, status: z.enum(OPENING_STATUSES) });

/** The public apply form. The honeypot must be empty; consent must be ticked. */
export const applySchema = z.object({
  openingId: uuid,
  fullName: text(120).min(2, "Enter your full name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  phone: z.preprocess(blankToUndefined, text(40).optional()),
  country: z.preprocess(blankToUndefined, text(80).optional()),
  note: z.preprocess(blankToUndefined, text(2000).optional()),
  consent: z.literal(true, { message: "Please accept the privacy notice to apply" }),
  /** Real people leave this empty; bots fill every field they see. */
  website: z.string().max(0).default(""),
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
