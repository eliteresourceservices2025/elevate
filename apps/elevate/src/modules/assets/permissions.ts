import { definePermissions } from "@/lib/roles";

// Matrix row: assets. HR and Super Admin manage everything; a team lead sees what is assigned to their downline (view only);
// an employee sees what is assigned to them. Recruiters and executives get nothing.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const assetsPermissions = definePermissions({
  "assets.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  "assets.manage": { roles: { super_admin: "all", hr_admin: "all" } },
  "assets.assign": { roles: { super_admin: "all", hr_admin: "all" } },
});
