// Pairs a Jibble member with a pay line on the run. Pure. Nothing is guessed when it is ambiguous: a member that fits more than one line
// (a person paid by two clients has two Jibble members and two lines) or none is left for the Preparer to choose, and the choice is
// remembered by member code so the next sheet matches by itself.

export type MatchLine = {
  runLineId: string;
  /** Stable across versions of a pay line: what a remembered match points at. */
  lineKey: string;
  /** Every way this person's name may be written: legal name, preferred name. */
  names: string[];
};

export type MatchResult = {
  /** The line to use, or null when the Preparer has to choose. */
  runLineId: string | null;
  /** Every line that fits, for the Preparer's choice when it is not decided. */
  candidates: string[];
  by: "remembered" | "name" | null;
};

/** Lower case, without accents, punctuation or brackets: "Jonalyn Lituaña" -> "jonalyn lituana". */
export function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // a nickname in brackets
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((t) => b.includes(t));
const subset = (small: string[], large: string[]) => small.length >= 2 && small.every((t) => large.includes(t));

/** Whether a Jibble name and a person's name are the same person's: all the words match, or every word of the shorter one is in the longer. */
export function sameName(jibble: string, person: string): boolean {
  const a = nameTokens(jibble);
  const b = nameTokens(person);
  if (a.length === 0 || b.length === 0) return false;
  return sameSet(a, b) || (a.length <= b.length ? subset(a, b) : subset(b, a));
}

export function matchMember(member: { code: string; name: string }, lines: MatchLine[], remembered: ReadonlyMap<string, string>): MatchResult {
  const key = remembered.get(member.code);
  if (key !== undefined) {
    const line = lines.find((l) => l.lineKey === key);
    if (line) return { runLineId: line.runLineId, candidates: [line.runLineId], by: "remembered" };
  }
  const fits = lines.filter((l) => l.names.some((n) => sameName(member.name, n)));
  if (fits.length === 1) return { runLineId: fits[0].runLineId, candidates: [fits[0].runLineId], by: "name" };
  return { runLineId: null, candidates: fits.map((l) => l.runLineId), by: null };
}

/**
 * Pairs every member, never giving one line to two members: when two members would take the same line by name, neither does and both are
 * left for the Preparer (a remembered match always stands).
 */
export function matchAll(members: { code: string; name: string }[], lines: MatchLine[], remembered: ReadonlyMap<string, string>): Map<string, MatchResult> {
  const out = new Map<string, MatchResult>();
  for (const m of members) out.set(m.code, matchMember(m, lines, remembered));
  const claimed = new Map<string, string[]>();
  for (const [code, r] of out) if (r.runLineId) claimed.set(r.runLineId, [...(claimed.get(r.runLineId) ?? []), code]);
  for (const [lineId, codes] of claimed) {
    if (codes.length < 2) continue;
    for (const code of codes) {
      const r = out.get(code)!;
      if (r.by === "remembered") continue;
      out.set(code, { runLineId: null, candidates: r.candidates.length ? r.candidates : [lineId], by: null });
    }
  }
  return out;
}
