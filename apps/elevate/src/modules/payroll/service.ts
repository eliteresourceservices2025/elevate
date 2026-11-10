import "server-only";
import { desc, eq, lte } from "drizzle-orm";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { employees } from "@/modules/people/schema";
import { HOLIDAY_BP, type ItemLine, type LineInput, type LineResult, type SettingsSnapshot } from "./calculate";
import type { Tx } from "@/modules/people/service";
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
      regular: row.extraRegularBp,
      restDay: row.extraRestDayBp,
      restDayOver8: row.extraRestDayOver8Bp,
      holiday: HOLIDAY_BP,
    },
  };
}

/** What a line's `amounts_enc` holds. Centavos are bigints in memory and strings on the wire. (Older rows also carry allowance keys, which are ignored.) */
export type LineAmounts = { monthlyCentavos: bigint };
export type LineAmountsJson = { [K in keyof LineAmounts]: string };

const lineContext = (id: string) => `pay_line:${id}`;

export const amountsToJson = (a: LineAmounts): LineAmountsJson => ({
  monthlyCentavos: a.monthlyCentavos.toString(),
});

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
};

const runLineContext = (id: string) => `pay_run_line:${id}`;
const runItemContext = (id: string) => `pay_run_item:${id}`;

export const payloadText = (p: RunLinePayload): string => JSON.stringify(p, bigReplacer);
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
  return { monthlyCentavos: BigInt(j.monthlyCentavos) };
}
