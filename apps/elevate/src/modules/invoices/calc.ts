// Pure invoice arithmetic. Money is integer cents and hours are integer hundredths (bigint), never floats. No database, no secrets.

/** n / d rounded to the nearest integer, halves up (inputs here are never negative). */
export function divRoundHalfUp(n: bigint, d: bigint): bigint {
  if (d <= 0n || n < 0n) throw new Error("invalid division");
  return (2n * n + d) / (2n * d);
}

const group = (n: bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Cents as "1,234.56" (no currency sign; screens add the USD label). */
export function formatDollars(cents: bigint): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  return `${negative ? "-" : ""}${group(abs / 100n)}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Hundredths of an hour as "86.50". */
export function formatHours(hundredths: bigint): string {
  const negative = hundredths < 0n;
  const abs = negative ? -hundredths : hundredths;
  return `${negative ? "-" : ""}${group(abs / 100n)}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export const MAX_RATE_CENTS = 99_999n; // 999.99 dollars an hour

const DOLLARS = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** A typed hourly rate in dollars ("25", "25.5", "1,025.50") as cents, or null when it is not clearly one or is zero / too large. */
export function parseDollars(input: string): bigint | null {
  const m = DOLLARS.exec(input.trim());
  if (!m) return null;
  const cents = BigInt(m[1].replace(/,/g, "")) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
  return cents > 0n && cents <= MAX_RATE_CENTS ? cents : null;
}

export type HoursRow = { personName: string; alias: string | null; hundredths: bigint; confirmed: boolean };

export type InvoiceLine = { name: string; alias: string | null; hoursHundredths: bigint; amountCents: bigint };

export type InvoiceTotals = { lines: InvoiceLine[]; totalHoursHundredths: bigint; totalCents: bigint; unconfirmedLines: number };

/** Line amount = round half up(hours x rate), per line; the total is the sum of the line amounts so the lines always add up. Lines with no hours are left off. */
export function buildInvoiceLines(rows: readonly HoursRow[], rateCents: bigint): InvoiceTotals {
  const lines: InvoiceLine[] = [];
  let totalHoursHundredths = 0n;
  let totalCents = 0n;
  let unconfirmedLines = 0;
  for (const r of rows) {
    if (r.hundredths <= 0n) continue;
    const amountCents = divRoundHalfUp(r.hundredths * rateCents, 100n);
    lines.push({ name: r.personName, alias: r.alias, hoursHundredths: r.hundredths, amountCents });
    totalHoursHundredths += r.hundredths;
    totalCents += amountCents;
    if (!r.confirmed) unconfirmedLines += 1;
  }
  return { lines, totalHoursHundredths, totalCents, unconfirmedLines };
}

export type RateVersion = { effectiveFrom: string; createdAt: Date; rateCents: bigint };

/** The newest rate starting on or before the date (a later row for the same start date wins), or null when none has started. */
export function rateInForce<T extends { effectiveFrom: string; createdAt: Date }>(rates: readonly T[], onDate: string): T | null {
  let best: T | null = null;
  for (const r of rates) {
    if (r.effectiveFrom > onDate) continue;
    if (!best || r.effectiveFrom > best.effectiveFrom || (r.effectiveFrom === best.effectiveFrom && r.createdAt.getTime() >= best.createdAt.getTime())) best = r;
  }
  return best;
}

/** INV-2031-0007, or INV-2031-0007-R2 for the second invoice for the same run and client. */
export function invoiceNumber(year: number, seq: number, revision = 1): string {
  const base = `INV-${year}-${String(seq).padStart(4, "0")}`;
  return revision > 1 ? `${base}-R${revision}` : base;
}

export const unconfirmedNote = (n: number) => `${n} ${n === 1 ? "line uses" : "lines use"} suggested hours that ${n === 1 ? "is" : "are"} not confirmed yet.`;

export const INVOICE_LABELS = {
  currency: "USD",
  draftNote: "DRAFT: made from a pay run that is still a draft. Hours may still change.",
  draftBadge: "Draft",
} as const;
