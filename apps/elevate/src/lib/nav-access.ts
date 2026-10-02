import { scopeFor, type ActionName, type AuthzUser } from "@/lib/authz";
import { ALL_NAV_ITEMS } from "@/lib/nav";

/** The addresses of menu items this person does not get (an item with no `access` rule is for everyone). Used by the sidebar and the dashboard cards. */
export function hiddenNavFor(user: AuthzUser): string[] {
  return ALL_NAV_ITEMS.filter((i) => {
    if (!i.access) return false;
    const rules = Array.isArray(i.access) ? i.access : [i.access];
    return !rules.some((rule) => {
      const scope = scopeFor(user, rule.action as ActionName);
      return scope !== null && rule.scopes.includes(scope);
    });
  }).map((i) => i.href);
}
