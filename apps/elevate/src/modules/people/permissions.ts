import { definePermissions } from "@/lib/roles";

// Matrix rows: directory, full profile, sensitive fields, edit profile.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const peoplePermissions = definePermissions({
  "people.view_directory": { roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" } },
  "people.view_profile": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  "people.view_sensitive": { roles: { super_admin: "all", hr_admin: "all", employee: "own" } },
  "people.edit_profile": { roles: { super_admin: "all", hr_admin: "all" } },
  "people.request_contact_change": { roles: { employee: "own" } },
});
