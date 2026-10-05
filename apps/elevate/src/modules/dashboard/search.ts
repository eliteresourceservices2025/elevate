// The pure parts of the header search: cleaning what was typed and matching menu pages.

export type SearchKind = "page" | "person" | "asset" | "applicant" | "announcement";
export type SearchHit = { kind: SearchKind; title: string; subtitle?: string; href: string };

export const MIN_QUERY = 2;
export const MAX_QUERY = 60;

/** What was typed, tidied: one space between words, no control characters, at most MAX_QUERY long. Empty when too short to search. */
export function cleanQuery(raw: string): string {
  const q = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  return q.length >= MIN_QUERY ? q : "";
}

export function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

export type PageEntry = { href: string; label: string; description: string };

/** Menu pages whose name (or description) contains every word typed; names that start with the text come first. */
export function matchPages(pages: PageEntry[], rawQuery: string, limit = 5): PageEntry[] {
  const q = cleanQuery(rawQuery).toLowerCase();
  if (!q) return [];
  const words = q.split(" ");
  return pages
    .map((p) => {
      const label = p.label.toLowerCase();
      const all = `${label} ${p.description.toLowerCase()}`;
      if (!words.every((w) => all.includes(w))) return null;
      const score = label === q ? 0 : label.startsWith(q) ? 1 : label.includes(q) ? 2 : 3;
      return { p, score };
    })
    .filter((x): x is { p: PageEntry; score: number } => x !== null)
    .sort((a, b) => a.score - b.score || a.p.label.localeCompare(b.p.label))
    .slice(0, limit)
    .map((x) => x.p);
}
