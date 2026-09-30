import { definePermissions } from "@/lib/roles";

// Matrix row: people analytics. Recruiter sees hiring only.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const analyticsPermissions = definePermissions({
  "analytics.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", executive: "all" } },
  "analytics.view_hiring": { roles: { super_admin: "all", hr_admin: "all", recruiter: "all", executive: "all" } },
});
