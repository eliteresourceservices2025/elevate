import "server-only";
import { inArray } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isNewer, type Platform, type ReleaseNotes } from "./releases-logic";
import { trackerReleaseBuilds, trackerReleases } from "./schema";

export type AdminRelease = {
  id: string;
  version: string;
  status: "draft" | "published" | "withdrawn";
  createdAt: string;
  publishedAt: string | null;
  minRequired: boolean;
  addsCollection: boolean;
  notes: ReleaseNotes;
  platforms: Platform[];
  builds: { platform: Platform; kind: "installer" | "update"; sizeBytes: number }[];
};

/** Every release for HR and Super Admin, newest version first, with the platforms that have a build. */
export async function listReleasesAdmin(): Promise<AdminRelease[]> {
  const user = await requireUser();
  await authorize(user, "tracker.manage_releases");
  const releases = await db.select().from(trackerReleases);
  const builds = releases.length === 0 ? [] : await db.select().from(trackerReleaseBuilds).where(inArray(trackerReleaseBuilds.releaseId, releases.map((r) => r.id)));
  return releases
    .map((r): AdminRelease => {
      const mine = builds.filter((b) => b.releaseId === r.id);
      return {
        id: r.id,
        version: r.version,
        status: r.status as AdminRelease["status"],
        createdAt: r.createdAt.toISOString(),
        publishedAt: r.publishedAt?.toISOString() ?? null,
        minRequired: r.minRequired,
        addsCollection: r.addsCollection,
        notes: { added: r.notesAdded, improved: r.notesImproved, fixed: r.notesFixed },
        platforms: [...new Set(mine.map((b) => b.platform as Platform))],
        builds: mine.map((b) => ({ platform: b.platform as Platform, kind: b.kind as "installer" | "update", sizeBytes: b.sizeBytes })),
      };
    })
    .sort((a, b) => (isNewer(a.version, b.version) ? -1 : isNewer(b.version, a.version) ? 1 : 0));
}
