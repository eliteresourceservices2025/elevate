import { definePermissions } from "@/lib/roles";

// Organization (A2). Matrix row "View people directory and org chart": everyone, all.
// Structure and reporting lines are HR's (HR Admin and Super Admin).
export const orgPermissions = definePermissions({
  "org.view_chart": {
    roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" },
  },
  // The whole chart: everyone above the contractor/VA role. A VA sees only the line above them (top of the organization down to their team lead) and themselves.
  "org.view_full_chart": { roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all" } },
  "org.manage_structure": { roles: { super_admin: "all", hr_admin: "all" } },
  "org.manage_reporting": { roles: { super_admin: "all", hr_admin: "all" } },
});
