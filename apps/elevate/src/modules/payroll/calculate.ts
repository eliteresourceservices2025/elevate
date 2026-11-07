import { divRoundHalfUp } from "./money";

/**
 * The overtime (OT) kinds paid at a rate from the settings, and holiday pay, which is always paid 1 to 1 (100% of the hourly rate).
 * `holiday` is holiday pay; there is no separate holiday overtime.
 */
export const EXTRA_KEYS = ["regular", "restDay", "restDayOver8", "holiday"] as const;
export type ExtraKey = (typeof EXTRA_KEYS)[number];

/** Holiday pay is one to one: basis points of the normal hourly rate. Not a setting. */
export const HOLIDAY_BP = 10_000;

export type SettingsSnapshot = {
  cutoffDivisor: number;
  changeWarnBp: number;
  multipliersBp: Record<ExtraKey, number | null>;
};

/** One named amount a Preparer itemized (for example "Health allowance"). Always positive pesos in centavos. */
export type ItemLine = { label: string; amount: bigint };

export type LineInput = {
  monthlyCentavos: bigint;
  hoursPerDay: number;
  partial: { dayHundredths: number; minutes: number } | null;
  absenceDayHundredths: number;
  /** Unpaid sick leave, deducted like an absence. */
  sickLeaveDayHundredths: number;
  /** Paid days: shown on the statement, they change no amount. */
  bereavementDayHundredths: number;
  ptoDayHundredths: number;
  lateMinutes: number;
  extra: Record<ExtraKey, number>; // minutes
  allowances: ItemLine[];
  reimbursements: ItemLine[];
  bonuses: ItemLine[];
  adjustments: ItemLine[];
  loan: bigint;
  otherDeductions: bigint;
};

export type LineResult = {
  cutoff: bigint;
  daily: bigint;
  hourly: bigint;
  base: bigint;
  absences: bigint;
  sickLeave: bigint;
  late: bigint;
  extra: Record<ExtraKey, bigint>;
  allowances: bigint;
  gross: bigint;
  reimbursements: bigint;
  bonuses: bigint;
  adjustments: bigint;
  /** Total payable compensation. */
  net: bigint;
  issues: string[];
};

const sum = (lines: readonly ItemLine[]) => lines.reduce((total, l) => total + l.amount, 0n);

/**
 * Pure pay calculator. Every money result is one exact fraction of the unrounded rate, rounded once.
 * Gross = base - absences - sick leave - late + overtime and holiday pay + allowances.
 * Total payable = gross + reimbursements + bonuses + adjustments - loan - other deductions.
 * Everything is in pesos. No tax or contributions are computed.
 */
export function calculateLine(input: LineInput, settings: SettingsSnapshot): LineResult {
  const issues: string[] = [];
  const monthly = input.monthlyCentavos;
  const half = 2n * BigInt(settings.cutoffDivisor); // pay periods x divisor
  // Hours per day in hundredths, so e.g. 6.5 stays exact.
  const hpd = BigInt(Math.round(input.hoursPerDay * 100));
  const hourDen = half * hpd; // hourly rate = monthly * 100 / hourDen

  const cutoff = divRoundHalfUp(monthly, 2n);
  const daily = divRoundHalfUp(monthly, half);
  const hourly = divRoundHalfUp(monthly * 100n, hourDen);

  const partialPay = (p: { dayHundredths: number; minutes: number }): bigint =>
    // days: monthly * d / (half * 100); minutes: monthly * m * 100 / (hourDen * 60);
    // added over one common denominator so rounding happens once.
    divRoundHalfUp(
      monthly * (BigInt(p.dayHundredths) * hpd * 60n + BigInt(p.minutes) * 100n * 100n),
      half * hpd * 100n * 60n,
    );
  const base = input.partial ? partialPay(input.partial) : cutoff;
  // A partial cutoff never pays more than a full one ("15" typed for "1.5" days would otherwise overpay).
  if (input.partial && base > cutoff) issues.push("partial_exceeds_cutoff");

  const absences = divRoundHalfUp(monthly * BigInt(input.absenceDayHundredths), half * 100n);
  const sickLeave = divRoundHalfUp(monthly * BigInt(input.sickLeaveDayHundredths), half * 100n);
  const late = divRoundHalfUp(monthly * BigInt(input.lateMinutes) * 100n, hourDen * 60n);

  const extra = {} as Record<ExtraKey, bigint>;
  for (const key of EXTRA_KEYS) {
    const minutes = input.extra[key];
    const bp = settings.multipliersBp[key];
    if (minutes > 0 && bp === null) {
      issues.push(`missing_multiplier:${key}`);
      extra[key] = 0n;
    } else if (minutes > 0 && bp !== null) {
      extra[key] = divRoundHalfUp(
        monthly * BigInt(minutes) * BigInt(bp) * 100n,
        hourDen * 60n * 10000n,
      );
    } else {
      extra[key] = 0n;
    }
  }

  const allowances = sum(input.allowances);
  const gross = base - absences - sickLeave - late + EXTRA_KEYS.reduce((total, key) => total + extra[key], 0n) + allowances;

  const reimbursements = sum(input.reimbursements);
  const bonuses = sum(input.bonuses);
  const adjustments = sum(input.adjustments);
  const net = gross + reimbursements + bonuses + adjustments - input.loan - input.otherDeductions;
  if (net < 0n) issues.push("negative_net");

  return { cutoff, daily, hourly, base, absences, sickLeave, late, extra, allowances, gross, reimbursements, bonuses, adjustments, net, issues };
}
