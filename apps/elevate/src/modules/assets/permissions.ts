import { definePermissions } from "@/lib/roles";

// Matrix row: assets.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const assetsPermissions = definePermissions({
  "assets.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
});
