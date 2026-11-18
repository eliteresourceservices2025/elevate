// Pure rules for GIFs, shared by the server code and its tests (no network, no secrets).

export type GifProvider = "klipy" | "giphy";
export type GifResult = { id: string; title: string; url: string; previewUrl: string; width: number; height: number };

/** Only these hosts (or their subdomains) are ever fetched: KLIPY's and GIPHY's own media hosts. */
const HOST_SUFFIXES = ["klipy.com", "klipy.co", "giphy.com"];

/** https only, an allowed GIF host, no credentials, no odd ports. The only URLs we will ever fetch. */
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

/** The attribution line each provider requires next to its GIFs. */
export const GIF_ATTRIBUTION: Record<GifProvider, string> = { klipy: "Powered by KLIPY", giphy: "Powered by GIPHY" };

/** Which provider to use: GIF_PROVIDER when it names one that has a key, otherwise the first one with a key (KLIPY first). */
export function chooseGifProvider(env: { GIF_PROVIDER?: string; KLIPY_API_KEY?: string; GIPHY_API_KEY?: string }): GifProvider | null {
  const has = (p: GifProvider) => Boolean(p === "klipy" ? env.KLIPY_API_KEY : env.GIPHY_API_KEY);
  const wanted = env.GIF_PROVIDER?.trim().toLowerCase();
  if ((wanted === "klipy" || wanted === "giphy") && has(wanted)) return wanted;
  if (wanted === "off") return null;
  return has("klipy") ? "klipy" : has("giphy") ? "giphy" : null;
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

/** KLIPY: results under data.data (or data, or results), media under file/files with sizes hd, md, sm and xs, each in several formats. */
function parseKlipy(list: unknown[]): GifResult[] {
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

/** GIPHY: data[] items with images.fixed_width (the one we send, about 200 px wide) and images.fixed_width_small (the preview). */
function parseGiphy(list: unknown[]): GifResult[] {
  const out: GifResult[] = [];
  const pick = (images: Record<string, unknown>, names: string[]) => {
    for (const name of names) {
      const entry = images[name];
      if (entry && typeof entry === "object") {
        const url = (entry as { url?: unknown }).url;
        if (isAllowedGifUrl(url)) return { url, width: Number((entry as { width?: unknown }).width) || 0, height: Number((entry as { height?: unknown }).height) || 0 };
      }
    }
    return null;
  };
  for (const raw of list.slice(0, 50)) {
    if (raw === null || typeof raw !== "object") continue;
    const item = raw as { id?: unknown; title?: unknown; images?: unknown };
    const id = String(item.id ?? "");
    if (!id || item.images === null || typeof item.images !== "object") continue;
    const images = item.images as Record<string, unknown>;
    const send = pick(images, ["fixed_width", "downsized", "fixed_height", "original"]);
    const preview = pick(images, ["fixed_width_small", "fixed_height_small", "fixed_width"]);
    if (!send || !preview) continue;
    out.push({ id, title: String(item.title ?? "GIF").trim().slice(0, 120) || "GIF", url: send.url, previewUrl: preview.url, width: send.width, height: send.height });
  }
  return out;
}

/**
 * Turns a provider's search answer into a short list of GIFs we can show: one to send and a small one to preview. Tolerant of the exact
 * nesting; anything that is not an allowed https image from a known GIF host is dropped, so a surprise in the answer shows nothing
 * rather than something unsafe. GIPHY answers have `images`; KLIPY answers have `file`.
 */
export function parseGifResults(payload: unknown): GifResult[] {
  const root = payload as { data?: unknown; results?: unknown } | null;
  const list = (Array.isArray(root?.data) ? root?.data : Array.isArray((root?.data as { data?: unknown } | undefined)?.data) ? (root?.data as { data: unknown[] }).data : Array.isArray(root?.results) ? root?.results : []) as unknown[];
  const first = list.find((x) => x !== null && typeof x === "object") as Record<string, unknown> | undefined;
  return first && "images" in first ? parseGiphy(list) : parseKlipy(list);
}
