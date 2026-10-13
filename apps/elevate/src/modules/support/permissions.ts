import { definePermissions } from "@/lib/roles";

// Matrix row: contact support. Everyone may ask for help; HR and Super Admin read and close the requests.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const supportPermissions = definePermissions({
  "support.create": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "support.manage": { roles: { super_admin: "all", hr_admin: "all" } },
});
