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
  /** Usage and reversal rows: the leave request they belong to. */
  requestId?: string | null;
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
type Draw = { poolId: string; amount: number; requestId: string | null };

const byOrder = (a: LedgerRow, b: LedgerRow) =>
  a.effectiveOn.localeCompare(b.effectiveOn) || a.createdAtMs - b.createdAtMs || a.id.localeCompare(b.id);

export type Replay = {
  /** Days still unused in each pool of days (an award, an opening balance, or a positive adjustment). */
  unused: Map<string, number>;
  /** Days of usage that found no unexpired days to draw from. Above zero means the ledger cannot honour that usage. */
  shortfall: number;
};

/**
 * Replays the ledger up to `atDate`. Rules: usage draws first from the days that expire soonest (days that
 * never expire last); days past their expiry cannot be drawn; a reversal gives back the draws of its own
 * request (or, without a request, the most recent draws). Expiry rows are the system's own write-off and
 * are ignored here.
 */
export function replayLedger(rows: readonly LedgerRow[], atDate: string): Replay {
  const pools: Pool[] = [];
  const draws: Draw[] = [];
  let shortfall = 0;

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
        draws.push({ poolId: pool.id, amount: take, requestId: row.requestId ?? null });
      }
      shortfall += need;
    } else if (row.entryType === "reversal") {
      let give = amount;
      const mine = row.requestId ?? null;
      for (const d of [...draws].reverse()) {
        if (give <= 0) break;
        if (mine !== null && d.requestId !== mine) continue;
        const back = Math.min(d.amount, give);
        const pool = pools.find((p) => p.id === d.poolId);
        if (pool) pool.left += back;
        d.amount -= back;
        give -= back;
      }
      const kept = draws.filter((d) => d.amount > 0);
      draws.length = 0;
      draws.push(...kept);
    }
  }
  return { unused: new Map(pools.map((p) => [p.id, days(p.left)])), shortfall: days(shortfall) };
}

/** Days still unused in each pool, replaying up to `atDate`. */
export function unusedByPool(rows: readonly LedgerRow[], atDate: string): Map<string, number> {
  return replayLedger(rows, atDate).unused;
}

/** How many days of this award are still unused at the end of its last day: what the expiry row writes off. */
export function expiryAmount(rows: readonly LedgerRow[], awardId: string, expiresOn: string): number {
  return unusedByPool(rows, expiresOn).get(awardId) ?? 0;
}

const FAR_FUTURE = "9999-12-31";

/**
 * Whether taking `count` days on `startDate` is honoured by the ledger: the balance stays at or above zero AND
 * every day of usage, in date order, can be drawn from days that are not expired on the day they are used.
 * `requestId` tags the hypothetical usage so its own reversal can find it.
 */
export function canTake(rows: readonly LedgerRow[], count: number, startDate: string, requestId: string): boolean {
  const usage: LedgerRow = { id: `hypothetical-${requestId}`, entryType: "usage", days: -count, effectiveOn: startDate, expiresOn: null, createdAtMs: Number.MAX_SAFE_INTEGER, requestId };
  const next = [...rows, usage];
  return cents(balanceOf(next)) >= 0 && replayLedger(next, FAR_FUTURE).shortfall === 0;
}
