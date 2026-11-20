import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { monitoringPolicyPublished, personForUser } from "@/modules/attendance/service";
import type { DeviceRow } from "./queries";
import { isNewer, type Platform, type ReleaseNotes } from "./releases-logic";
import { getPublishedReleases, type PublishedRelease } from "./releases-service";
import { trackerDevices, trackerReleaseBuilds, trackerReleases } from "./schema";

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

export type DownloadPageData = { policy: boolean; current: PublishedRelease | null; releases: PublishedRelease[]; devices: DeviceRow[] };

/** Everything the download page shows: published releases (never drafts or withdrawn ones), the newest as current, and the person's own computers. */
export async function getDownloadPage(): Promise<DownloadPageData> {
  const user = await requireUser();
  await authorize(user, "tracker.download", { ownerUserId: user.id });
  const releases = (await getPublishedReleases()).filter((r) => r.status === "published");
  let devices: DeviceRow[] = [];
  try {
    const person = await personForUser(db, user.id);
    const mine = await db.select().from(trackerDevices).where(and(eq(trackerDevices.employeeId, person.id), eq(trackerDevices.status, "active"))).orderBy(trackerDevices.createdAt).limit(10);
    devices = mine.map((d) => ({ id: d.id, employeeId: d.employeeId, name: d.name, os: d.os, appVersion: d.appVersion, lastSeenAt: d.lastSeenAt?.toISOString() ?? null, status: d.status, permissionsOk: d.permissionsOk, queueSize: d.queueSize }));
  } catch {
    // No people record yet: the page still works, with no computers listed.
  }
  return { policy: await monitoringPolicyPublished(db), current: releases[0] ?? null, releases, devices };
}

export type ReleaseAdminView = { releases: AdminRelease[]; policyVersions: { id: string; label: string }[] };

/** The admin page's data: every release, and the published monitoring policy versions a release that adds data collection can name. */
export async function getReleaseAdminView(): Promise<ReleaseAdminView> {
  const releases = await listReleasesAdmin(); // checks tracker.manage_releases
  const versions = (await db.execute(sql`
    select v.id, v.version, v.published_at from docs.policy_versions v join docs.policies p on p.id = v.policy_id
    where p.kind = 'monitoring' and v.status = 'published' order by v.version desc limit 20`)) as unknown as { id: string; version: number; published_at: string | Date | null }[];
  return {
    releases,
    policyVersions: versions.map((v) => ({ id: v.id, label: `Version ${v.version}, published ${v.published_at ? new Date(v.published_at).toISOString().slice(0, 10) : "earlier"}` })),
  };
}
