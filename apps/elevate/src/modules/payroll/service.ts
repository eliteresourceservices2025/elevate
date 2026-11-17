import "server-only";
import { desc, eq, lte } from "drizzle-orm";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { employees } from "@/modules/people/schema";
import { DEFAULT_OT_BP, HOLIDAY_BP, type ItemLine, type LineInput, type LineResult, type SettingsSnapshot } from "./calculate";
import type { Tx } from "@/modules/people/service";
import { FTE_MAX_HUNDREDTHS } from "./fte";
import { payRuns, paySettings } from "./schema";

// Helpers that take the acting user or a transaction as a parameter live here, not in actions.ts ("use server" files are public endpoints).

/** Today as YYYY-MM-DD in the company time zone (a pay date never depends on the viewer's zone). */
export const payrollToday = (): string => formatInZone(Date.now(), DEFAULT_TIMEZONE, "yyyy-MM-dd");

type Executor = Pick<typeof db, "select">;

/** The people record linked to a sign-in account, or null when the account has none. */
export async function employeeIdForUser(executor: Executor, userId: string): Promise<string | null> {
  const [row] = await executor.select({ id: employees.id }).from(employees).where(eq(employees.userId, userId)).limit(1);
  return row?.id ?? null;
}

/**
 * Refuses when the line belongs to the acting user's own people record. Used for the two things nobody does for themselves: checking
 * their own line and recording their own payment. A Preparer may edit their own rate and amounts (a Preparer can also be paid through
 * payroll); the independent checks are another Preparer's check of the line, someone else recording the payment, and an Approver who
 * did not touch the run.
 */
export async function assertNotOwnEmployee(actor: { id: string }, employeeId: string, executor: Executor = db): Promise<void> {
  const own = await employeeIdForUser(executor, actor.id);
  if (own !== null && own === employeeId) throw new ActionFailure("You can't do this for your own pay. Another Preparer does it.");
}

/** The settings that apply on a date: the newest version dated on or before it (ties go to the newest row). */
export async function settingsInForce(executor: Executor, date: string): Promise<SettingsSnapshot> {
  const [row] = await executor
    .select()
    .from(paySettings)
    .where(lte(paySettings.effectiveFrom, date))
    .orderBy(desc(paySettings.effectiveFrom), desc(paySettings.createdAt))
    .limit(1);
  if (!row) throw new ActionFailure("No pay settings are in force on that date.");
  return snapshotOf(row);
}

export function snapshotOf(row: typeof paySettings.$inferSelect): SettingsSnapshot {
  return {
    cutoffDivisor: row.cutoffDivisor,
    changeWarnBp: row.changeWarnBp,
    multipliersBp: {
      // A blank setting means the standard percent, not "missing": overtime must pay from the first run.
      regular: row.extraRegularBp ?? DEFAULT_OT_BP.regular,
      restDay: row.extraRestDayBp ?? DEFAULT_OT_BP.restDay,
      restDayOver8: row.extraRestDayOver8Bp ?? DEFAULT_OT_BP.restDayOver8,
      holiday: HOLIDAY_BP,
    },
  };
}

/** What a line's `amounts_enc` holds. Centavos are bigints in memory and strings on the wire. (Older rows also carry allowance keys, which are ignored.) */
export type OtKey = keyof typeof DEFAULT_OT_BP;
export const OT_KEYS = ["regular", "restDay", "restDayOver8"] as const satisfies readonly OtKey[];
/** A person's own overtime percents in basis points (12500 = 125%). A key left out uses the company standard from Settings. */
export type OtOverride = Partial<Record<OtKey, number>>;
/**
 * `fteHundredths` is the line's default FTE count in hundredths (100 = 1, 50 = 0.5, 0 = does not count); missing means "not set" (a rate
 * made before FTE came back). `perFteCentavos` marks an internal-team rate paid per FTE: the cutoff pay is the run's total FTE times this
 * amount, and `monthlyCentavos` is then 0. See fte.ts.
 */
