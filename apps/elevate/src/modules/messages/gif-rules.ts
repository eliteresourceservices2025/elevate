// Pure rules for GIFs, shared by the server code and its tests (no network, no secrets).

export type GifResult = { id: string; title: string; url: string; previewUrl: string; width: number; height: number };

const HOST_SUFFIXES = ["klipy.com", "klipy.co"];

/** https only, a KLIPY host (the host itself or a subdomain), no credentials, no odd ports. The only URLs we will ever fetch. */
export function isAllowedGifUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 600) return false;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  return HOST_SUFFIXES.some((s) => u.hostname === s || u.hostname.endsWith(`.${s}`));
}

type Found = { path: string; url: string; width: number; height: number };

/** Every https URL found under a "files" object, with the key path it was found at and any width/height next to it. */
function collect(node: unknown, path: string, out: Found[], depth = 0): void {
  if (depth > 6 || node === null || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  if (typeof obj.url === "string") out.push({ path, url: obj.url, width: Number(obj.width) || 0, height: Number(obj.height) || 0 });
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && key !== "url" && /^https:/.test(value)) out.push({ path: `${path}/${key}`, url: value, width: 0, height: 0 });
    else collect(value, `${path}/${key}`, out, depth + 1);
  }
}

const isImage = (f: Found) => /\.(gif|webp)(\?|$)/i.test(f.url) || /gif|webp/i.test(f.path);
const score = (f: Found, wanted: RegExp) => (wanted.test(f.path) ? 2 : 0) + (/gif/i.test(f.path) || /\.gif(\?|$)/i.test(f.url) ? 1 : 0);

/**
 * Turns KLIPY's search answer into a short list of GIFs we can show: a medium-size file to send and a small one to preview.
 * Tolerant of the exact nesting (results under data.data, data or results; media under files/file/media_formats); anything that is
 * not an allowed https KLIPY image is dropped, so a surprise in the answer shows nothing rather than something unsafe.
 */
export function parseGifResults(payload: unknown): GifResult[] {
  const root = payload as { data?: unknown; results?: unknown } | null;
  const list = (Array.isArray(root?.data) ? root?.data : Array.isArray((root?.data as { data?: unknown } | undefined)?.data) ? (root?.data as { data: unknown[] }).data : Array.isArray(root?.results) ? root?.results : []) as unknown[];
  const out: GifResult[] = [];
  for (const raw of list.slice(0, 50)) {
    if (raw === null || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const id = String(item.id ?? item.slug ?? "");
    if (!id) continue;
    const files: Found[] = [];
    collect(item.files ?? item.file ?? item.media_formats ?? item.media, "", files);
    const images = files.filter((f) => isImage(f) && isAllowedGifUrl(f.url));
    if (images.length === 0) continue;
    const best = [...images].sort((a, b) => score(b, /(^|\/)(md|sm|medium|small)(\/|$)/i) - score(a, /(^|\/)(md|sm|medium|small)(\/|$)/i))[0];
    const small = [...images].sort((a, b) => score(b, /(^|\/)(xs|sm|tiny|preview|small)(\/|$)/i) - score(a, /(^|\/)(xs|sm|tiny|preview|small)(\/|$)/i))[0];
    out.push({ id, title: String(item.title ?? item.slug ?? "GIF").slice(0, 120), url: best.url, previewUrl: small.url, width: best.width, height: best.height });
  }
  return out;
}
