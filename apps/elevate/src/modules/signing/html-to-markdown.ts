// Pasting from Word or Google Docs: turns the clipboard's HTML into the Markdown the editor understands (headings, bold, italic,
// bullet and numbered lists, quotes, paragraphs). Everything else (fonts, colors, tables, images) is dropped to plain text.
// Browser only: uses DOMParser, which never runs scripts or loads anything from the pasted HTML.

const HEADING = /^h([1-6])$/;

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "script" || tag === "style") return "";
  const inner = [...el.childNodes].map(inline).join("");
  const weight = el.style?.fontWeight ?? "";
  const bold = tag === "b" || tag === "strong" || weight === "bold" || Number(weight) >= 600;
  const italic = tag === "i" || tag === "em" || el.style?.fontStyle === "italic";
  const text = inner.trim();
  if (!text) return inner;
  const lead = /^\s*/.exec(inner)?.[0] ?? "";
  const trail = /\s*$/.exec(inner)?.[0] ?? "";
  let out = text;
  if (bold) out = `**${out}**`;
  if (italic) out = `*${out}*`;
  return `${lead}${out}${trail}`;
}

function blocks(root: Element, out: string[]) {
  for (const child of [...root.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = (child.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) out.push(t);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as Element;
    const tag = el.tagName.toLowerCase();
    const heading = HEADING.exec(tag);
    if (heading) {
      const level = Math.min(3, Number(heading[1]));
      const t = inline(el).replace(/\*\*/g, "").trim();
      if (t) out.push(`${"#".repeat(level)} ${t}`);
    } else if (tag === "ul" || tag === "ol") {
      const items = [...el.children].filter((c) => c.tagName.toLowerCase() === "li");
      const lines = items
        .map((li) => inline(li).replace(/\s*\n\s*/g, " ").trim())
        .filter((t) => t !== "")
        .map((t, i) => `${tag === "ol" ? `${i + 1}.` : "-"} ${t}`);
      if (lines.length) out.push(lines.join("\n"));
    } else if (tag === "blockquote") {
      const t = inline(el).replace(/\s+/g, " ").trim();
      if (t) out.push(`> ${t}`);
    } else if (tag === "p" || tag === "li") {
      const t = inline(el).replace(/[ \t]*\n[ \t]*/g, " ").replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    } else if (tag === "script" || tag === "style" || tag === "head") {
      continue;
    } else if (tag === "table") {
      for (const row of el.querySelectorAll("tr")) {
        const cells = [...row.querySelectorAll("th,td")].map((c) => inline(c).replace(/\s+/g, " ").trim()).filter(Boolean);
        if (cells.length) out.push(cells.join(" | "));
      }
    } else if (el.querySelector("p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table,div")) {
      blocks(el, out);
    } else {
      const t = inline(el).replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
  }
}

/** Markdown for pasted HTML, or null when the clipboard held no usable HTML. */
export function htmlToMarkdown(html: string): string | null {
  if (!html || !/<(p|h[1-6]|ul|ol|li|div|b|strong|i|em|table|br)\b/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];
  blocks(doc.body, out);
  const md = out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return md || null;
}
