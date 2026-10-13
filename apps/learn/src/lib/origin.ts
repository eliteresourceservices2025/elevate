/**
 * A state-changing request must come from the expected site. Browsers always send `Origin` on a cross-site form post and on any
 * non-GET request, so a missing or different value is refused. (The handoff token is the real proof; this also stops someone
 * making a person's browser post the token of the attacker's own session.)
 */
export function originMatches(request: Request, expected: string | null): boolean {
  if (!expected) return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

/**
 * A form post from this very site: the `Origin` host must equal the host the request was sent to (the forwarded host behind the
 * platform's proxy, otherwise the Host header). Used for sign out, where there is no other site to name.
 */
export function sameSiteOrigin(request: Request): boolean {
  // Browsers state this themselves and a page cannot change it. (Under `Referrer-Policy: no-referrer`, which this app sets, a
  // browser sends `Origin: null` on a post, so Origin alone cannot be relied on here.)
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin";
  const origin = request.headers.get("origin");
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

/** Where ELEVATE lives, as an origin. Null when it is not configured (production needs it). */
export function elevateUrl(env: Record<string, string | undefined> = process.env): string | null {
  const configured = env.NEXT_PUBLIC_ELEVATE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return env.NODE_ENV === "production" ? null : "http://localhost:3000";
}
