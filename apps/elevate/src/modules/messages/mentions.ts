// @mentions are written into the message text as @[Name](user:<id>), so the name a person sees is whatever was typed but the person
// notified is the id. Plain functions (no server-only import) so the composer and the message view use the same parser.

const TOKEN = /@\[([^\]\n]{1,80})\]\(user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

/** The ids mentioned in a message, each once, in the order they first appear. */
export function extractMentions(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(TOKEN)) seen.add(match[2].toLowerCase());
  return [...seen];
}

export type MentionPart = { text: string } | { mention: { name: string; userId: string } };

/** Splits a message into plain text and mention chips for display. Anything that is not a well-formed token stays plain text. */
export function splitMentions(body: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: body.slice(last, at) });
    parts.push({ mention: { name: match[1], userId: match[2].toLowerCase() } });
    last = at + match[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** The token the composer inserts for a person. Brackets are removed from the name so it cannot break the token. */
export function mentionToken(name: string, userId: string): string {
  return `@[${name.replace(/[\][\n]/g, "").trim().slice(0, 80) || "Someone"}](user:${userId})`;
}
