import { announcementsPermissions } from "@/modules/announcements/permissions";
import { analyticsPermissions } from "@/modules/analytics/permissions";
import { assetsPermissions } from "@/modules/assets/permissions";
import { attendancePermissions } from "@/modules/attendance/permissions";
import { documentsPermissions } from "@/modules/documents/permissions";
import { healthPermissions } from "@/modules/health/permissions";
import { jibblePermissions } from "@/modules/jibble/permissions";
import { notificationsPermissions } from "@/modules/notifications/permissions";
import { onboardingPermissions } from "@/modules/onboarding/permissions";
import { orgPermissions } from "@/modules/org/permissions";
import { privacyPermissions } from "@/modules/privacy/permissions";
import { peoplePermissions } from "@/modules/people/permissions";
import { recruitingPermissions } from "@/modules/recruiting/permissions";
import { reviewsPermissions } from "@/modules/reviews/permissions";
import { safevoicePermissions } from "@/modules/safevoice/permissions";
import { settingsPermissions } from "@/modules/settings/permissions";
import { timeoffPermissions } from "@/modules/timeoff/permissions";
import type { PermissionRule, RoleSlug, Scope } from "./roles";

// Pure module: no server-only imports, so the authz tests can run it directly.

export const PERMISSIONS = {
  ...peoplePermissions,
  ...orgPermissions,
  ...documentsPermissions,
  ...announcementsPermissions,
  ...notificationsPermissions,
  ...privacyPermissions,
  ...timeoffPermissions,
  ...attendancePermissions,
  ...jibblePermissions,
  ...healthPermissions,
  ...recruitingPermissions,
  ...onboardingPermissions,
  ...reviewsPermissions,
  ...safevoicePermissions,
  ...assetsPermissions,
  ...analyticsPermissions,
  ...settingsPermissions,
} as const;

export type ActionName = keyof typeof PERMISSIONS;

export type AuthzUser = {
  id: string;
  roles: readonly RoleSlug[];
  isSafevoiceHandler?: boolean;
};

/**
 * The record being acted on. `team` scope needs `managerChainUserIds` (the target's
 * reporting chain, resolved by the owning module once the org chart exists in Phase 1.2);
 * without it, team access is denied.
 */
export type Resource = {
  ownerUserId?: string;
  managerChainUserIds?: readonly string[];
};

export class ForbiddenError extends Error {
  constructor(public readonly action: string) {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

const rank = (scope: Scope) => (scope === "all" ? 3 : scope === "team" ? 2 : 1);

// Keys are typed action names from PERMISSIONS, so the lookup below cannot be attacker-controlled.
function ruleFor(action: ActionName): PermissionRule {
  // eslint-disable-next-line security/detect-object-injection
  return PERMISSIONS[action] as PermissionRule;
}

/** Every scope the user holds for this action, widest first. Empty means no access. */
function grantedScopes(user: AuthzUser, rule: PermissionRule): Scope[] {
  const scopes: Scope[] = [];

  if (rule.requiresFlag === "safevoice_handler") {
    if (user.isSafevoiceHandler && rule.flagScope) scopes.push(rule.flagScope);
    return scopes;
  }

  for (const role of user.roles) {
    // eslint-disable-next-line security/detect-object-injection -- `role` is a RoleSlug
    const scope = rule.roles[role];
    if (scope) scopes.push(scope);
  }
  return scopes.sort((a, b) => rank(b) - rank(a));
}

/** The widest scope the user holds for an action, or null. Use it to filter list queries. */
export function scopeFor(user: AuthzUser, action: ActionName): Scope | null {
  return grantedScopes(user, ruleFor(action))[0] ?? null;
}

/** True if the user may perform the action on this resource. Fails closed. */
export function can(user: AuthzUser, action: ActionName, resource?: Resource): boolean {
  const scopes = grantedScopes(user, ruleFor(action));

  return scopes.some((scope) => {
    if (scope === "all") return true;
    if (!resource) return false;
    if (scope === "own") return resource.ownerUserId !== undefined && resource.ownerUserId === user.id;
    return Boolean(resource.managerChainUserIds?.includes(user.id));
  });
}

/** Throws ForbiddenError unless the user may perform the action. Call in every action and query. */
export async function authorize(user: AuthzUser, action: ActionName, resource?: Resource): Promise<void> {
  if (!can(user, action, resource)) throw new ForbiddenError(action);
}
