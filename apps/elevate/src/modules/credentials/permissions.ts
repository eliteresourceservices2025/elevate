import { definePermissions } from "@/lib/roles";

// Matrix row: credentials (certificates and training that expire). HR and Super Admin manage them; a team lead sees their downline's
// (view only); an employee sees their own. Recruiters and executives get nothing.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const credentialsPermissions = definePermissions({
  "credentials.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  "credentials.manage": { roles: { super_admin: "all", hr_admin: "all" } },
});
