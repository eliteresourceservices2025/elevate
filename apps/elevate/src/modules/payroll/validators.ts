import { z } from "zod";
import { isoDate } from "@/modules/people/validators";
import { PAYMENT_METHODS } from "./constants";
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

export type PayLineInput = z.input<typeof createPayLineSchema>;
export type UpdatePayLineInput = z.input<typeof updatePayLineSchema>;
export type PaySettingsInput = z.input<typeof savePaySettingsSchema>;
