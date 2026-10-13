import { sql, type SQL } from "drizzle-orm";
import { CORE_COURSES, HIPAA_SLUG, type LearnCourseInfo } from "./constants";

// Which courses exist. The core courses (HIPAA, Cybersecurity) are listed in code because their lessons are; a client add-on is a
// row in `learn.courses` with kind 'client_addon' and its client. Everything that loops over "every course" reads this list, so a
// new add-on shows up in the assignment job, reminders, Training status and the dashboard counts without a code change.

type Executor = { execute: (query: SQL) => PromiseLike<unknown> };

type AddonRow = { slug: string; title: string; label: string | null; noun: string | null; fixed_track: string | null; client_id: string | null };

const FIXED: ReadonlySet<string> = new Set(["full", "essentials", "refresher"]);

function fromRow(r: AddonRow): LearnCourseInfo {
  return {
    slug: r.slug,
    label: r.label?.trim() || r.title,
    noun: r.noun?.trim() || `${r.title} training`,
    fixedTrack: r.fixed_track && FIXED.has(r.fixed_track) ? (r.fixed_track as LearnCourseInfo["fixedTrack"]) : null,
    kind: "client_addon",
    clientId: r.client_id,
  };
}

/**
 * Every course that is assigned and reported: the core courses first, then client add-ons by name. Archived add-ons are left out
 * unless `includeArchived` (an old assignment still needs its course's name).
 */
export async function listLearnCourses(exec: Executor, options: { includeArchived?: boolean } = {}): Promise<LearnCourseInfo[]> {
  const rows = (await exec.execute(sql`
    select slug, title, label, noun, fixed_track, client_id::text as client_id
    from learn.courses
    where kind = 'client_addon' ${options.includeArchived ? sql`` : sql`and archived_at is null`}
    order by lower(coalesce(label, title)), slug`)) as unknown as AddonRow[];
  const coreSlugs = new Set(CORE_COURSES.map((c) => c.slug));
  return [...CORE_COURSES, ...rows.filter((r) => !coreSlugs.has(r.slug)).map(fromRow)];
}

/** One course by address, or null when there is none. */
export async function findLearnCourse(exec: Executor, slug: string | null | undefined, options: { includeArchived?: boolean } = {}): Promise<LearnCourseInfo | null> {
  if (!slug) return null;
  const core = CORE_COURSES.find((c) => c.slug === slug);
  if (core) return core;
  return (await listLearnCourses(exec, options)).find((c) => c.slug === slug) ?? null;
}

/** The course to show for a possibly missing or unknown address: an unknown one falls back to HIPAA, as the pages always did. */
export const pickCourse = (catalog: readonly LearnCourseInfo[], slug: string | null | undefined): LearnCourseInfo =>
  catalog.find((c) => c.slug === slug) ?? catalog.find((c) => c.slug === HIPAA_SLUG) ?? catalog[0];

/** A course looked up by address for wording in a notice; never null, so an old add-on that was archived still has a name. */
export async function describeCourse(exec: Executor, slug: string): Promise<LearnCourseInfo> {
  const found = await findLearnCourse(exec, slug, { includeArchived: true });
  return found ?? { slug, label: "Training", noun: "training", fixedTrack: null, kind: "core", clientId: null };
}
