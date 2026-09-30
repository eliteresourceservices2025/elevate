import { BASE_ROLE, ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

export type RoleChangePlan =
  | { ok: true; finalRoles: RoleSlug[]; added: RoleSlug[]; removed: RoleSlug[] }
  | { ok: false; error: string };

/**
 * Pure rules for changing someone's roles, separate from the database so they can be tested.
 * - You cannot change your own roles (no self-promotion, no accidental lock-out).
 * - Everyone keeps the base Employee role.
 * - The last Super Admin cannot be demoted.
 */
export function planRoleChange(input: {
  actorId: string;
  targetId: string;
  currentRoles: readonly RoleSlug[];
  requestedRoles: readonly RoleSlug[];
  superAdminCount: number;
}): RoleChangePlan {
  const { actorId, targetId, currentRoles, requestedRoles, superAdminCount } = input;

  if (actorId === targetId) return { ok: false, error: "You cannot change your own roles." };

  const wanted = new Set<RoleSlug>([...requestedRoles, BASE_ROLE]);
  const finalRoles = ROLE_SLUGS.filter((r) => wanted.has(r));
  const current = new Set(currentRoles);

  const added = finalRoles.filter((r) => !current.has(r));
  const removed = ROLE_SLUGS.filter((r) => current.has(r) && !wanted.has(r));

  if (added.length === 0 && removed.length === 0) return { ok: false, error: "Those roles are already assigned." };

  if (removed.includes("super_admin") && superAdminCount <= 1) {
    return { ok: false, error: "There must always be at least one Super Admin." };
  }

  return { ok: true, finalRoles, added, removed };
}
