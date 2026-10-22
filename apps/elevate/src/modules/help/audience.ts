import type { RoleSlug } from "@/lib/roles";

/**
 * "all" means every signed-in person (everyone holds the Employee role, so listing it is the same). Otherwise the article is for
 * people who hold at least one of the listed roles.
 */
export type HelpAudience = "all" | readonly RoleSlug[];

export function canSeeHelpArticle(roles: readonly RoleSlug[], audience: HelpAudience): boolean {
  if (audience === "all") return true;
  return audience.some((role) => roles.includes(role));
}
