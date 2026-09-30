import { definePermissions } from "@/lib/roles";

// Matrix row: approve time off. Team lead is first level, HR is final.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const timeoffPermissions = definePermissions({
  "timeoff.approve": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  "timeoff.approve_final": { roles: { super_admin: "all", hr_admin: "all" } },
});
