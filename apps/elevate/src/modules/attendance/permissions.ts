import { definePermissions } from "@/lib/roles";

// Matrix row: attendance and schedules. Executive sees summaries only.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const attendancePermissions = definePermissions({
  "attendance.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  "attendance.view_summary": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", executive: "all" } },
});
