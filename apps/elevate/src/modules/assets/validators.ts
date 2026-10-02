import { z } from "zod";
import { ASSET_STATUSES, CATEGORIES, CONDITIONS, RETURN_STATUSES, isValidTag, normalizeTag } from "./constants";

const uuid = z.string().uuid("Invalid id");
const text = (max: number) => z.string().trim().max(max);
const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = (max: number) => z.preprocess(blankToUndefined, text(max).optional());
const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid date").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Choose a valid date");

const tag = z
  .string()
  .transform(normalizeTag)
  .refine(isValidTag, "A tag is 3 to 30 letters, numbers or dashes, like ERS-LT-0001");

/** Whole text fields never carry a price or a person's private data: they are plain labels. */
const fields = {
  name: text(120).min(2, "Give the item a name"),
  category: z.enum(CATEGORIES),
  serialNumber: optionalText(80),
  notes: optionalText(1000),
  purchaseDate: z.preprocess(blankToUndefined, date.optional()),
};

export const createAssetSchema = z.object({ tag, ...fields });
export const updateAssetSchema = z.object({ assetId: uuid, ...fields });
export const setAssetStatusSchema = z.object({ assetId: uuid, status: z.enum(ASSET_STATUSES), note: optionalText(500) });
export const archiveAssetSchema = z.object({ assetId: uuid, archive: z.boolean() });
export const assignAssetSchema = z.object({ assetId: uuid, employeeId: uuid, condition: z.enum(CONDITIONS), note: optionalText(500) });
export const returnAssetSchema = z.object({ assetId: uuid, condition: z.enum(CONDITIONS), nextStatus: z.enum(RETURN_STATUSES).default("in_stock"), note: optionalText(500) });

export const listFiltersSchema = z.object({
  status: z.enum(ASSET_STATUSES).optional(),
  category: z.enum(CATEGORIES).optional(),
  q: text(80).optional(),
  archived: z.boolean().optional(),
});
export type ListFilters = z.infer<typeof listFiltersSchema>;
