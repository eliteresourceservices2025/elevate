import { z } from "zod";
import { KIND_VALUES, LIMITS, STATUSES } from "./constants";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it happened")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Choose the date it happened");

export const reportIncidentSchema = z.object({
  kind: z.enum(KIND_VALUES),
  /** The day it happened (or was noticed, if the person is not sure). */
  happenedOn: isoDate,
  /** It is still happening, or the information may still be exposed. Handlers are told to look first. */
  ongoing: z.boolean().default(false),
  howFound: z.string().trim().min(3, "Say how you found out").max(LIMITS.howFound, `Use ${LIMITS.howFound} characters or fewer`),
  whatHappened: z.string().trim().min(10, "Tell us a little more about what happened").max(LIMITS.whatHappened, `Use ${LIMITS.whatHappened} characters or fewer`),
  clientId: z.preprocess(blankToUndefined, z.string().uuid("Choose a client from the list").optional()),
  whoElseKnows: z.preprocess(blankToUndefined, z.string().trim().max(LIMITS.whoElse, `Use ${LIMITS.whoElse} characters or fewer`).optional()),
  actionsTaken: z.preprocess(blankToUndefined, z.string().trim().max(LIMITS.actionsTaken, `Use ${LIMITS.actionsTaken} characters or fewer`).optional()),
});

export const replyIncidentSchema = z.object({
  id: z.string().uuid("Invalid id"),
  body: z.string().trim().min(2, "Write a message").max(LIMITS.message, `Use ${LIMITS.message} characters or fewer`),
});

export const setIncidentStatusSchema = z
  .object({
    id: z.string().uuid("Invalid id"),
    status: z.enum(STATUSES),
    resolution: z.preprocess(blankToUndefined, z.string().trim().max(LIMITS.resolution, `Use ${LIMITS.resolution} characters or fewer`).optional()),
  })
  .refine((v) => v.status !== "closed" || (v.resolution?.length ?? 0) >= 5, { message: "Write a short note on how it was resolved", path: ["resolution"] });

export const designatePrivacyOfficerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter the person's sign-in email"),
  enabled: z.boolean(),
});
