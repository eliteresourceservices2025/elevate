// The Help center's categories, in the order they are shown. An article's `category` must be one of these slugs.
export const HELP_CATEGORIES = [
  { slug: "getting-started", title: "Getting started", description: "Sign in, find your way around and get help." },
  { slug: "people", title: "People and invitations", description: "Invite people, set roles and keep profiles up to date." },
  { slug: "onboarding", title: "Onboarding and offboarding", description: "Bring new people in and close out people who leave." },
  { slug: "recruiting", title: "Recruiting and hiring", description: "Job ads, applications, interviews and offers." },
  { slug: "attendance", title: "Time and attendance", description: "The time clock, hours review, corrections and extra hours." },
  { slug: "time-off", title: "Time off and schedules", description: "Prize days off, requests and shift schedules." },
  { slug: "documents", title: "Documents and signing", description: "Files, folders, policies and ELEVATE Sign." },
  { slug: "reports", title: "Reports and analytics", description: "Headcount, attendance and hiring numbers." },
  { slug: "settings", title: "Settings and support", description: "Roles and access, support requests and privacy incident reports." },
] as const;

export type HelpCategorySlug = (typeof HELP_CATEGORIES)[number]["slug"];

export const HELP_CATEGORY_SLUGS = HELP_CATEGORIES.map((c) => c.slug) as [HelpCategorySlug, ...HelpCategorySlug[]];

export function helpCategory(slug: string) {
  return HELP_CATEGORIES.find((c) => c.slug === slug) ?? null;
}
