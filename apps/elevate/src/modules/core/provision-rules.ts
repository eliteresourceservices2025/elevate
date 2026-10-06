/**
 * Whether a signed-in account needs the set-up step (`provisionCoreUser`) now. It runs on every request, so it must be a plain read
 * for everyone already set up.
 *
 * The set-up step promotes a listed (`SUPER_ADMIN_EMAILS`) person to Super Admin only while NO Super Admin exists. So for a second or
 * third listed person, who signs up after the first one was promoted, running it again changes nothing: it must not run, or
 * every page and every prefetch for that person would open a transaction on the same rows and queue behind each other.
 */
export function needsProvisioning(input: { exists: boolean; hasBaseRole: boolean; listed: boolean; isSuperAdmin: boolean; anySuperAdmin: boolean }): boolean {
  if (!input.exists || !input.hasBaseRole) return true;
  return input.listed && !input.isSuperAdmin && !input.anySuperAdmin;
}
