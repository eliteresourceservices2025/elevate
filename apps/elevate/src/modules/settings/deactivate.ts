/**
 * Pure rules for switching a sign-in account off (and back on), separate from the database so they can be tested.
 *
 * This is for accounts that are NOT a working team member: a test account, a mistaken invitation, someone who never joined. A person
 * with an active people record is ended through Offboarding, which also ends their schedule, leave and equipment.
 */
export type DeactivationPlan = { ok: true } | { ok: false; error: string };

export function planDeactivation(input: {
  actorId: string;
  targetId: string;
  alreadyDeactivated: boolean;
  isSuperAdmin: boolean;
  /** Other Super Admins whose accounts are still active. */
  otherActiveSuperAdmins: number;
  /** The status of the person's people record, or null when they have none (or it is archived). */
  profileStatus: string | null;
}): DeactivationPlan {
  if (input.actorId === input.targetId) return { ok: false, error: "You cannot deactivate your own account." };
  if (input.alreadyDeactivated) return { ok: false, error: "That account is already deactivated." };
  if (input.isSuperAdmin && input.otherActiveSuperAdmins < 1) return { ok: false, error: "There must always be at least one active Super Admin." };
  if (input.profileStatus !== null && input.profileStatus !== "separated") {
    return { ok: false, error: "This account belongs to a person on the team. End their engagement with Offboarding instead." };
  }
  return { ok: true };
}

export function planReactivation(input: { alreadyDeactivated: boolean }): DeactivationPlan {
  return input.alreadyDeactivated ? { ok: true } : { ok: false, error: "That account is not deactivated." };
}
