import { definePermissions } from "@/lib/roles";

// Time off is prize days awarded by HR (ERS engages 1099 contractors: no accrual). Employees see their own
// balance, a Team Lead sees their downline's, HR sees everyone and does the awarding.
// Approval rows (level 1 team lead, level 2 HR) are used from Phase 2.2.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const timeoffPermissions = definePermissions({
  "timeoff.approve": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  "timeoff.approve_final": { roles: { super_admin: "all", hr_admin: "all" } },
  // Requests: anyone asks for their own days off; HR can file for someone (including a past date).
  "timeoff.request": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
  },
  "timeoff.file_for_others": { roles: { super_admin: "all", hr_admin: "all" } },
  // A person cancels their own; HR can cancel anyone's (including leave already taken).
  "timeoff.cancel": { roles: { super_admin: "all", hr_admin: "all", employee: "own" } },
  "timeoff.view_requests": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  // Everyone may open the calendar; what it shows is narrowed in the query (own team, downline, everyone, or counts only).
  "timeoff.view_calendar": {
    roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" },
  },
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
