import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";
import { careerPath } from "./slug";

// The public job feed (for the company's WordPress site). Pure helpers: what a job looks like in the feed, plain text from Markdown,
// which web addresses may read the feed from a browser, and safe JSON for a <script> tag. No applicant data and no internal field is
// ever part of a feed job: only what the public careers page already shows.

export type FeedSource = { id: string; slug: string | null; title: string; location: string; payNote: string | null; openedAt: Date | null; description?: string };

export type FeedJob = {
  id: string;
  slug: string;
  title: string;
  location: string;
  payNote: string | null;
  /** ISO time the job was opened, or null. */
  postedAt: string | null;
  /** The job on ELEVATE (where people read it and apply). */
  url: string;
  /** A short plain-text summary of the description (up to 300 characters). */
  summary: string;
  /** The full description as Markdown (the detail address only). */
  description?: string;
};

const inline = (nodes: Inline[]): string => nodes.map((n) => (n.type === "text" || n.type === "code" ? n.text : inline(n.children))).join("");

/** Plain text of a Markdown description: paragraphs and list items joined with spaces, no markup. */
export function plainText(markdown: string): string {
  const parts = parseMarkdown(markdown).flatMap((b: Block) => (b.type === "list" ? b.items.map(inline) : [inline(b.children)]));
  return parts.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
}

/** The first `max` characters, cut at a word and ended with an ellipsis when it was longer. */
export function excerpt(text: string, max = 300): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The web address of the ELEVATE site with no trailing slash, from NEXT_PUBLIC_APP_URL. */
export const baseUrl = (raw: string | undefined): string => (raw ?? "http://localhost:3000").trim().replace(/\/+$/, "");

export function toFeedJob(job: FeedSource, base: string, opts: { withDescription?: boolean } = {}): FeedJob {
  const text = plainText(job.description ?? "");
  return {
    id: job.id,
    slug: job.slug ?? job.id,
    title: job.title,
    location: job.location,
    payNote: job.payNote,
    postedAt: job.openedAt ? job.openedAt.toISOString() : null,
    url: `${base}${careerPath(job)}`,
    summary: excerpt(text),
    ...(opts.withDescription ? { description: job.description ?? "" } : {}),
  };
}

/** The addresses (scheme and host, no path) allowed to read the feed from a browser, from a comma separated setting. */
export function parseOrigins(raw: string | undefined): string[] {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    try {
      const u = new URL(part.trim());
      if (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) out.add(u.origin);
    } catch {
      // not an address: ignored
    }
  }
  return [...out];
}

/** CORS headers for a read: only a listed origin gets them (and `Vary: Origin` always, so a cache never serves one site's answer to another). */
export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

/** The value for a `frame-ancestors` rule: this site itself and the listed origins (nothing else may put the careers pages in a frame). */
export const frameAncestors = (origins: string[]): string => ["'self'", ...origins].join(" ");

/** JSON for inside a <script type="application/ld+json"> tag: "<" is escaped so a job description can never close the tag. */
export const safeJsonLd = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c").replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028").replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");

/** schema.org JobPosting for the job detail page (search engines that list jobs read it). */
export function jobPostingJsonLd(job: FeedSource & { description: string }, base: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: plainText(job.description),
    ...(job.openedAt ? { datePosted: job.openedAt.toISOString().slice(0, 10) } : {}),
    employmentType: "CONTRACTOR",
    hiringOrganization: { "@type": "Organization", name: "Elite Resource Services", sameAs: base },
    jobLocationType: /remote/i.test(job.location) ? "TELECOMMUTE" : undefined,
    directApply: true,
    url: `${base}${careerPath(job)}`,
  };
}
