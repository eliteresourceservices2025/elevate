import { z } from "zod";
import { isoDate } from "@/modules/people/validators";
import { isItemized, PAY_ITEM_TYPES, PAYMENT_METHODS } from "./constants";
import { cleanItemLabel, ITEM_UNIT_HINTS, itemUnit, MAX_ITEM_LABEL, parseItemValue } from "./items";
import { parseMoney } from "./money";

// One schema per form, reused by the server action. Amounts arrive as typed strings and go through parseMoney: never negative,
// never a float. Whole-number fields are checked here because the calculator has no input guards of its own.

const blankTo = (fallback: string) => (v: unknown) => (typeof v === "string" && v.trim() === "" ? fallback : v);

/** A peso amount as typed or pasted: "1,250.50". */
const money = z.string().trim().refine((s) => parseMoney(s) !== null, "Enter an amount like 1,250.50");
const positiveMoney = money.refine((s) => (parseMoney(s) ?? 0n) > 0n, "Enter an amount above zero");

const uuid = z.uuid();
const reason = z.string().trim().min(1, "Give a reason").max(500);

/** A multiplier typed as a percent of the normal rate ("125" = 1.25 times); blank means not set yet. Stored as basis points. */
const percentToBp = z.preprocess(
  blankTo(""),
  z
    .string()
    .trim()
    .refine((s) => s === "" || (parseMoney(s) !== null && parseMoney(s)! >= 1n && parseMoney(s)! <= 100_000n), "Enter a percent like 125")
    .transform((s) => (s === "" ? null : Number(parseMoney(s)))),
);

const lineFields = {
  clientId: z.preprocess((v) => (v === "" ? null : v), uuid.nullish()),
  alias: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), z.string().trim().max(80).nullish()),
  hoursPerDay: z.number().int().min(1).max(12),
  paymentMethod: z.enum(PAYMENT_METHODS),
  effectiveFrom: isoDate,
  endsOn: z.preprocess((v) => (v === "" ? null : v), isoDate.nullish()),
  monthly: positiveMoney,
  /** This person's own overtime percents (125 = 1.25 times their hourly rate). Blank = the company standard from Settings. */
  otRegular: percentToBp.optional(),
  otRestDay: percentToBp.optional(),
  otRestDayOver8: percentToBp.optional(),
};
const endsAfterStart = (v: { effectiveFrom: string; endsOn?: string | null }) => !v.endsOn || v.endsOn >= v.effectiveFrom;
const ENDS_MSG = { message: "The end date can't be before the start date", path: ["endsOn"] };

export const createPayLineSchema = z.object({ employeeId: uuid, ...lineFields }).refine(endsAfterStart, ENDS_MSG);
export const updatePayLineSchema = z.object({ lineKey: uuid, ...lineFields, reason }).refine(endsAfterStart, ENDS_MSG);
export const endPayLineSchema = z.object({ lineKey: uuid, endsOn: isoDate, reason });

/** Withdrawing a line that was added by mistake (it was never on a real run). */
export const withdrawPayLineSchema = z.object({ lineKey: uuid, reason });

/** Removing every stopped rate that was never on a real run. `apply: false` only counts them. */
export const removeStoppedRatesSchema = z.object({ apply: z.boolean() });

/** The tidied rates to bring back (one contractor's, or every one the tidy took away). */
export const restoreRemovedRatesSchema = z.object({ lineKeys: z.array(uuid).min(1).max(1000) });

export const savePaySettingsSchema = z.object({
  effectiveFrom: isoDate,
  cutoffDivisor: z.number().int().min(1).max(31),
  /** Warn when a person's total payable compensation moves by more than this many percent from the last run. */
  changeWarnPercent: z.number().int().min(1).max(100),
  extraRegular: percentToBp,
  extraRestDay: percentToBp,
  extraRestDayOver8: percentToBp,
  reason: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(500).optional()),
});

const MAX_PERIOD_MS = 30 * 86_400_000; // 31 days, both ends counted
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);

