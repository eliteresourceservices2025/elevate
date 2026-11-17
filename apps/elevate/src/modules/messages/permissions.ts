import { definePermissions } from "@/lib/roles";

// Everyone who signs in may chat in conversations they are a member of; membership is checked on every read and write,
// so a permission here never opens someone else's conversation. Guests (clients) arrive in a later phase as their own role.
export const messagesPermissions = definePermissions({
  "messages.use": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
  },
  "messages.create_group": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
  },
});
