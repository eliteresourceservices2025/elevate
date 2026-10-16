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

/**
 * People who may be the same person: they share a name, OR a personal email, mobile number or birth date (so someone who changed their
 * name AND email is still found). Records linked through a chain end up in one group. Groups of one are left out; the strongest first.
 */
export function groupPossibleDuplicates<T extends PersonLike>(people: readonly T[]): { key: string; people: T[]; signals: string[] }[] {
  const parent = people.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const why = new Map<number, Set<string>>();
  const note = (root: number, s: string) => why.set(root, (why.get(root) ?? new Set<string>()).add(s));
  const pairs: [number, number, string[]][] = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const reasons = strongSignals(people[i], people[j]);
      const k = nameKey(people[i].first, people[i].last);
      if (k && k === nameKey(people[j].first, people[j].last)) reasons.unshift("the same name");
      if (reasons.length > 0) pairs.push([i, j, reasons]);
    }
  }
  for (const [i, j] of pairs) parent[find(i)] = find(j);
  for (const [i, , reasons] of pairs) for (const r of reasons) note(find(i), r);
  const byRoot = new Map<number, T[]>();
  people.forEach((p, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), p]));
  const out: { key: string; people: T[]; signals: string[] }[] = [];
  for (const [root, list] of byRoot) {
    if (list.length < 2) continue;
    out.push({ key: list.map((p) => p.id).sort().join("+"), people: list, signals: [...(why.get(root) ?? [])] });
  }
  // More than a name in common first (a name alone could be two people)
  const strength = (g: { signals: string[] }) => g.signals.filter((s) => s !== "the same name").length;
  return out.sort((x, y) => strength(y) - strength(x) || x.key.localeCompare(y.key));
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
