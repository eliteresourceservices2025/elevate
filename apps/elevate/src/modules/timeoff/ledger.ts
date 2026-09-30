// Pure rules for the leave ledger. No database, no clock: everything a balance or an expiry needs is in the rows.
// Days are held in hundredths internally, so 0.5 + 0.5 is always exactly 1.

export type LedgerEntryType = "award" | "usage" | "reversal" | "adjustment" | "expiry" | "opening_balance";

export type LedgerRow = {
  id: string;
  entryType: LedgerEntryType;
  /** Signed, as stored. */
  days: number;
  effectiveOn: string;
  expiresOn: string | null;
  /** Tie-breaker for rows on the same day: creation order. */
  createdAtMs: number;
};

export const MAX_AWARD_DAYS = 5;

const cents = (days: number) => Math.round(days * 100);
const days = (c: number) => c / 100;

/** The balance is nothing but the sum of the rows. */
export function balanceOf(rows: readonly Pick<LedgerRow, "days">[]): number {
  return days(rows.reduce((sum, r) => sum + cents(r.days), 0));
}

export const isHalfDayStep = (value: number) => Number.isFinite(value) && Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;

export function formatDays(value: number): string {
  const n = Math.abs(value);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${value < 0 ? "-" : ""}${text} ${n === 1 ? "day" : "days"}`;
}

type Pool = { id: string; left: number; expiresOn: string | null; createdAtMs: number };
type Draw = { poolId: string; amount: number };

const byOrder = (a: LedgerRow, b: LedgerRow) =>
  a.effectiveOn.localeCompare(b.effectiveOn) || a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id);

/**
 * Replays the ledger up to `atDate` and says how many days are still unused in each pool of days (an award,
 * an opening balance, or a positive adjustment). Rules: usage draws first from the days that expire soonest
 * (days that never expire last); days past their expiry cannot be drawn; a reversal gives back the most
 * recent draws. Expiry rows are the system's own write-off and are ignored here.
 */
export function unusedByPool(rows: readonly LedgerRow[], atDate: string): Map<string, number> {
  const pools: Pool[] = [];
  const draws: Draw[] = [];

  for (const row of [...rows].sort(byOrder)) {
    if (row.effectiveOn > atDate) break;
    const amount = cents(row.days);

    if (row.entryType === "award" || row.entryType === "opening_balance" || (row.entryType === "adjustment" && amount > 0)) {
      pools.push({ id: row.id, left: amount, expiresOn: row.entryType === "award" ? row.expiresOn : null, createdAtMs: row.createdAtMs });
    } else if (row.entryType === "usage" || (row.entryType === "adjustment" && amount < 0)) {
      let need = -amount;
      const usable = pools
        .filter((p) => p.left > 0 && (p.expiresOn === null || p.expiresOn >= row.effectiveOn))
        .sort((a, b) => (a.expiresOn ?? "9999-12-31").localeCompare(b.expiresOn ?? "9999-12-31") || a.createdAtMs - b.createdAtMs);
      for (const pool of usable) {
        if (need === 0) break;
        const take = Math.min(pool.left, need);
        pool.left -= take;
        need -= take;
        draws.push({ poolId: pool.id, amount: take });
      }
    } else if (row.entryType === "reversal") {
      let give = amount;
      while (give > 0 && draws.length > 0) {
        const last = draws[draws.length - 1];
        const back = Math.min(last.amount, give);
        const pool = pools.find((p) => p.id === last.poolId);
        if (pool) pool.left += back;
        last.amount -= back;
        give -= back;
        if (last.amount === 0) draws.pop();
      }
    }
  }
  return new Map(pools.map((p) => [p.id, days(p.left)]));
}

/** How many days of this award are still unused at the end of its last day: what the expiry row writes off. */
export function expiryAmount(rows: readonly LedgerRow[], awardId: string, expiresOn: string): number {
  return unusedByPool(rows, expiresOn).get(awardId) ?? 0;
}
