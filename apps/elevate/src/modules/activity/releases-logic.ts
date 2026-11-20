// Pure rules for ELEVATE Tracker App releases: versions, notes, platforms. No database and no React.

export const PLATFORMS = ["windows-x86_64", "darwin-aarch64", "darwin-x86_64"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const isPlatform = (v: unknown): v is Platform => typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);

const PART = /^(0|[1-9]\d{0,5})$/;

/** MAJOR.MINOR.PATCH, each a plain number under a million (no leading zeros, no suffix). Anything else is not a version. */
export function parseVersion(v: string): [number, number, number] | null {
  const parts = v.split(".");
  if (parts.length !== 3 || !parts.every((p) => PART.test(p))) return null;
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

/** Negative, 0 or positive. A version that cannot be read sorts lowest, so it is never "newer" and is always offered an update. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

export const isNewer = (candidate: string, current: string): boolean => compareVersions(candidate, current) > 0;

export type ReleaseNotes = { added: string[]; improved: string[]; fixed: string[] };
const MAX_LINES = 12;
const MAX_LINE = 200;

/** Turns the three text boxes (one change per line) into lists. At least one line overall; at most 12 per group, 200 characters each. */
export function normalizeNotes(input: { added: string; improved: string; fixed: string }): { ok: true; notes: ReleaseNotes } | { ok: false; error: string } {
  const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const notes: ReleaseNotes = { added: lines(input.added), improved: lines(input.improved), fixed: lines(input.fixed) };
  const groups = [notes.added, notes.improved, notes.fixed];
  if (groups.every((g) => g.length === 0)) return { ok: false, error: "Write at least one change under Added, Improved or Fixed." };
  if (groups.some((g) => g.length > MAX_LINES)) return { ok: false, error: `Each group can have up to ${MAX_LINES} lines.` };
  if (groups.some((g) => g.some((l) => l.length > MAX_LINE))) return { ok: false, error: `Each line can be up to ${MAX_LINE} characters.` };
  return { ok: true, notes };
}

/** The visitor's computer from the browser's own description. Phones, tablets, Linux and anything unknown are "other". */
export function detectPlatform(userAgent: string | null): "windows" | "mac" | "other" {
  if (!userAgent) return "other";
  if (/iPhone|iPad|iPod|Android|Mobile/i.test(userAgent)) return "other";
  if (/Windows NT/i.test(userAgent)) return "windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "mac";
  return "other";
}

export function platformsFor(os: "windows" | "mac"): Platform[] {
  return os === "windows" ? ["windows-x86_64"] : ["darwin-aarch64", "darwin-x86_64"];
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The newest published (not withdrawn) version that has a build for the platform and is newer than the current one; otherwise null. */
export function pickUpdate(input: { platform: Platform; currentVersion: string | null; published: readonly { version: string; platforms: readonly Platform[]; status: "published" | "withdrawn" }[] }): string | null {
  const current = input.currentVersion ?? "";
  let best: string | null = null;
  for (const r of input.published) {
    if (r.status !== "published" || !r.platforms.includes(input.platform) || !isNewer(r.version, current)) continue;
    if (best === null || isNewer(r.version, best)) best = r.version;
  }
  return best;
}
