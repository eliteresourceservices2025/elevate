import { definePermissions } from "@/lib/roles";

// Organization (A2). Matrix row "View people directory and org chart": everyone, all.
// Structure and reporting lines are HR's (HR Admin and Super Admin).
export const orgPermissions = definePermissions({
  "org.view_chart": {
    roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" },
  },
  "org.manage_structure": { roles: { super_admin: "all", hr_admin: "all" } },
  "org.manage_reporting": { roles: { super_admin: "all", hr_admin: "all" } },
});
