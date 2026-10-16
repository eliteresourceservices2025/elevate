// Spotting the same person twice. Pure (no database): used by Add person, the import preview and the duplicates page.
// A person is matched by their NAME here because their email is exactly what changes (and what made the second record).

/** A name as it is compared: lower case, no accents or punctuation, single spaces. "Ma. Cristina  dela Cruz" = "ma cristina dela cruz". */
export function normalizeName(first: string, last: string, middle?: string | null): string {
  return [first, middle ?? "", last]
    .join(" ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First and last name only, so a middle name written on one record and not the other still matches. */
export const nameKey = (first: string, last: string) => normalizeName(first, last);

export type PersonLike = {
  id: string;
  first: string;
  last: string;
  workEmail: string;
  personalEmail?: string | null;
  mobile?: string | null;
  birthDate?: string | null;
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");
const same = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

/** Signals beyond the name that make "same person" very likely: a shared personal email, mobile number or birth date. */
export function strongSignals(a: PersonLike, b: PersonLike): string[] {
  const out: string[] = [];
  if (same(a.personalEmail, b.personalEmail) || same(a.personalEmail, b.workEmail) || same(a.workEmail, b.personalEmail)) out.push("the same email");
  if (digits(a.mobile).length >= 7 && digits(a.mobile).slice(-9) === digits(b.mobile).slice(-9)) out.push("the same mobile number");
  if (same(a.birthDate, b.birthDate)) out.push("the same birth date");
  return out;
}

/** People who share a name, with the extra signals for each pair. Groups of one are left out. */
export function groupPossibleDuplicates<T extends PersonLike>(people: readonly T[]): { key: string; people: T[]; signals: string[] }[] {
  const byName = new Map<string, T[]>();
  for (const p of people) {
    const key = nameKey(p.first, p.last);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const out: { key: string; people: T[]; signals: string[] }[] = [];
  for (const [key, list] of byName) {
    if (list.length < 2) continue;
    const signals = new Set<string>();
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) for (const s of strongSignals(list[i], list[j])) signals.add(s);
    out.push({ key, people: list, signals: [...signals] });
  }
  return out.sort((a, b) => b.signals.length - a.signals.length || a.key.localeCompare(b.key));
}

/**
 * How a new person compares with existing ones: "same" when the name matches AND something else does too (so almost surely the same
 * human), "name" when only the name matches (could be two people), null when nothing matches.
 */
export function compareWithExisting(candidate: PersonLike, existing: readonly PersonLike[]): { level: "same" | "name"; with: PersonLike; signals: string[] } | null {
  const key = nameKey(candidate.first, candidate.last);
  let best: { level: "same" | "name"; with: PersonLike; signals: string[] } | null = null;
  for (const e of existing) {
    if (e.id === candidate.id || nameKey(e.first, e.last) !== key) continue;
    const signals = strongSignals(candidate, e);
    const level = signals.length > 0 ? "same" : "name";
    if (!best || (level === "same" && best.level === "name")) best = { level, with: e, signals };
  }
  return best;
}
