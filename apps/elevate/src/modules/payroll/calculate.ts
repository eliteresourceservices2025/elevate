import { divRoundHalfUp } from "./money";

export const EXTRA_KEYS = ["regular", "holiday", "restDay", "restDayOver8", "holidayPay"] as const;
export type ExtraKey = (typeof EXTRA_KEYS)[number];

export type SettingsSnapshot = {
  cutoffDivisor: number;
  changeWarnBp: number;
  multipliersBp: Record<ExtraKey, number | null>;
};

export type LineInput = {
  monthlyCentavos: bigint;
  hoursPerDay: number;
  partial: { dayHundredths: number; minutes: number } | null;
  absenceDayHundredths: number;
  lateMinutes: number;
  extra: Record<ExtraKey, number>; // minutes
  pesoAllowance: bigint;
  dollarAllowanceCents: bigint;
  adjustment: bigint;
  loan: bigint;
  otherDeductions: bigint;
};

export type LineResult = {
  cutoff: bigint;
  daily: bigint;
  hourly: bigint;
  base: bigint;
  absences: bigint;
  late: bigint;
  extra: Record<ExtraKey, bigint>;
  gross: bigint;
  dollarAllowancePesos: bigint;
  net: bigint;
  issues: string[];
};

/**
 * Pure pay calculator. Every money result is one exact fraction of the unrounded
 * rate, rounded once. Gross = base - absences - late + extra hours + peso
 * allowance. Net = gross + dollar allowance in pesos + adjustment - loan -
 * other deductions.
 * No tax or contributions are computed.
 */
export function calculateLine(
  input: LineInput,
  settings: SettingsSnapshot,
  usdRateE4: number | null,
): LineResult {
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

  const gross =
    base -
    absences -
    late +
    EXTRA_KEYS.reduce((sum, key) => sum + extra[key], 0n) +
    input.pesoAllowance;

  let dollarAllowancePesos = 0n;
  if (input.dollarAllowanceCents > 0n) {
    if (usdRateE4 === null) issues.push("missing_usd_rate");
    else
      dollarAllowancePesos = divRoundHalfUp(
        input.dollarAllowanceCents * BigInt(usdRateE4),
        10000n,
      );
  }

  const net =
    gross +
    dollarAllowancePesos +
    input.adjustment -
    input.loan -
    input.otherDeductions;
  if (net < 0n) issues.push("negative_net");

  return { cutoff, daily, hourly, base, absences, late, extra, gross, dollarAllowancePesos, net, issues };
}
