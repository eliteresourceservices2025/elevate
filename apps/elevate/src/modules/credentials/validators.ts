import { z } from "zod";
import { STATUSES } from "./rules";

const uuid = z.string().uuid("Invalid id");
const realDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date")
  .refine((v) => new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Choose a valid date");
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const addCredentialSchema = z
  .object({
    employeeId: uuid,
    name: z.string().trim().min(2, "Give the certificate a name").max(120, "Use 120 characters or fewer"),
    issuedOn: z.preprocess(blankToUndefined, realDate.optional()),
    expiresOn: realDate,
  })
  .refine((v) => !v.issuedOn || v.issuedOn <= v.expiresOn, { message: "The end date cannot be before the issue date", path: ["expiresOn"] });

export const removeCredentialSchema = z.object({ credentialId: uuid });

export const MAX_IMPORT_CHARS = 1_000_000;
export const importCredentialsSchema = z.object({
  csv: z.string().min(1, "Choose the TalentHR assets file").max(MAX_IMPORT_CHARS, "The file is too large"),
  nameContains: z.string().trim().min(2, "Type part of the certificate name, for example HIPAA").max(60),
  commit: z.boolean(),
});

export const listFiltersSchema = z.object({
  status: z.enum(STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
});
export type ListFilters = z.infer<typeof listFiltersSchema>;
