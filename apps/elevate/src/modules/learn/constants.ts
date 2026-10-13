/** The HIPAA course: the one the nightly jobs assign first and the Training page reports by default. */
export const HIPAA_SLUG = "hipaa";
export const CYBERSECURITY_SLUG = "cybersecurity";

export type LearnCourseInfo = {
  slug: string;
  /** Short name for tabs and lists. */
  label: string;
  /** How notices name it: "Your HIPAA training is due today". */
  noun: string;
  /** A course with only one track always uses it (Cybersecurity basics has a single "full" track, so renewals repeat the course). */
  fixedTrack: "full" | null;
};

/** Every course ELEVATE assigns, reports and reminds about. Add a course here and in apps/learn/src/content/index.ts. */
export const LEARN_COURSES: readonly LearnCourseInfo[] = [
  { slug: HIPAA_SLUG, label: "HIPAA", noun: "HIPAA training", fixedTrack: null },
  { slug: CYBERSECURITY_SLUG, label: "Cybersecurity basics", noun: "Cybersecurity basics training", fixedTrack: "full" },
];

export const LEARN_COURSE_SLUGS = LEARN_COURSES.map((c) => c.slug) as [string, ...string[]];

/** The settings for a course; an unknown slug falls back to the HIPAA course. */
export const courseInfo = (slug: string | null | undefined): LearnCourseInfo => LEARN_COURSES.find((c) => c.slug === slug) ?? LEARN_COURSES[0];
