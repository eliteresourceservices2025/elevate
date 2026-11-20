"use server";

import { and, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { BUCKETS, getDocumentStorage } from "@/modules/documents/storage";
import { clearReleaseCache, highestReleasedVersion, highestVersionEver } from "./releases-service";
import { isNewer, normalizeNotes, parseVersion } from "./releases-logic";
import { trackerReleaseBuilds, trackerReleases } from "./schema";
import { createReleaseSchema, releaseIdSchema } from "./validators";

// HR Admin and Super Admin: write a release's notes, publish it, withdraw it. Builds arrive from CI (pnpm tracker:build).
// A published release is frozen by a database trigger; only withdrawing it is possible afterwards.

const refresh = () => {
  clearReleaseCache();
  revalidatePath("/tracker/download");
  revalidatePath("/settings/tracker/releases");
};

export async function createRelease(input: unknown): Promise<ActionResult<{ id: string }>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "tracker.manage_releases");
    const parsed = createReleaseSchema.safeParse(input);
    if (!parsed.success) return fail("Check the version and the notes.");
    const { version, added, improved, fixed, minRequired, addsCollection, policyVersionId } = parsed.data;
    if (!parseVersion(version)) return fail("Use a version like 1.2.0 (three numbers separated by dots).");
    const notes = normalizeNotes({ added, improved, fixed });
    if (!notes.ok) return fail(notes.error);
    const top = await highestVersionEver();
    if (top && !isNewer(version, top)) return fail(`Use a version higher than ${top}. A version number is never reused.`);
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(trackerReleases)
        .values({
          version,
          notesAdded: notes.notes.added,
          notesImproved: notes.notes.improved,
          notesFixed: notes.notes.fixed,
          minRequired,
          addsCollection,
          policyVersionId: addsCollection ? policyVersionId : null,
          createdBy: actor.id,
        })
        .returning({ id: trackerReleases.id });
      await writeAudit({ actor, action: "tracker.release_created", targetType: "tracker_release", targetId: row.id, metadata: { version } }, tx);
      return row.id;
    });
    refresh();
    return { ok: true, data: { id } };
  });
}

export async function publishRelease(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "tracker.manage_releases");
    const parsed = releaseIdSchema.safeParse(input);
    if (!parsed.success) return fail("Choose a release.");
    const [release] = await db.select().from(trackerReleases).where(eq(trackerReleases.id, parsed.data.id)).limit(1);
    if (!release) return fail("That release was not found.");
    if (release.status !== "draft") return fail("Only a draft can be published.");

    const builds = await db.select({ platform: trackerReleaseBuilds.platform, kind: trackerReleaseBuilds.kind }).from(trackerReleaseBuilds).where(eq(trackerReleaseBuilds.releaseId, release.id));
    const installers = new Set(builds.filter((b) => b.kind === "installer").map((b) => b.platform));
    const updates = new Set(builds.filter((b) => b.kind === "update").map((b) => b.platform));
    if (installers.size === 0) return fail("This release has no installer yet. Add builds with pnpm tracker:build first.");
    const missing = [...installers].filter((p) => !updates.has(p));
    if (missing.length > 0) return fail(`Add the update file and its signature for ${missing.join(", ")}: every platform with an installer needs one.`);

    if (release.addsCollection) {
      if (!release.policyVersionId) return fail("This release adds new data collection. Name the published monitoring policy version that covers it.");
      const [ok] = (await db.execute(sql`
        select 1 as ok from docs.policy_versions v join docs.policies p on p.id = v.policy_id
        where v.id = ${release.policyVersionId} and v.status = 'published' and p.kind = 'monitoring'`)) as unknown as { ok: number }[];
      if (!ok) return fail("The monitoring policy version named for this release is not published.");
    }

    const top = await highestReleasedVersion(release.id);
    if (top && !isNewer(release.version, top)) return fail(`A newer release (${top}) already exists. Create a new release with a higher version.`);

    const done = await db.transaction(async (tx) => {
      const rows = await tx
        .update(trackerReleases)
        .set({ status: "published", publishedBy: actor.id, publishedAt: new Date() })
        .where(and(eq(trackerReleases.id, release.id), eq(trackerReleases.status, "draft")))
        .returning({ id: trackerReleases.id });
      if (rows.length === 0) return false;
      await writeAudit({ actor, action: "tracker.release_published", targetType: "tracker_release", targetId: release.id, metadata: { version: release.version } }, tx);
      return true;
    });
    if (!done) return fail("That release was already published.");
    refresh();
    return { ok: true, data: undefined };
  });
}

export async function withdrawRelease(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "tracker.manage_releases");
    const parsed = releaseIdSchema.safeParse(input);
    if (!parsed.success) return fail("Choose a release.");
    const done = await db.transaction(async (tx) => {
      const rows = await tx
        .update(trackerReleases)
        .set({ status: "withdrawn", withdrawnAt: new Date() })
        .where(and(eq(trackerReleases.id, parsed.data.id), eq(trackerReleases.status, "published")))
        .returning({ id: trackerReleases.id, version: trackerReleases.version });
      if (rows.length === 0) return false;
      await writeAudit({ actor, action: "tracker.release_withdrawn", targetType: "tracker_release", targetId: rows[0].id, metadata: { version: rows[0].version } }, tx);
      return true;
    });
    if (!done) return fail("Only a published release can be withdrawn.");
    refresh();
    return { ok: true, data: undefined };
  });
}

export async function deleteDraftRelease(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "tracker.manage_releases");
    const parsed = releaseIdSchema.safeParse(input);
    if (!parsed.success) return fail("Choose a release.");
    const paths: string[] = [];
    const done = await db.transaction(async (tx) => {
      const [release] = await tx.select({ id: trackerReleases.id, version: trackerReleases.version, status: trackerReleases.status }).from(trackerReleases).where(and(eq(trackerReleases.id, parsed.data.id), ne(trackerReleases.status, "published"), ne(trackerReleases.status, "withdrawn"))).limit(1);
      if (!release) return false;
      const builds = await tx.select({ path: trackerReleaseBuilds.storagePath }).from(trackerReleaseBuilds).where(eq(trackerReleaseBuilds.releaseId, release.id));
      paths.push(...builds.map((b) => b.path));
      await tx.delete(trackerReleaseBuilds).where(eq(trackerReleaseBuilds.releaseId, release.id));
      await tx.delete(trackerReleases).where(eq(trackerReleases.id, release.id));
      await writeAudit({ actor, action: "tracker.release_deleted", targetType: "tracker_release", targetId: release.id, metadata: { version: release.version } }, tx);
      return true;
    });
    if (!done) return fail("Only a draft can be deleted.");
    // The files of a deleted draft are removed best-effort; an orphan file is harmless (private bucket, never linked).
    if (paths.length > 0) await getDocumentStorage().remove(BUCKETS.trackerBuilds, paths).catch(() => undefined);
    refresh();
    return { ok: true, data: undefined };
  });
}
