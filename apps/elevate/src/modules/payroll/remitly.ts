import { divRoundHalfUp } from "./money";

// The Remitly list, pure. One row per person; no bank or account field exists here on purpose. Money is bigint centavos and cents.

export type RemitlyLine = { employeeId: string; name: string; alias: string | null; net: bigint };
export type RemitlyRow = { employeeId: string; name: string; aliases: string; pesos: string; dollars: string };

/** Hundredths as a plain decimal with no thousands comma, so a spreadsheet or Remitly reads it as a number. */
function plain(hundredths: bigint): string {
  const negative = hundredths < 0n;
  const abs = negative ? -hundredths : hundredths;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/**
 * Sums each person's lines into one row. Dollars = pesos / the run's dollar rate (`usdRateE4`, 58.50 = 585000), rounded half up to the
 * cent from the person's total (not line by line). Rows are ordered by name, then id.
 */
export function buildRemitlyRows(lines: RemitlyLine[], usdRateE4: number | null): RemitlyRow[] {
  if (usdRateE4 === null || !Number.isInteger(usdRateE4) || usdRateE4 <= 0) throw new Error("A dollar rate is needed for the Remitly list.");
  const byPerson = new Map<string, { name: string; aliases: string[]; total: bigint }>();
  for (const l of lines) {
    const p = byPerson.get(l.employeeId) ?? { name: l.name, aliases: [], total: 0n };
    p.total += l.net;
    const alias = l.alias?.trim();
    if (alias && !p.aliases.includes(alias)) p.aliases.push(alias);
    byPerson.set(l.employeeId, p);
  }
  return [...byPerson]
    .sort(([ai, a], [bi, b]) => (a.name < b.name ? -1 : a.name > b.name ? 1 : ai < bi ? -1 : ai > bi ? 1 : 0))
    .map(([employeeId, p]) => ({
      employeeId,
      name: p.name,
      aliases: p.aliases.join("; "),
      pesos: plain(p.total),
      // centavos / 100 / (rate / 10,000) * 100 cents = centavos * 10,000 / rate
      dollars: plain(divRoundHalfUp(p.total * 10_000n, BigInt(usdRateE4))),
    }));
}
