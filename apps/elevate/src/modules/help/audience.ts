import type { PayrollLevel, RoleSlug } from "@/lib/roles";

/**
 * "all" means every signed-in person (everyone holds the Employee role, so listing it is the same). Otherwise the article is for
 * people who hold at least one of the listed roles, or (when `payroll` is set, written "payroll" in the header) anyone a Super Admin
 * gave a payroll level (Preparer, Approver or Viewer). The payroll level is not a role, so it needs its own word.
 */
export type HelpAudience = "all" | { readonly roles: readonly RoleSlug[]; readonly payroll: boolean };

/** Who is reading: their roles and their payroll level, if any. A signed-in user (`requireUser()`) fits. */
export type HelpViewer = { readonly roles: readonly RoleSlug[]; readonly payrollAccess?: PayrollLevel | null };

export function canSeeHelpArticle(viewer: HelpViewer, audience: HelpAudience): boolean {
  if (audience === "all") return true;
  if (audience.payroll && viewer.payrollAccess) return true;
  return audience.roles.some((role) => viewer.roles.includes(role));
}