export type LineAmounts = { monthlyCentavos: bigint; otBp?: OtOverride; fteHundredths?: number; perFteCentavos?: bigint };
export type LineAmountsJson = { monthlyCentavos: string; otBp?: OtOverride; fteHundredths?: number; perFteCentavos?: string };

/** The run's overtime percents with a person's own percents laid over them. */
export function withOtOverride<T extends Partial<Record<string, number | null>>>(base: T, otBp: OtOverride | undefined): T {
  return otBp ? { ...base, ...otBp } : base;
}

const lineContext = (id: string) => `pay_line:${id}`;

/** An FTE count is a whole number of hundredths from 0 to FTE_MAX_HUNDREDTHS; anything else is "not set". */
const cleanFte = (v: unknown): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= FTE_MAX_HUNDREDTHS ? v : undefined);

const cleanOt = (o: OtOverride | undefined): OtOverride | undefined => {
  const kept = OT_KEYS.filter((k) => typeof o?.[k] === "number").map((k) => [k, o![k]!] as const);
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
};

export const amountsToJson = (a: LineAmounts): LineAmountsJson => {
  const otBp = cleanOt(a.otBp);
  const out: LineAmountsJson = { monthlyCentavos: a.monthlyCentavos.toString() };
  if (otBp) out.otBp = otBp;
  const fte = cleanFte(a.fteHundredths);
  if (fte !== undefined) out.fteHundredths = fte;
  if (a.perFteCentavos !== undefined && a.perFteCentavos > 0n) out.perFteCentavos = a.perFteCentavos.toString();
  return out;
};

export function encryptLineAmounts(lineId: string, a: LineAmounts): string {
  return fieldCrypto().encrypt(JSON.stringify(amountsToJson(a)), lineContext(lineId));
}

// ---- Draft runs ----

/** JSON that carries bigints as { "$big": "123" }, so a payload round-trips without floats. */
const bigReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? { $big: v.toString() } : v);
const bigReviver = (_k: string, v: unknown) =>
  v !== null && typeof v === "object" && "$big" in v && typeof (v as { $big: unknown }).$big === "string" ? BigInt((v as { $big: string }).$big) : v;

/** What `pay_run_lines.payload_enc` holds: the line's figures, the inputs used and the computed result. */
export type RunLinePayload = {
  rate: LineAmounts;
  hoursPerDay: number;
  input: LineInput;
  clientHoursHundredths: bigint;
  result: LineResult;
  /** A contractor line's FTE for this run in hundredths (the count typed for the run, else the rate's); absent when there is none. */
  fteHundredths?: number;
  /** The count was typed for this run, not taken from the rate. */
  fteFromRun?: true;
  /** An internal-team line paid per FTE: the run's total FTE (hundredths) its pay was worked out with. */
  perFte?: { totalFteHundredths: number };
};

const runLineContext = (id: string) => `pay_run_line:${id}`;
const runItemContext = (id: string) => `pay_run_item:${id}`;

export const payloadText = (p: RunLinePayload): string => JSON.stringify(p, bigReplacer);
/**
 * The payload without a contractor's FTE count. A count only sets the internal team's pay (their own payloads change when it does), so a change
 * of count alone must not clear a line's "checked by": setting FTE on every rate would otherwise ask for every line to be checked again.
 */
export const payloadTextWithoutFte = (p: RunLinePayload): string => payloadText({ ...p, fteHundredths: undefined, fteFromRun: undefined, rate: { ...p.rate, fteHundredths: undefined } });
export const encryptRunLine = (id: string, p: RunLinePayload): string => fieldCrypto().encrypt(payloadText(p), runLineContext(id));
export const decryptRunLine = (id: string, stored: string): RunLinePayload => upgradePayload(JSON.parse(fieldCrypto().decrypt(stored, runLineContext(id)), bigReviver));

/**
 * Lines frozen before the revision (dollar allowance, FTE, holiday overtime, one adjustment amount) are read into the new shape so
 * an old paid statement still opens: the peso allowance and adjustment become one named line each, the dollar part is no longer
 * shown (the stored total payable is kept as it was), and holiday overtime is dropped. Nothing new is ever written in the old shape.
 */
