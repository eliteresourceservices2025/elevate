import { divRoundHalfUp } from "./money";

// FTE (full-time equivalent). Each contractor-on-client line carries a count (1, 0.5 or 0) that is only an INPUT for the internal team's pay:
// an internal-team rate is "paid per FTE", and its cutoff pay is the run's total FTE times its amount per FTE. A count of 0 means "does not
// count" (not an error). FTE is never reduced for absences or a part-cutoff, and it is never shown to a contractor. Pure: no database.
// Counts are whole hundredths (100 = 1, 50 = 0.5), so nothing is ever a float.

export const FTE_MAX_HUNDREDTHS = 200; // 2 FTE for one line is already far more than any real line

/** A typed FTE ("1", "0.5", ".5", "0,25") in hundredths, or null when it is blank or not a count from 0 to 2. */
export function parseFte(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  const match = /^(\d{0,2})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match || (match[1] === "" && match[2] === undefined)) return null;
  const hundredths = Number(match[1] || "0") * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return hundredths >= 0 && hundredths <= FTE_MAX_HUNDREDTHS ? hundredths : null;
}

/** A count as people read it: 100 -> "1", 50 -> "0.5", 25 -> "0.25", 2750 -> "27.5". */
export function formatFte(hundredths: number | bigint): string {
  const n = Number(hundredths);
  const whole = Math.floor(n / 100);
  const part = n % 100;
  if (part === 0) return String(whole);
  return `${whole}.${String(part).padStart(2, "0").replace(/0$/, "")}`;
}

/**
 * The FTE a run uses for one line: what was typed for this run, else the rate's own count, else 0 (not set counts as 0 and the run warns
 * about it; a count is never guessed).
 */
export function effectiveFte(rate: number | undefined, typedForRun: bigint | number | null | undefined): number {
  if (typedForRun !== null && typedForRun !== undefined) return Number(typedForRun);
  return rate ?? 0;
}

export type FteLineFacts = {
  /** An internal-team line paid per FTE: it never counts toward the total. */
  perFte: boolean;
  /** The line's effective FTE (`effectiveFte`). */
  effectiveHundredths: number;
};

/** The run's total FTE in hundredths: the effective FTE of every line still on the run, per-FTE lines excluded. */
export function runFteTotal(lines: readonly FteLineFacts[]): number {
  return lines.reduce((total, l) => total + (l.perFte ? 0 : l.effectiveHundredths), 0);
}

/** A per-FTE line's cutoff pay in centavos: its amount per FTE times the run's total FTE, rounded once. */
export function perFteCutoffCentavos(perFteCentavos: bigint, totalHundredths: number): bigint {
  return divRoundHalfUp(perFteCentavos * BigInt(totalHundredths), 100n);
}

/** The monthly figure the calculator is given for a per-FTE line, so absences, late time, overtime and allowances all work as for anyone. */
export function perFteMonthlyCentavos(perFteCentavos: bigint, totalHundredths: number): bigint {
  return 2n * perFteCutoffCentavos(perFteCentavos, totalHundredths);
}
