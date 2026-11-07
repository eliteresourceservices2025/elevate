// The Remitly list, pure. One row per person; no bank or account field exists here on purpose. Money is bigint centavos; everything is in pesos (Remitly applies its own rate).

export type RemitlyLine = { employeeId: string; name: string; alias: string | null; net: bigint };
export type RemitlyRow = {
  employeeId: string;
  name: string;
  aliases: string;
  pesos: string;
};

/** The name shown for a person: preferred name if set, else first name, then last name. */
export const personName = (r: { preferred: string | null; first: string; last: string }): string =>
  `${r.preferred?.trim() || r.first} ${r.last}`;

/** A person's aliases as one text: blanks left out, repeats listed once, in the order met. */
export function joinAliases(aliases: (string | null)[]): string {
  const seen: string[] = [];
  for (const a of aliases) {
    const t = a?.trim();
    if (t && !seen.includes(t)) seen.push(t);
  }
  return seen.join("; ");
}

/** Hundredths as a plain decimal with no thousands comma, so a spreadsheet or Remitly reads it as a number. */
function plain(hundredths: bigint): string {
  const negative = hundredths < 0n;
  const abs = negative ? -hundredths : hundredths;
  return `${negative ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/**
 * Sums each person's lines (total payable compensation) into one row of pesos. Rows are ordered by name, then id.
 */
export function buildRemitlyRows(lines: RemitlyLine[]): RemitlyRow[] {
  const byPerson = new Map<string, { name: string; aliases: (string | null)[]; total: bigint }>();
  for (const l of lines) {
    const p = byPerson.get(l.employeeId) ?? { name: l.name, aliases: [], total: 0n };
    p.total += l.net;
    p.aliases.push(l.alias);
    byPerson.set(l.employeeId, p);
  }
  return [...byPerson]
    .sort(([ai, a], [bi, b]) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : ai < bi ? -1 : ai > bi ? 1 : 0,
    )
    .map(([employeeId, p]) => ({
      employeeId,
      name: p.name,
      aliases: joinAliases(p.aliases),
      pesos: plain(p.total),
    }));
}