function upgradePayload(raw: unknown): RunLinePayload {
  const p = raw as RunLinePayload & { input: Record<string, unknown>; result: Record<string, unknown> };
  const input = p.input;
  const result = p.result;
  const old = input.pesoAllowance !== undefined || input.adjustment !== undefined || input.dollarAllowanceCents !== undefined;
  if (!old) return p;
  const one = (label: string, value: unknown): ItemLine[] => (typeof value === "bigint" && value !== 0n ? [{ label, amount: value }] : []);
  const oldExtra = (input.extra ?? {}) as Record<string, number>;
  p.input = {
    ...(input as unknown as LineInput),
    sickLeaveDayHundredths: 0,
    bereavementDayHundredths: 0,
    ptoDayHundredths: 0,
    extra: { regular: oldExtra.regular ?? 0, restDay: oldExtra.restDay ?? 0, restDayOver8: oldExtra.restDayOver8 ?? 0, holiday: oldExtra.holidayPay ?? 0 },
    allowances: one("Allowance", input.pesoAllowance),
    reimbursements: [],
    bonuses: [],
    adjustments: one("Adjustment", input.adjustment),
  };
  const oldResultExtra = (result.extra ?? {}) as Record<string, bigint>;
  p.result = {
    ...(result as unknown as LineResult),
    sickLeave: 0n,
    extra: { regular: oldResultExtra.regular ?? 0n, restDay: oldResultExtra.restDay ?? 0n, restDayOver8: oldResultExtra.restDayOver8 ?? 0n, holiday: oldResultExtra.holidayPay ?? 0n },
    allowances: typeof input.pesoAllowance === "bigint" ? input.pesoAllowance : 0n,
    reimbursements: 0n,
    bonuses: 0n,
    adjustments: typeof input.adjustment === "bigint" ? input.adjustment : 0n,
  };
  return p;
}

/** What `pay_run_items.value_enc` holds: the value in the item's smallest unit, and the reason. */
export type ItemValue = {
  value: bigint;
  /** The name of an itemized line (for example "Health allowance"). Only on allowance, reimbursement, bonus and adjustment items. */
  label?: string;
  reason: string | null;
  /** Written by the system (a refresh, an assignment), not by a Preparer. */
  system?: true;
  /** An adjustment that corrects an earlier approved or paid run names that run. */
  correctsRunId?: string;
};
export const encryptItemValue = (id: string, v: ItemValue): string => fieldCrypto().encrypt(JSON.stringify(v, bigReplacer), runItemContext(id));
export const decryptItemValue = (id: string, stored: string): ItemValue => JSON.parse(fieldCrypto().decrypt(stored, runItemContext(id)), bigReviver) as ItemValue;

/**
 * Locks the run row and refuses anything but a draft. Every action that changes a run starts with this: the freeze triggers check the
 * run's status, and this row lock makes a concurrent submit wait for the change (or the change wait for the submit) instead of racing it.
 */
export async function lockDraftRun(tx: Tx, runId: string): Promise<typeof payRuns.$inferSelect> {
  const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, runId)).for("update");
  if (!run) throw new ActionFailure("That pay run was not found.");
  if (run.status !== "draft") throw new ActionFailure("This run is no longer a draft, so it can't be changed.");
  return run;
}

export function decryptLineAmounts(lineId: string, stored: string): LineAmounts {
  const j = JSON.parse(fieldCrypto().decrypt(stored, lineContext(lineId))) as LineAmountsJson;
  const out: LineAmounts = { monthlyCentavos: BigInt(j.monthlyCentavos) };
  const otBp = cleanOt(j.otBp);
  if (otBp) out.otBp = otBp;
  const fte = cleanFte(j.fteHundredths);
  if (fte !== undefined) out.fteHundredths = fte;
  if (typeof j.perFteCentavos === "string") {
    const perFte = BigInt(j.perFteCentavos);
    if (perFte > 0n) out.perFteCentavos = perFte;
  }
  return out;
}
