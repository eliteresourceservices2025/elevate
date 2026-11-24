import { definePermissions } from "@/lib/roles";

// Matrix rows: directory, full profile, sensitive fields, edit profile (+ the actions Phase 1.1 needs).
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
// Team scope needs the reporting lines from Phase 1.2; until then team access is denied (fails closed).
export const peoplePermissions = definePermissions({
  "people.view_directory": {
    roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" },
  },
  // The People list and the name search (owner decision 2026-11-24): everyone above the contractor/VA role. A VA keeps their own profile.
  "people.browse_directory": { roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all" } },
  // A profile photo: everyone sets and removes their own; HR and Super Admin can also remove anyone's.
  "people.manage_photo": { roles: { super_admin: "all", hr_admin: "all", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "people.view_profile": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  // Employees see their own values masked; decrypting any value is audited.
  "people.view_sensitive": { roles: { super_admin: "all", hr_admin: "all", employee: "own" } },
  "people.edit_profile": { roles: { super_admin: "all", hr_admin: "all" } },
  "people.request_contact_change": { roles: { employee: "own" } }, // HR approves
  "people.create": { roles: { super_admin: "all", hr_admin: "all" } },
  /** Merge two records of the same person and re-link a sign-in account to the right record (HR and Super Admin). */
  "people.merge": { roles: { super_admin: "all", hr_admin: "all" } },
  "people.archive": { roles: { super_admin: "all", hr_admin: "all" } },
  "people.edit_sensitive": { roles: { super_admin: "all", hr_admin: "all" } },
  "people.approve_change": { roles: { super_admin: "all", hr_admin: "all" } },
  // Client names are confidential: HR sees all, a person sees their own, leads see their team (Phase 1.2).
  "people.view_client_assignments": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  "people.manage_assignments": { roles: { super_admin: "all", hr_admin: "all" } },
  "people.manage_clients": { roles: { super_admin: "all", hr_admin: "all" } },
  "people.manage_custom_fields": { roles: { super_admin: "all", hr_admin: "all" } },
  // The retention settings and the legal hold on a person's record (HR and Super Admin only).
  "people.manage_retention": { roles: { super_admin: "all", hr_admin: "all" } },
  // Show or hide your own birthday (month and day) on colleagues' dashboards. Everyone with a people record, only for themselves.
  "people.set_birthday_visibility": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "people.view_history": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
});
