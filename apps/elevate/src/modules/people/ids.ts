// Philippine government ID formats. Pure helpers: safe for the browser and the server.
// Input may contain spaces or dashes; output is the canonical dashed form, or null if invalid.

const digits = (value: string) => value.replace(/[\s-]/g, "");
const onlyDigits = (value: string) => /^\d+$/.test(value);

function group(d: string, sizes: number[]): string {
  const parts: string[] = [];
  let i = 0;
  for (const size of sizes) {
    parts.push(d.slice(i, i + size));
    i += size;
  }
  return parts.join("-");
}

/** TIN: 9 digits, or 12 with the 3-digit branch code. */
export function normalizeTin(value: string): string | null {
  const d = digits(value);
  if (!onlyDigits(d)) return null;
  if (d.length === 9) return group(d, [3, 3, 3]);
  if (d.length === 12) return group(d, [3, 3, 3, 3]);
  return null;
}

/** SSS number: 10 digits, XX-XXXXXXX-X. */
export function normalizeSss(value: string): string | null {
  const d = digits(value);
  return onlyDigits(d) && d.length === 10 ? group(d, [2, 7, 1]) : null;
}

/** PhilHealth identification number: 12 digits, XX-XXXXXXXXX-X. */
export function normalizePhilhealth(value: string): string | null {
  const d = digits(value);
  return onlyDigits(d) && d.length === 12 ? group(d, [2, 9, 1]) : null;
}

/** Pag-IBIG MID number: 12 digits, XXXX-XXXX-XXXX. */
export function normalizePagibig(value: string): string | null {
  const d = digits(value);
  return onlyDigits(d) && d.length === 12 ? group(d, [4, 4, 4]) : null;
}

/** Bank account numbers vary by bank: letters, digits, spaces and dashes, 6 to 34 characters. */
export function normalizeBankAccountNumber(value: string): string | null {
  const v = value.trim().replace(/\s+/g, " ");
  return /^[A-Za-z0-9 -]{6,34}$/.test(v) ? v : null;
}

/** Pay rate as a plain decimal string with at most two decimals. */
export function normalizePayRate(value: string): string | null {
  const v = value.replace(/,/g, "").trim();
  const [whole = "", frac, ...extra] = v.split(".");
  if (extra.length > 0 || !/^\d{1,8}$/.test(whole)) return null;
  if (frac !== undefined && !/^\d{1,2}$/.test(frac)) return null;
  const n = Number(v);
  return n > 0 && n <= 10_000_000 ? n.toFixed(2) : null;
}