export const createPayRunSchema = z
  .object({ periodStart: isoDate, periodEnd: isoDate, /** A practice run: it may repeat a period that already has a run. */ test: z.boolean().optional() })
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
    /** The name of an itemized line (allowance, reimbursement, bonus, adjustment). Required for those types, not allowed for the others. */
    label: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().max(200).optional()),
    /** The id of the itemized line being changed; blank to add a new one. */
    itemKey: z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional()),
    reason: optionalReason,
    /** An adjustment that corrects an earlier approved or paid run; blank for none. */
    correctsRunId: z.preprocess((v) => (v === "" || v === null ? undefined : v), uuid.optional()),
  })
  .superRefine((v, ctx) => {
    if (parseItemValue(v.type, v.value) === null) ctx.addIssue({ code: "custom", path: ["value"], message: ITEM_UNIT_HINTS[itemUnit(v.type)] });
    if (isItemized(v.type)) {
      if (!v.label || cleanItemLabel(v.label) === null) ctx.addIssue({ code: "custom", path: ["label"], message: `Give it a name, up to ${MAX_ITEM_LABEL} characters` });
    } else if (v.label || v.itemKey) {
      ctx.addIssue({ code: "custom", path: ["label"], message: "Only allowances, reimbursements, bonuses and adjustments have a name" });
    }
  });

export const dismissPayItemSchema = z.object({ runId: uuid, itemId: uuid, reason: optionalReason });

export const cancelPayRunSchema = z.object({ runId: uuid, reason });

export const markRunTestSchema = z.object({ runId: uuid, test: z.boolean(), reason });

export const archiveRunSchema = z.object({ runId: uuid, reason });

export const restoreRunSchema = z.object({ runId: uuid });

export const releaseStatementsSchema = z.object({ runId: uuid });

export const confirmRunLineSchema = z.object({ runLineId: uuid });

export const refreshSuggestionsSchema = z.object({ runId: uuid });

export const updateRunPeopleSchema = z.object({ runId: uuid });
export const applyTimesheetSchema = z.object({
  runId: uuid,
  importId: uuid,
  assignments: z.array(z.object({ code: z.string().trim().min(1).max(40), runLineId: z.preprocess((v) => (v === "" ? null : v), uuid.nullable()) })).max(300),
  /** Replace unconfirmed suggestions already on the lines (from another fill). Off: they are kept and the new amounts are not written. */
  replaceSuggestions: z.boolean().optional(),
});
export const discardTimesheetSchema = z.object({ runId: uuid });
export const uploadTimesheetSchema = z.object({ runId: uuid });
export const confirmAllSuggestionsSchema = z.object({ runId: uuid });
export const removePersonFromRunSchema = z.object({ runId: uuid, runLineId: uuid, reason });
export const restorePersonToRunSchema = z.object({ runId: uuid, runLineId: uuid });

/** A blank `value` means "as suggested". The server checks a typed value against the item's own unit. */
export const confirmSuggestionSchema = z.object({
  runId: uuid,
  itemId: uuid,
  runLineId: uuid,
  value: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(20).optional()),
  reason: optionalReason,
});

export const assignSuggestionSchema = z.object({ runId: uuid, itemId: uuid, runLineId: uuid });

export const submitRunSchema = z.object({ runId: uuid });

/** A send-back always says why. Kept encrypted in the change history; never in a notice. */
export const sendBackRunSchema = z.object({ runId: uuid, note: z.string().trim().min(1, "Say what needs to change").max(1000) });

/** The hash the page was given when it loaded (64 lowercase hex characters). */
export const approveRunSchema = z.object({ runId: uuid, expectedHash: z.string().regex(/^[0-9a-f]{64}$/) });

export const exportRemitlySchema = z.object({ runId: uuid });

/** A transfer reference typed by the Preparer who paid. Kept encrypted. */
export const markPaidSchema = z.object({ runId: uuid, employeeId: uuid, reference: z.string().trim().min(1).max(100), paidOn: isoDate });

export type PayLineInput = z.input<typeof createPayLineSchema>;
export type UpdatePayLineInput = z.input<typeof updatePayLineSchema>;
export type PaySettingsInput = z.input<typeof savePaySettingsSchema>;

/** The ticked runs: at least one, at most 200, each once. */
const tickedRunIds = z.array(uuid).min(1).max(200).transform((a) => [...new Set(a)]);
export const bulkRunsSchema = z.object({ ids: tickedRunIds });
export const bulkArchiveRunsSchema = z.object({ ids: tickedRunIds, reason });
