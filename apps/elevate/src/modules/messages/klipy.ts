import "server-only";
import { allowRequest } from "@/lib/rate-limit";
import { ActionFailure } from "@/lib/run-action";
import { GIF_ATTRIBUTION, chooseGifProvider, isAllowedGifUrl, parseGifResults, type GifProvider, type GifResult } from "./gif-rules";

// GIFs come from KLIPY or GIPHY, through our server only: the browser never talks to either, so they never see staff IP addresses, and a GIF
// is shown through our own authenticated route. GIF_PROVIDER picks one ("klipy", "giphy" or "off"); without it the first provider with a key
// is used. Without any key the feature is simply off. (The file keeps its old name; it now serves both providers.)

const TIMEOUT_MS = 8_000;
const MAX_GIF_BYTES = 5 * 1024 * 1024;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; gifs: GifResult[] }>();

export const gifProvider = (): GifProvider | null => chooseGifProvider({ GIF_PROVIDER: process.env.GIF_PROVIDER, KLIPY_API_KEY: process.env.KLIPY_API_KEY, GIPHY_API_KEY: process.env.GIPHY_API_KEY });
export const gifsEnabled = () => gifProvider() !== null;
export const gifAttribution = (): string | null => {
  const provider = gifProvider();
  return provider ? GIF_ATTRIBUTION[provider] : null;
};

function searchUrl(provider: GifProvider, q: string): URL {
  if (provider === "klipy") {
    const url = new URL(`https://api.klipy.com/api/v1/${encodeURIComponent(process.env.KLIPY_API_KEY ?? "")}/gifs/search`);
    url.searchParams.set("q", q);
    url.searchParams.set("per_page", "24");
    url.searchParams.set("page", "1");
    url.searchParams.set("rating", "pg");
    return url;
  }
  const url = new URL("https://api.giphy.com/v1/gifs/search");
  url.searchParams.set("api_key", process.env.GIPHY_API_KEY ?? "");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "24");
  url.searchParams.set("offset", "0");
  url.searchParams.set("rating", "pg");
  url.searchParams.set("lang", "en");
  return url;
}

/**
 * Safe-for-work search. Answers are kept for ten minutes (the same words from different people cost one call), each person gets a few
 * searches per ten minutes, and the whole company stays under GIPHY's free allowance of 100 calls an hour. Returns [] when nothing matches.
 */
export async function searchGifs(userId: string, q: string): Promise<GifResult[]> {
  const provider = gifProvider();
  if (!provider) return [];
  const key = `${provider}:${q.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.gifs;

  if (!(await allowRequest("gifSearch", userId))) throw new ActionFailure("You are searching GIFs too fast. Wait a minute and try again.");
  if (provider === "giphy" && !(await allowRequest("gifSearchCompany", "all"))) throw new ActionFailure("GIF search is busy right now. Try again in a few minutes.");

  const response = await fetch(searchUrl(provider, q), { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`gif search ${response.status}`);
  const gifs = parseGifResults(await response.json());
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), gifs });
  return gifs;
}

/** Fetches one allowed GIF's bytes for the proxy route: https, an allowed GIF host only, no redirects, size and type limits. */
export async function fetchGif(url: string): Promise<{ bytes: Uint8Array; mime: "image/gif" | "image/webp" } | null> {
  if (!isAllowedGifUrl(url)) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
  if (!response.ok) return null;
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== "image/gif" && mime !== "image/webp") return null;
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_GIF_BYTES || !response.body) return null;
  // Read as it arrives and stop at the limit, so a missing or false Content-Length cannot make us hold a huge body.
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_GIF_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  if (total === 0) return null;
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { bytes, mime };
}
