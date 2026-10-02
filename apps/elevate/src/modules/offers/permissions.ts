import { definePermissions } from "@/lib/roles";

// Offers and hiring (3.3). HR and Super Admin keep the templates and do the hiring (creating a person record and an account invitation
// is a people-data action). Recruiters make offers for the applicants they handle. A team lead on a job's hiring team can see its offers.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const offersPermissions = definePermissions({
  "offers.manage_templates": { roles: { super_admin: "all", hr_admin: "all" } },
  "offers.make": { roles: { super_admin: "all", hr_admin: "all", recruiter: "all" } },
  "offers.hire": { roles: { super_admin: "all", hr_admin: "all" } },
  "offers.view": { roles: { super_admin: "all", hr_admin: "all", recruiter: "all", team_lead: "team" } },
});
