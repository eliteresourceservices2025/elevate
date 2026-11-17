import "server-only";
import { parseGifResults, isAllowedGifUrl, type GifResult } from "./gif-rules";

// GIFs come from KLIPY, through our server only: the browser never talks to KLIPY, so KLIPY never sees staff IP addresses, and a GIF is
// shown through our own authenticated route. Without KLIPY_API_KEY the feature is simply off (search returns "not set up").
// NOTE: KLIPY's per-GIF response fields were not available when this was written (no key, docs page unreadable), so the parser in
// gif-rules.ts is deliberately tolerant and fails closed. Confirm it against a real response when the key exists.

const BASE = "https://api.klipy.com/api/v1";
const MAX_GIF_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 8_000;

export const gifsEnabled = () => Boolean(process.env.KLIPY_API_KEY);

/** Safe-for-work search (rating g/pg). Returns [] when nothing matches; throws when the service can't be reached. */
export async function searchGifs(q: string, page = 1): Promise<GifResult[]> {
  const key = process.env.KLIPY_API_KEY;
  if (!key) return [];
  const url = new URL(`${BASE}/${encodeURIComponent(key)}/gifs/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("per_page", "24");
  url.searchParams.set("page", String(page));
  url.searchParams.set("rating", "pg");
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`klipy ${response.status}`);
  return parseGifResults(await response.json());
}

/** Fetches one allowed GIF's bytes for the proxy route: https, KLIPY host only, no redirects, size and type limits. */
export async function fetchGif(url: string): Promise<{ bytes: Uint8Array; mime: "image/gif" | "image/webp" } | null> {
  if (!isAllowedGifUrl(url)) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  if (!response.ok) return null;
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== "image/gif" && mime !== "image/webp") return null;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_GIF_BYTES) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_GIF_BYTES) return null;
  return { bytes, mime };
}
