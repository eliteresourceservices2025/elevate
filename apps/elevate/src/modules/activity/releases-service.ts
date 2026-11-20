import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { isNewer, parseVersion, type Platform, type ReleaseNotes } from "./releases-logic";
import { trackerReleaseBuilds, trackerReleases } from "./schema";

// Server-only release logic with no signed-in person: the build script uses registerBuild, the pages and routes read releases.

export type BuildInfo = { platform: Platform; kind: "installer" | "update"; sizeBytes: number; sha256: string; signature: string | null; storagePath: string; fileName: string };
export type PublishedRelease = {
  id: string;
  version: string;
  publishedAt: string;
  status: "published" | "withdrawn";
  minRequired: boolean;
  notes: ReleaseNotes;
  builds: BuildInfo[];
};

/** Attaches a build to a DRAFT release (the database refuses anything else). Used by `pnpm tracker:build`. */
export async function registerBuild(input: {
  version: string;
  platform: Platform;
  kind: "installer" | "update";
  storagePath: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  signature: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!parseVersion(input.version)) return { ok: false, error: "That is not a version number (use MAJOR.MINOR.PATCH, for example 1.2.0)." };
  const [release] = await db.select({ id: trackerReleases.id, status: trackerReleases.status }).from(trackerReleases).where(eq(trackerReleases.version, input.version)).limit(1);
  if (!release) return { ok: false, error: `There is no release ${input.version}. Create it as a draft first (Settings > ELEVATE Tracker > Releases).` };
  if (release.status !== "draft") return { ok: false, error: `Release ${input.version} is already ${release.status}; builds can only be added to a draft.` };
  if (input.kind === "update" && !input.signature?.trim()) return { ok: false, error: "An update build needs its signature." };
  try {
    await db.insert(trackerReleaseBuilds).values({
      releaseId: release.id,
      platform: input.platform,
      kind: input.kind,
      storagePath: input.storagePath,
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      signature: input.kind === "update" ? input.signature!.trim() : null,
    });
  } catch {
    return { ok: false, error: `Release ${input.version} already has a ${input.kind} build for ${input.platform}.` };
  }
  return { ok: true };
}

/** The highest version of any release that is not a draft (withdrawn ones count: a version number is never reused). */
export async function highestReleasedVersion(exceptId?: string): Promise<string | null> {
  const rows = await db
    .select({ version: trackerReleases.version })
    .from(trackerReleases)
    .where(exceptId ? and(ne(trackerReleases.status, "draft"), ne(trackerReleases.id, exceptId)) : ne(trackerReleases.status, "draft"));
  return rows.map((r) => r.version).reduce<string | null>((best, v) => (best === null || isNewer(v, best) ? v : best), null);
}

/** The highest version of any release at all, drafts included (the next release must beat it). */
export async function highestVersionEver(): Promise<string | null> {
  const rows = await db.select({ version: trackerReleases.version }).from(trackerReleases);
  return rows.map((r) => r.version).reduce<string | null>((best, v) => (best === null || isNewer(v, best) ? v : best), null);
}

/** Published and withdrawn releases with their builds, newest first. Drafts are never returned. */
export async function getPublishedReleases(): Promise<PublishedRelease[]> {
  const releases = await db.select().from(trackerReleases).where(inArray(trackerReleases.status, ["published", "withdrawn"])).orderBy(desc(trackerReleases.publishedAt));
  if (releases.length === 0) return [];
  const builds = await db.select().from(trackerReleaseBuilds).where(inArray(trackerReleaseBuilds.releaseId, releases.map((r) => r.id)));
  const out: PublishedRelease[] = releases.map((r) => ({
    id: r.id,
    version: r.version,
    publishedAt: (r.publishedAt ?? r.createdAt).toISOString(),
    status: r.status as "published" | "withdrawn",
    minRequired: r.minRequired,
    notes: { added: r.notesAdded, improved: r.notesImproved, fixed: r.notesFixed },
    builds: builds
      .filter((b) => b.releaseId === r.id)
      .map((b) => ({ platform: b.platform as Platform, kind: b.kind as "installer" | "update", sizeBytes: b.sizeBytes, sha256: b.sha256, signature: b.signature, storagePath: b.storagePath, fileName: b.fileName })),
  }));
  return out.sort((a, b) => (isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0));
}

// The version floor is read on every upload, so it is kept for a minute (and dropped at once when a release is published or withdrawn
// in this process; other servers pick the change up within the minute).
let floorCache: { at: number; value: string | null } | null = null;
const FLOOR_TTL_MS = 60_000;

export function clearReleaseCache(): void {
  floorCache = null;
}

/** The highest version among published (not withdrawn) releases marked "Required update", or null when none is required. */
export async function minRequiredVersion(): Promise<string | null> {
  if (floorCache && Date.now() - floorCache.at < FLOOR_TTL_MS) return floorCache.value;
  const rows = await db.select({ version: trackerReleases.version }).from(trackerReleases).where(and(eq(trackerReleases.status, "published"), eq(trackerReleases.minRequired, true)));
  const value = rows.map((r) => r.version).reduce<string | null>((best, v) => (best === null || isNewer(v, best) ? v : best), null);
  floorCache = { at: Date.now(), value };
  return value;
}
