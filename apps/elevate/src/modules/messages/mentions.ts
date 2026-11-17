// @mentions are written into the message text as @[Name](user:<id>), so the name a person sees is whatever was typed but the person
// notified is the id. Plain functions (no server-only import) so the composer and the message view use the same parser.

const TOKEN = /@\[([^\]\n]{1,80})\]\(user:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

// "@everyone" or "@all" typed in a message (or picked from the list) mentions everyone in the chat. It must stand alone: not part of a
// word or an email address ("ana@all.com"), and not followed by more letters ("@allison").
const EVERYONE = /(?<![\w@\]])@(everyone|all)(?![\w-])(?!\.\w)/gi;

/** True when the message mentions everyone in the chat. */
export function mentionsEveryone(body: string): boolean {
  // The user tokens are removed first so a name like @[all](user:...) can never count.
  return new RegExp(EVERYONE.source, "i").test(body.replace(TOKEN, " "));
}

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
  const found: { at: number; length: number; name: string; userId: string }[] = [];
  for (const match of body.matchAll(TOKEN)) found.push({ at: match.index ?? 0, length: match[0].length, name: match[1], userId: match[2].toLowerCase() });
  for (const match of body.matchAll(EVERYONE)) {
    const at = match.index ?? 0;
    if (!found.some((f) => at >= f.at && at < f.at + f.length)) found.push({ at, length: match[0].length, name: match[1], userId: "everyone" });
  }
  found.sort((a, b) => a.at - b.at);
  for (const f of found) {
    if (f.at > last) parts.push({ text: body.slice(last, f.at) });
    parts.push({ mention: { name: f.name, userId: f.userId } });
    last = f.at + f.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/** The token the composer inserts for a person. Brackets are removed from the name so it cannot break the token. */
export function mentionToken(name: string, userId: string): string {
  return `@[${name.replace(/[\][\n]/g, "").trim().slice(0, 80) || "Someone"}](user:${userId})`;
}
