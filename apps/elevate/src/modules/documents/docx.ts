import "server-only";
import mammoth from "mammoth";

// Reading Word (DOCX) files on our own server, for two things: plain text (the resume keyword match) and a safe in-page preview of a
// document, so nobody has to download a file just to look at it. The file is untrusted (applicants and staff upload it), so it is
// refused BEFORE it is opened when it looks like a decompression bomb, the work has a time limit, and the preview is rebuilt from
// an allowlist of plain structure tags: no script, no link, no picture, no style, nothing the file itself can inject.

export const EXTRACT_TIMEOUT_MS = 10_000;
export const MAX_DOCX_UNPACKED_BYTES = 25 * 1024 * 1024;
export const MAX_DOCX_PARTS = 300;
/** A preview longer than this is cut off with a note (a contract or handbook is far shorter). */
export const MAX_PREVIEW_CHARS = 600_000;

/**
 * The total unpacked size and the number of parts a ZIP declares in its central directory, or null when the directory cannot be read.
 * Cheap (no unpacking). A hostile file can lie in these headers, so this is a first filter, not a proof.
 */
export function zipDeclaredSize(bytes: Uint8Array): { unpacked: number; parts: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record is within the last 64 KB + 22 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  const parts = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  let unpacked = 0;
  for (let n = 0; n < parts; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    unpacked += view.getUint32(offset + 24, true);
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return { unpacked, parts };
}

/** True when the file's own headers say it is an ordinary size (and can therefore be opened). */
export function isReasonableDocx(bytes: Uint8Array): boolean {
  const size = zipDeclaredSize(bytes);
  return size !== null && size.unpacked <= MAX_DOCX_UNPACKED_BYTES && size.parts <= MAX_DOCX_PARTS;
}

export function withTimeout<T>(work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), EXTRACT_TIMEOUT_MS);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The plain text of a DOCX, or null when it is unreasonable, damaged or empty. */
export async function docxToText(bytes: Uint8Array): Promise<string | null> {
  if (!isReasonableDocx(bytes)) return null;
  try {
    const result = await withTimeout(mammoth.extractRawText({ buffer: Buffer.from(bytes) }));
    return result?.value ?? null;
  } catch {
    return null;
  }
}

// ---- Safe preview ----------------------------------------------------------------------------------------------------------

/** Tags kept in a preview. Everything else (script, style, img, a, iframe, form, svg, ...) is dropped; kept tags lose every attribute except cell spans. */
const KEEP = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "em", "br", "sup", "sub", "table", "thead", "tbody", "tr", "td", "th"]);
const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s[^>]*)?)\/?>/g;

/**
 * Rebuilds HTML from converted Word output keeping only the structure tags above. The text between tags is already escaped by the
 * converter; a stray "<" that is not part of a kept tag is escaped here, so no input can produce a tag that is not on the list.
 */
export function sanitizeDocxHtml(html: string): string {
  let out = "";
  let last = 0;
  for (const m of html.matchAll(TAG)) {
    const start = m.index ?? 0;
    out += html.slice(last, start).replace(/</g, "&lt;");
    last = start + m[0].length;
    if (m[0].startsWith("<!--")) continue;
    const closing = m[1] === "/";
    const name = m[2].toLowerCase();
    if (!KEEP.has(name)) continue;
    if (closing) {
      out += `</${name}>`;
      continue;
    }
    const spans = name === "td" || name === "th" ? [...m[3].matchAll(/\s(colspan|rowspan)\s*=\s*"?(\d{1,2})"?/gi)].map((s) => ` ${s[1].toLowerCase()}="${s[2]}"`).join("") : "";
    out += name === "br" ? "<br>" : `<${name}${spans}>`;
  }
  out += html.slice(last).replace(/</g, "&lt;");
  return out;
}

/** The body of a safe preview for a DOCX (no page wrapper), or null when it is unreasonable, damaged or empty. */
export async function docxToPreviewBody(bytes: Uint8Array): Promise<string | null> {
  if (!isReasonableDocx(bytes)) return null;
  try {
    const result = await withTimeout(
      mammoth.convertToHtml(
        { buffer: Buffer.from(bytes) },
        // Pictures are not shown (the converter is told to give them no source, so it never reads them).
        { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
      ),
    );
    if (!result) return null;
    let body = sanitizeDocxHtml(result.value);
    if (body.replace(/<[^>]+>/g, "").trim() === "") return null;
    if (body.length > MAX_PREVIEW_CHARS) body = `${sanitizeDocxHtml(result.value.slice(0, MAX_PREVIEW_CHARS))}<p><em>The preview stops here because the document is very long. Download it to read the rest.</em></p>`;
    return body;
  } catch {
    return null;
  }
}

/** The security header for a rebuilt Word preview: a sandbox with no scripts, no network and no navigation, whatever the file contains. */
export const PREVIEW_HTML_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A complete page for the preview frame: our own style, a short note, and the sanitized body. */
export function previewPage(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>
body{margin:0 auto;max-width:48rem;padding:1.25rem;font:15px/1.6 Inter,system-ui,sans-serif;color:#1f1b2d;background:#fff}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.4em 0 .5em}p{margin:.7em 0}ul,ol{padding-left:1.5rem}
table{border-collapse:collapse;margin:1em 0;max-width:100%}td,th{border:1px solid #cfc8dc;padding:.3rem .55rem;vertical-align:top}
.note{margin:0 0 1rem;padding:.4rem .7rem;border-radius:.5rem;background:#f4f0fa;color:#4b4560;font-size:.8rem}
</style></head><body><p class="note">A plain preview: pictures and some formatting are left out. Download the file to see it exactly as written.</p>${body}</body></html>`;
}
