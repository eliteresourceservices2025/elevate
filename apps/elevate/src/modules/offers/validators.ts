import { z } from "zod";

const uuid = z.string().uuid("Invalid id");
const text = (max: number) => z.string().trim().max(max);
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");

export const offerTemplateSchema = z.object({
  id: uuid.optional(),
  name: text(120).min(3, "Give the template a name"),
  description: z.preprocess(blankToUndefined, text(300).optional()),
  body: z.string().max(10_000, "The template is too long (10,000 characters at most)"),
});

export const makeOfferSchema = z.object({
  applicationId: uuid,
  templateId: uuid,
  roleTitle: text(120).min(3, "Enter the role"),
  startDate: date,
  clientName: z.preprocess(blankToUndefined, text(120).optional()),
  payNote: z.preprocess(blankToUndefined, text(500).optional()),
  /** An ELEVATE user who signs after the applicant (for example an executive). */
  counterSignerUserId: z.preprocess(blankToUndefined, uuid.optional()),
  expiryDays: z.coerce.number().int().min(1).max(30).default(7),
  send: z.boolean().default(true),
});
export type MakeOfferInput = z.input<typeof makeOfferSchema>;

export const offerIdSchema = z.object({ offerId: uuid });
export const templateIdSchema = z.object({ templateId: uuid });
export const previewSchema = makeOfferSchema.pick({ applicationId: true, templateId: true, roleTitle: true, startDate: true, clientName: true, payNote: true, expiryDays: true });

export const hireSchema = z.object({
  applicationId: uuid,
  legalFirstName: text(80).min(1, "Enter a first name"),
  legalLastName: text(80).min(1, "Enter a last name"),
  workEmail: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  positionId: z.preprocess(blankToUndefined, uuid.optional()),
  teamId: z.preprocess(blankToUndefined, uuid.optional()),
  startDate: date,
  /** Required when there is no signed offer: HR and Super Admin only. */
  withoutOfferReason: z.preprocess(blankToUndefined, text(500).min(5, "Give a short reason").optional()),
});
export type HireInput = z.input<typeof hireSchema>;
