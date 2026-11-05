import { z } from "zod";
import { isoDate } from "@/modules/people/validators";
import { PAY_ITEM_TYPES, PAYMENT_METHODS } from "./constants";
import { ITEM_UNIT_HINTS, itemUnit, parseItemValue, parseUsdRate } from "./items";
import { parseMoney } from "./money";

// One schema per form, reused by the server action. Amounts arrive as typed strings and go through parseMoney: never negative,
// never a float. Whole-number fields are checked here because the calculator has no input guards of its own.

const blankTo = (fallback: string) => (v: unknown) => (typeof v === "string" && v.trim() === "" ? fallback : v);

/** A peso or dollar amount as typed or pasted: "1,250.50". */
const money = z.string().trim().refine((s) => parseMoney(s) !== null, "Enter an amount like 1,250.50");
const positiveMoney = money.refine((s) => (parseMoney(s) ?? 0n) > 0n, "Enter an amount above zero");
const optionalMoney = z.preprocess(blankTo("0"), money);

const uuid = z.uuid();
const reason = z.string().trim().min(1, "Give a reason").max(500);

const lineFields = {
  clientId: z.preprocess((v) => (v === "" ? null : v), uuid.nullish()),
  alias: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(80).nullish()),
  hoursPerDay: z.number().int().min(1).max(12),
  /** Full-time equivalent, e.g. "1" or "0.5"; the column holds two decimals and one digit. */
  fte: z.string().trim().regex(/^\d(\.\d{1,2})?$/, "Use a number like 1 or 0.5"),
  paymentMethod: z.enum(PAYMENT_METHODS),
  effectiveFrom: isoDate,
  endsOn: z.preprocess((v) => (v === "" ? null : v), isoDate.nullish()),
  monthly: positiveMoney,
  pesoAllowance: optionalMoney,
  dollarAllowance: optionalMoney,
};
const endsAfterStart = (v: { effectiveFrom: string; endsOn?: string | null }) => !v.endsOn || v.endsOn >= v.effectiveFrom;
const ENDS_MSG = { message: "The end date can't be before the start date", path: ["endsOn"] };

export const createPayLineSchema = z.object({ employeeId: uuid, ...lineFields }).refine(endsAfterStart, ENDS_MSG);
export const updatePayLineSchema = z.object({ lineKey: uuid, ...lineFields, reason }).refine(endsAfterStart, ENDS_MSG);
export const endPayLineSchema = z.object({ lineKey: uuid, endsOn: isoDate, reason });

/** A multiplier typed as a percent of the normal rate ("125" = 1.25 times); blank means not set yet. Stored as basis points. */
const percentToBp = z.preprocess(
  blankTo(""),
  z
    .string()
    .trim()
    .refine((s) => s === "" || (parseMoney(s) !== null && parseMoney(s)! >= 1n && parseMoney(s)! <= 100_000n), "Enter a percent like 125")
    .transform((s) => (s === "" ? null : Number(parseMoney(s)))),
);

export const savePaySettingsSchema = z.object({
  effectiveFrom: isoDate,
  cutoffDivisor: z.number().int().min(1).max(31),
  /** Warn when a person's net pay moves by more than this many percent from the last run. */
  changeWarnPercent: z.number().int().min(1).max(100),
  extraRegular: percentToBp,
  extraHoliday: percentToBp,
  extraRestDay: percentToBp,
  extraRestDayOver8: percentToBp,
  holiday: percentToBp,
  reason: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(500).optional()),
});

const MAX_PERIOD_MS = 30 * 86_400_000; // 31 days, both ends counted
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

export const createPayRunSchema = z
  .object({ periodStart: isoDate, periodEnd: isoDate })
  .refine((v) => v.periodEnd >= v.periodStart, { message: "The period can't end before it starts", path: ["periodEnd"] })
  .refine((v) => dayMs(v.periodEnd) - dayMs(v.periodStart) <= MAX_PERIOD_MS, { message: "A pay period is at most 31 days", path: ["periodEnd"] });

const optionalReason = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(500).optional());

/** Whole minutes, day hundredths and non-negative money only: the calculator has no guards of its own. */
export const savePayItemSchema = z
  .object({
    runId: uuid,
    employeeId: uuid,
    runLineId: uuid,
    type: z.enum(PAY_ITEM_TYPES),
    value: z.string().trim(),
    reason: optionalReason,
  })
  .superRefine((v, ctx) => {
    if (parseItemValue(v.type, v.value) === null) ctx.addIssue({ code: "custom", path: ["value"], message: ITEM_UNIT_HINTS[itemUnit(v.type)] });
  });

export const dismissPayItemSchema = z.object({ runId: uuid, itemId: uuid, reason: optionalReason });

/** Blank clears the rate. */
export const setRunUsdRateSchema = z.object({
  runId: uuid,
  rate: z
    .string()
    .trim()
    .refine((s) => s === "" || parseUsdRate(s) !== null, "Enter a rate like 58.50")
    .transform((s) => (s === "" ? null : parseUsdRate(s))),
});

export const cancelPayRunSchema = z.object({ runId: uuid, reason });

export const confirmRunLineSchema = z.object({ runLineId: uuid });

export const refreshSuggestionsSchema = z.object({ runId: uuid });

/** A blank `value` means "as suggested". The server checks a typed value against the item's own unit. */
export const confirmSuggestionSchema = z.object({
  runId: uuid,
  itemId: uuid,
  runLineId: uuid,
  value: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(20).optional()),
  reason: optionalReason,
});

export const assignSuggestionSchema = z.object({ runId: uuid, itemId: uuid, runLineId: uuid });

export type PayLineInput = z.input<typeof createPayLineSchema>;
export type UpdatePayLineInput = z.input<typeof updatePayLineSchema>;
export type PaySettingsInput = z.input<typeof savePaySettingsSchema>;
