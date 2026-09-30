// Keep in sync with the seed rows in drizzle/0003_roles_seed_and_audit_guard.sql.
export const ROLE_SLUGS = [
  "super_admin",
  "hr_admin",
  "team_lead",
  "recruiter",
  "executive",
  "employee",
] as const;

export type RoleSlug = (typeof ROLE_SLUGS)[number];

export const ROLE_LABELS: Record<RoleSlug, string> = {
  super_admin: "Super Admin",
  hr_admin: "HR Admin",
  team_lead: "Team Lead",
  recruiter: "Recruiter",
  executive: "Executive",
  employee: "Employee / VA",
};

/** Everyone who signs in holds this role; it cannot be removed. */
export const BASE_ROLE: RoleSlug = "employee";

export function isRoleSlug(value: string): value is RoleSlug {
  return (ROLE_SLUGS as readonly string[]).includes(value);
}

/** own < team < all. The widest scope a role holds for an action decides. */
export type Scope = "own" | "team" | "all";

export type PermissionRule = {
  /** Scope each role gets. A missing role gets nothing. */
  roles: Partial<Record<RoleSlug, Scope>>;
  /** Extra per-person flag required on top of (or instead of) roles. */
  requiresFlag?: "safevoice_handler";
  /** Flag holders get this scope; roles are ignored when set. */
  flagScope?: Scope;
};

export function definePermissions<T extends Record<string, PermissionRule>>(rules: T): T {
  return rules;
}

// Typed RoleSlug keys only, so the lookup cannot be attacker-controlled.
export function roleLabel(role: RoleSlug): string {
  // eslint-disable-next-line security/detect-object-injection
  return ROLE_LABELS[role];
}
