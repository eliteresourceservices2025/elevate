import { definePermissions } from "@/lib/roles";

// Announcements and policies. Everyone reads what was addressed to them and acknowledges for themselves;
// HR posts, publishes and sees everyone's status; a Team Lead sees the status of their own downline.
export const announcementsPermissions = definePermissions({
  "announcements.view": {
    roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" },
  },
  "announcements.manage": { roles: { super_admin: "all", hr_admin: "all" } },
  "announcements.acknowledge": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
  },
  "announcements.view_status": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  "announcements.remind": { roles: { super_admin: "all", hr_admin: "all" } },
  "announcements.export": { roles: { super_admin: "all", hr_admin: "all" } },
});
