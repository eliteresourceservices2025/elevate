// Word tokens for message search. Pure functions shared by the index (on send and edit) and the query, so both sides always agree.
// A message's text is encrypted, so search works on a blind index: each word (and its first 3 to 10 letters) is turned into a keyed
// hash by search-index.ts; the database only ever holds hashes, never words.

const MAX_WORDS = 50;
const MIN_PREFIX = 3;
const MAX_PREFIX = 10;

/** Lower-case words (letters and digits only, accents removed, 2+ letters), at most 50 per message. */
export function tokenize(text: string): string[] {
  const words = text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu);
  return (words ?? []).filter((w) => w.length >= 2).slice(0, MAX_WORDS);
}

/** What the index stores for these words: the word itself and its prefixes of 3 to 10 letters (a 2-letter word only whole). */
export function indexTokens(words: string[]): string[] {
  const out = new Set<string>();
  for (const word of words) {
    out.add(word.slice(0, MAX_PREFIX));
    if (word.length >= MIN_PREFIX) {
      for (let n = MIN_PREFIX; n <= Math.min(word.length, MAX_PREFIX); n++) out.add(word.slice(0, n));
    }
  }
  return [...out];
}

/** What a search looks for: each query word, cut to 10 letters; a 3-letter word or more matches by prefix, a 2-letter word matches whole. */
export function queryTokens(query: string): string[] {
  return [...new Set(tokenize(query).map((w) => w.slice(0, MAX_PREFIX)))];
}
