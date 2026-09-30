import { definePermissions } from "@/lib/roles";

// Everyone reads and clears their own notifications, and only their own.
export const notificationsPermissions = definePermissions({
  "notifications.read": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
  },
});
