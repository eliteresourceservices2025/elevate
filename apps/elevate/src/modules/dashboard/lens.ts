import type { RoleSlug } from "@/lib/roles";

/**
 * A "view" is only a way to choose which dashboard widgets come first. It never changes what anyone may see or do:
 * every widget still asks the owning module (which already combines all of a person's roles, widest scope wins).
 */
export const LENSES = ["admin", "hr", "executive", "team_lead", "recruiter", "my_work"] as const;
export type Lens = (typeof LENSES)[number];

export const LENS_LABELS: Record<Lens, string> = {
  admin: "Admin",
  hr: "HR",
  executive: "Executive",
  team_lead: "My team",
  recruiter: "Hiring",
  my_work: "My work",
};

const ROLE_LENS: Partial<Record<RoleSlug, Lens>> = {
  super_admin: "admin",
  hr_admin: "hr",
  executive: "executive",
  team_lead: "team_lead",
  recruiter: "recruiter",
};

/** The views a person holds, in the order they are offered. "My work" is always last and always there. */
export function availableLenses(roles: readonly RoleSlug[]): Lens[] {
  const held = new Set<Lens>(["my_work"]);
  for (const role of roles) {
    // eslint-disable-next-line security/detect-object-injection -- `role` is a RoleSlug
    const lens = ROLE_LENS[role];
    if (lens) held.add(lens);
  }
  return LENSES.filter((l) => held.has(l));
}

/** The first view a person holds that is not "My work", or "My work" when that is all they have. */
export function defaultLens(roles: readonly RoleSlug[]): Lens {
  return availableLenses(roles)[0];
}

export function isLens(value: unknown): value is Lens {
  return typeof value === "string" && (LENSES as readonly string[]).includes(value);
}

/** The view to show: the one asked for (address, then saved choice) if the person holds it, else their default. */
export function pickLens(roles: readonly RoleSlug[], ...asked: unknown[]): Lens {
  const held = availableLenses(roles);
  for (const a of asked) if (isLens(a) && held.includes(a)) return a;
  return defaultLens(roles);
}

export const LENS_COOKIE = "elevate_view";
