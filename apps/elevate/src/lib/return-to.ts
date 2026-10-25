// "Back to the list I came from": a list adds its own address to the link it opens (`?from=/people?team=…&page=2`), and the detail
// page turns that into its first breadcrumb. The address is only ever used as an in-app link, so it must be one of our own list pages:
// anything else (another site, a protocol-relative address, a page that is not a list) is ignored and the usual breadcrumb stays.

/** The list pages a detail page may return to, and what the breadcrumb calls them. */
const LISTS: { pattern: RegExp; label: string }[] = [
  { pattern: /^\/people(?:\?|$)/, label: "People" },
  { pattern: /^\/recruiting\/applicants(?:\?|$)/, label: "Applicants" },
  { pattern: /^\/training(?:\?|$)/, label: "Training status" },
];

/** The address to return to, or null when `raw` is missing or not one of the allowed list pages. */
export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 500) return null;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || [...raw].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return null;
  return LISTS.some((l) => l.pattern.test(raw)) ? raw : null;
}

/** The breadcrumb for a safe return address: "People", or "People (filtered)" when the address carries a search or filters. */
export function returnCrumb(from: string | null): { label: string; href: string } | null {
  if (!from) return null;
  const list = LISTS.find((l) => l.pattern.test(from));
  if (!list) return null;
  const query = new URLSearchParams(from.split("?")[1] ?? "");
  const narrowed = [...query.keys()].some((k) => !["page", "size", "sort", "dir", "tab"].includes(k));
  return { label: narrowed ? `${list.label} (filtered)` : list.label, href: from };
}

/** The link to a record, remembering the list it was opened from. */
export function withReturn(href: string, from: string | null | undefined): string {
  return from ? `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}` : href;
}

/** A list page's own address with its current filters, sort and page, for the links it opens. */
export function listAddress(basePath: string, query: Record<string, string | number | boolean | undefined | null>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "" && v !== false) q.set(k, String(v));
  const s = q.toString();
  return s ? `${basePath}?${s}` : basePath;
}
