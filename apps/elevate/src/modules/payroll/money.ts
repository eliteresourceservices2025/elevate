// Money helpers. All amounts are bigint centavos; no floats.

const MAX_CENTAVOS = 1_000_000_000n; // 10,000,000.00

/** n / d rounded to the nearest integer, halves away from zero. */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("division by zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const q = (2n * abs + d) / (2n * d);
  return negative ? -q : q;
}

const MONEY = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** Reads a typed or pasted peso amount into centavos, or null if it is not clearly one. */
export function parseMoney(input: string): bigint | null {
  const match = MONEY.exec(input.trim());
  if (!match) return null;
  const whole = BigInt(match[1].replace(/,/g, ""));
  const cents = BigInt((match[2] ?? "").padEnd(2, "0"));
  const total = whole * 100n + cents;
  return total > MAX_CENTAVOS ? null : total;
}

/** Centavos as "1,250.50" (no currency symbol). */
export function formatPesos(c: bigint): string {
  const negative = c < 0n;
  const abs = negative ? -c : c;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}
