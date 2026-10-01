import { z } from "zod";
import { MAX_EXPIRY_DAYS, MAX_SIGNERS, SIGNATURE_KINDS, SIGNING_ORDERS } from "./constants";

const uuid = z.string().uuid("Invalid id");
const text = (max: number) => z.string().trim().max(max);
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const signerInputSchema = z.object({
  userId: uuid,
  role: z.preprocess(blankToUndefined, text(60).optional()),
  /** Equal numbers sign together; left out, the list order is used. Ignored for a parallel envelope. */
  position: z.coerce.number().int().min(1).max(MAX_SIGNERS).optional(),
});

export const createEnvelopeSchema = z.object({
  title: text(160).min(3, "Give the document a title"),
  templateId: z.preprocess(blankToUndefined, uuid.optional()),
  signers: z.array(signerInputSchema).min(1, "Add at least one signer").max(MAX_SIGNERS, `At most ${MAX_SIGNERS} signers`),
  order: z.enum(SIGNING_ORDERS).default("sequential"),
  expiryDays: z.coerce.number().int().min(1).max(MAX_EXPIRY_DAYS).default(14),
  send: z.boolean().default(true),
});
export type CreateEnvelopeInput = z.input<typeof createEnvelopeSchema>;

export const templateSchema = z.object({
  name: text(120).min(3, "Give the template a name"),
  description: z.preprocess(blankToUndefined, text(500).optional()),
  roles: z.array(text(60).min(1)).min(1, "Name at least one signer role").max(MAX_SIGNERS),
});

export const envelopeIdSchema = z.object({ envelopeId: uuid });
export const templateIdSchema = z.object({ templateId: uuid });
export const reasonSchema = z.object({ envelopeId: uuid, reason: text(500).min(3, "Give a short reason") });

export const signSchema = z
  .object({
    envelopeId: uuid,
    consent: z.literal(true, { message: "Tick the box to agree to sign electronically" }),
    kind: z.enum(SIGNATURE_KINDS),
    typedText: z.preprocess(blankToUndefined, text(60).optional()),
    /** A drawn signature: the PNG as base64 (no data: prefix). */
    pngBase64: z.preprocess(blankToUndefined, z.string().max(90_000).optional()),
  })
  .refine((v) => (v.kind === "typed" ? Boolean(v.typedText) : Boolean(v.pngBase64)), { message: "Add your signature", path: ["kind"] });

export const verifySchema = z.object({ sha256: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, "Not a SHA-256 fingerprint") });
