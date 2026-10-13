import "server-only";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { diffLoaded, lintLoaded, listStudioCourses, loadVersion, type LoadedVersion, type StudioCourse } from "./studio-service";
import type { CourseDiff } from "./studio-diff";
import type { LintIssue } from "./studio-lint";

// What the studio pages read. The exam answer key is included (editors need it), which is why every query authorizes
// `learn.manage_content` first: it never reaches the Learn app or anyone without that permission.

export async function getStudioCourses(): Promise<StudioCourse[]> {
  const user = await requireUser();
  await authorize(user, "learn.manage_content");
  return listStudioCourses(db);
}

export async function getStudioVersion(slug: string, version: number): Promise<{ loaded: LoadedVersion; lint: LintIssue[]; viewerId: string; unchangedVsLive: boolean | null } | null> {
  const user = await requireUser();
  await authorize(user, "learn.manage_content");
  if (!Number.isInteger(version) || version < 1) return null;
  const loaded = await loadVersion(db, slug, version);
  if (!loaded) return null;
  // For a draft: does it differ from the live version (null when nothing is live yet)?
  let unchangedVsLive: boolean | null = null;
  if (loaded.version.status === "draft") {
    const live = (await listStudioCourses(db)).find((c) => c.slug === slug)?.versions.find((v) => v.status === "published");
    const base = live ? await loadVersion(db, slug, live.version) : null;
    if (base) unchangedVsLive = diffLoaded(base, loaded).unchanged;
  }
  return { loaded, lint: lintLoaded(loaded), viewerId: user.id, unchangedVsLive };
}

export async function getStudioDiff(slug: string, from: number, to: number): Promise<{ from: LoadedVersion; to: LoadedVersion; diff: CourseDiff } | null> {
  const user = await requireUser();
  await authorize(user, "learn.manage_content");
  const [a, b] = [await loadVersion(db, slug, from), await loadVersion(db, slug, to)];
  if (!a || !b) return null;
  return { from: a, to: b, diff: diffLoaded(a, b) };
}
