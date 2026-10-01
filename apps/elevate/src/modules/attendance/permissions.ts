import { definePermissions } from "@/lib/roles";

// Matrix row: attendance and schedules. Executive sees summaries only.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const attendancePermissions = definePermissions({
  "attendance.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  // The clock and its settings are the person's own; corrections are approved by the lead (HR when nobody is above).
  "attendance.clock": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
  },
  "attendance.request_correction": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
  },
  "attendance.set_preferences": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
  },
  "attendance.approve_correction": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  // A lead files for their downline, HR for anyone; the person is told and someone else decides.
  "attendance.file_for_others": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  // End-of-day notes: written by the person, read by their chain of leads and HR.
  "attendance.notes": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "attendance.notes_view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  // Schedules: HR sets them; leads see their team's, everyone sees their own.
  "schedules.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  "schedules.manage": { roles: { super_admin: "all", hr_admin: "all" } },
  "attendance.manage_rules": { roles: { super_admin: "all", hr_admin: "all" } },
  "attendance.view_summary": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", executive: "all" } },
});
