// Keyword match between a resume's text and the keywords a recruiter listed for the job. Pure: no database, no files.
//
// This is a rough reading aid, never a decision: it only counts which of the listed words appear in the resume. It uses nothing about
// the person (not their name, age, photo or any voluntary self-identification answer), never rejects anyone, and the resume text is
// not stored: only the percentage and which keywords were found or missing.

export const MAX_KEYWORDS = 30;
export const KEYWORD_MAX_LENGTH = 40;
/** Required keywords count for most of the score; nice-to-have ones for the rest. */
export const REQUIRED_WEIGHT = 70;
export const NICE_WEIGHT = 30;

export type KeywordSets = { required: string[]; nice: string[] };
export type KeywordMatch = { score: number | null; matched: string[]; missed: string[] };

/** Lower-cases, removes accents and collapses spaces, so "Résumé" and "resume" are the same word. */
export function normalizeText(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Reads a typed list (commas, semicolons or one per line) into clean, unique keywords, longest-first order not changed. */
export function parseKeywordList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const word = part.replace(/\s+/g, " ").trim().slice(0, KEYWORD_MAX_LENGTH);
    const key = normalizeText(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A keyword matches as a whole word or phrase (so "excel" does not match "excellent", and "c++" matches "C++"). */
function matcher(keyword: string): RegExp {
  const body = escapeRegExp(normalizeText(keyword)).replace(/ /g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "u");
}

export function scoreResume(text: string, sets: KeywordSets): KeywordMatch {
  const hasAny = sets.required.length > 0 || sets.nice.length > 0;
  const haystack = normalizeText(text);
  if (!hasAny || haystack === "") return { score: null, matched: [], missed: [] };

  const split = (words: string[]) => {
    const matched: string[] = [];
    const missed: string[] = [];
    for (const w of words) (matcher(w).test(haystack) ? matched : missed).push(w);
    return { matched, missed };
  };
  const req = split(sets.required);
  const nice = split(sets.nice);

  // With only one kind of keyword it carries the whole score.
  const reqShare = sets.required.length ? req.matched.length / sets.required.length : 0;
  const niceShare = sets.nice.length ? nice.matched.length / sets.nice.length : 0;
  const score = !sets.nice.length ? reqShare * 100 : !sets.required.length ? niceShare * 100 : reqShare * REQUIRED_WEIGHT + niceShare * NICE_WEIGHT;
  return { score: Math.round(score), matched: [...req.matched, ...nice.matched], missed: [...req.missed, ...nice.missed] };
}

/** A short fingerprint of the keyword lists, so a stored score can tell when the job's keywords have changed since. */
export function keywordSetKey(sets: KeywordSets): string {
  return JSON.stringify([sets.required.map(normalizeText).sort(), sets.nice.map(normalizeText).sort()]);
}

export const SCORE_BANDS = [
  { min: 75, label: "Strong" },
  { min: 50, label: "Fair" },
  { min: 0, label: "Weak" },
] as const;
export const bandOf = (score: number) => SCORE_BANDS.find((b) => score >= b.min)!.label;

/** The columns stored on an application for a resume's keyword match (never the text itself). Null when the job has no keywords. */
export function keywordColumns(text: string | null, sets: KeywordSets, now = new Date()) {
  if (sets.required.length + sets.nice.length === 0) return null;
  const result = text === null ? { score: null, matched: [] as string[], missed: [] as string[] } : scoreResume(text, sets);
  return {
    keywordScore: result.score,
    keywordMatched: result.score === null ? null : result.matched,
    keywordMissed: result.score === null ? null : result.missed,
    keywordScoredAt: now,
    keywordSetKey: keywordSetKey(sets),
  };
}
