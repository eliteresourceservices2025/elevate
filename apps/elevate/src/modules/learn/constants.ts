/** The HIPAA course: the one the nightly jobs assign first and the Training page reports by default. */
export const HIPAA_SLUG = "hipaa";
export const CYBERSECURITY_SLUG = "cybersecurity";
export const CUSTOMER_SERVICE_SLUG = "customer-service";

export type LearnCourseInfo = {
  slug: string;
  /** Short name for tabs and lists. */
  label: string;
  /** How notices name it: "Your HIPAA training is due today". */
  noun: string;
  /** A course with only one track always uses it (Cybersecurity basics has a single "full" track, so renewals repeat the course). */
  fixedTrack: "full" | "essentials" | "refresher" | null;
  /** `core`: for everyone, written in code. `client_addon`: extra training for the people assigned to one client (a database row). */
  kind: "core" | "client_addon";
  /** The client an add-on belongs to. */
  clientId: string | null;
};

/**
 * The core courses ELEVATE assigns, reports and reminds about. Their lessons live in code (apps/learn/src/content/index.ts), so
 * they are listed here; client add-ons are rows in `learn.courses` and come from `listLearnCourses` (course-catalog.ts).
 */
export const CORE_COURSES: readonly LearnCourseInfo[] = [
  { slug: HIPAA_SLUG, label: "HIPAA", noun: "HIPAA training", fixedTrack: null, kind: "core", clientId: null },
  { slug: CYBERSECURITY_SLUG, label: "Cybersecurity basics", noun: "Cybersecurity basics training", fixedTrack: "full", kind: "core", clientId: null },
  { slug: CUSTOMER_SERVICE_SLUG, label: "Customer service", noun: "Customer service certification", fixedTrack: "full", kind: "core", clientId: null },
];

/** A course address: lower case words joined by dashes (the same rule the database enforces). */
export const COURSE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
