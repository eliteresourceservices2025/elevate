// A deliberately small Markdown parser for announcements and policies. It produces a tree of plain
// data that React renders as elements, so there is no HTML string anywhere to inject into:
// "<script>" is just text, images are not supported, and only safe link targets become links.

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; external: boolean; children: Inline[] };

export type Block =
  | { type: "heading"; level: 2 | 3 | 4; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] };

export const MARKDOWN_MAX_LENGTH = 10_000;

/** Returns the link target when it is safe to follow, otherwise null. Only https, http, mailto and in-app paths. */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const href = raw.trim();
  if (href === "" || /[\u0000-\u001f\u007f\s]/.test(href)) return null;
  if (href.startsWith("/") && !href.startsWith("//") && !href.includes("\\")) return { href, external: false };
  try {
    const url = new URL(href);
    if (url.protocol === "https:" || url.protocol === "http:") return { href: url.toString(), external: true };
    if (url.protocol === "mailto:") return { href: url.toString(), external: true };
  } catch {
    // not a URL
  }
  return null;
}

const text = (t: string): Inline => ({ type: "text", text: t });

function merge(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === "text" && last?.type === "text") last.text += n.text;
    else out.push(n);
  }
  return out;
}

/**
 * Reads "[label](target)" at the start of the text. The target may hold nested parentheses, so
 * "javascript:alert(1)" is read whole (and then refused by safeHref) instead of leaving a stray ")".
 */
function readLink(rest: string): { label: string; target: string; length: number } | null {
  if (rest[0] !== "[") return null;
  const close = rest.indexOf("]");
  if (close < 2 || rest.slice(0, close).includes("\n") || rest[close + 1] !== "(") return null;
  let depth = 1;
  for (let j = close + 2; j < rest.length; j++) {
    const c = rest.charAt(j);
    if (c === "\n") return null;
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) {
      const target = rest.slice(close + 2, j);
      return target === "" ? null : { label: rest.slice(1, close), target, length: j + 1 };
    }
  }
  return null;
}

/** Bold, italic, code and links. Anything that does not parse cleanly stays as literal text. */
export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);

    const code = /^`([^`\n]+)`/.exec(rest);
    if (code) {
      out.push({ type: "code", text: code[1] });
      i += code[0].length;
      continue;
    }

    const link = depth < 3 ? readLink(rest) : null;
    if (link) {
      const target = safeHref(link.target);
      if (target) out.push({ type: "link", ...target, children: parseInline(link.label, depth + 1) });
      else out.push(...parseInline(link.label, depth + 1)); // unsafe target: keep the words, drop the link
      i += link.length;
      continue;
    }

    const strong = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest);
    if (strong && depth < 3) {
      out.push({ type: "strong", children: parseInline(strong[2], depth + 1) });
      i += strong[0].length;
      continue;
    }

    const em = /^(\*|_)(?=\S)([^*_\n]*?\S)\1/.exec(rest);
    if (em && depth < 3) {
      out.push({ type: "em", children: parseInline(em[2], depth + 1) });
      i += em[0].length;
      continue;
    }

    out.push(text(rest[0]));
    i += 1;
  }
  return merge(out);
}

/** Headings (#, ##, ###), bullet and numbered lists, quotes and paragraphs. Blank lines separate blocks. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.slice(0, MARKDOWN_MAX_LENGTH).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) blocks.push({ type: "paragraph", children: parseInline(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items.map((t) => parseInline(t)) });
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara();
      flushList();
      // The page already has an h1, so # renders as h2.
      blocks.push({ type: "heading", level: (heading[1].length + 1) as 2 | 3 | 4, children: parseInline(heading[2].trim()) });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d{1,3}[.)]\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      flushPara();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushPara();
      flushList();
      blocks.push({ type: "quote", children: parseInline(quote[1]) });
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}
