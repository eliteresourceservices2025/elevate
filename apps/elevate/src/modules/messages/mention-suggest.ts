// Suggestions while typing "@" in the message box, as plain functions so they can be tested without React.

export type MentionQuery = { start: number; query: string };
export type MentionOption = { kind: "everyone" } | { kind: "person"; userId: string; name: string };

/**
 * The "@something" the caret is in, if any: an @ at the start of the text or after whitespace, followed by up to 30 non-space
 * characters, with the caret right after them. An @ inside a word or an email address ("ana@example.com") does not count.
 */
export function findMentionQuery(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const match = /(^|\s)@([^\s@[\]()]{0,30})$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[2].length - 1, query: match[2] };
}

/** People whose name starts with, or has a word starting with, what was typed; "everyone" when it fits. Best matches first, at most `limit`. */
export function suggestMentions(members: { userId: string; name: string }[], query: string, limit = 8): MentionOption[] {
  const q = query.toLowerCase();
  const score = (name: string): number => {
    const n = name.toLowerCase();
    if (q === "") return 1;
    if (n.startsWith(q)) return 3;
    if (n.split(/\s+/).some((w) => w.startsWith(q))) return 2;
    return n.includes(q) ? 1 : 0;
  };
  const people = members
    .map((m) => ({ m, s: score(m.name) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.m.name.localeCompare(b.m.name))
    .map((x): MentionOption => ({ kind: "person", userId: x.m.userId, name: x.m.name }));
  const everyone: MentionOption[] = members.length > 1 && (q === "" || "everyone".startsWith(q) || "all".startsWith(q)) ? [{ kind: "everyone" }] : [];
  return [...everyone, ...people].slice(0, limit);
}

/** The text with "@query" replaced by `insert` (plus a space), and where the caret goes afterwards. */
export function applyMention(text: string, found: MentionQuery, insert: string): { text: string; caret: number } {
  const end = found.start + 1 + found.query.length;
  const next = `${text.slice(0, found.start)}${insert} ${text.slice(end)}`;
  return { text: next, caret: found.start + insert.length + 1 };
}
