import { definePermissions } from "@/lib/roles";

// Time off is prize days awarded by HR (ERS engages 1099 contractors: no accrual). Employees see their own
// balance, a Team Lead sees their downline's, HR sees everyone and does the awarding.
// Approval rows (level 1 team lead, level 2 HR) are used from Phase 2.2.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const timeoffPermissions = definePermissions({
  "timeoff.approve": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  "timeoff.approve_final": { roles: { super_admin: "all", hr_admin: "all" } },
  "timeoff.view_balance": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  "timeoff.award": { roles: { super_admin: "all", hr_admin: "all" } },
  "timeoff.adjust": { roles: { super_admin: "all", hr_admin: "all" } },
  "timeoff.view_overview": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  "timeoff.manage_types": { roles: { super_admin: "all", hr_admin: "all" } },
  "timeoff.manage_holidays": { roles: { super_admin: "all", hr_admin: "all" } },
  "timeoff.view_holidays": {
    roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" },
  },
});
