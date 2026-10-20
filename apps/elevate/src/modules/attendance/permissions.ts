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
  // Change someone's recorded time (remove a wrongly recorded event, add the right ones). HR and Super Admin apply it at once, for anyone
  // but themselves; a Team Lead's change for their team is a proposal that HR or Super Admin approves.
  "attendance.edit_hours": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  // A technical issue report (the clock or Jibble not working, an outage): the person's own; leads and HR handle them.
  "attendance.report_issue": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
  },
  "attendance.handle_issue": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
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
  // Extra hours: anyone asks for their own; a lead (team) or HR (anyone) files one the client asked for and decides the VA's.
  "extra_hours.request": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "extra_hours.file_for_others": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  "extra_hours.decide": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  // Hours: a lead (their team) or HR approves each person's week; HR exports approved hours per pay period.
  "hours.approve": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  // Mark a day as "test only" (kept, but left out of review, export and the unapproved counts). Same reach as approving.
  "hours.mark_test": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  "hours.export": { roles: { super_admin: "all", hr_admin: "all" } },
  "attendance.manage_rules": { roles: { super_admin: "all", hr_admin: "all" } },
  "attendance.view_summary": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", executive: "all" } },
});
