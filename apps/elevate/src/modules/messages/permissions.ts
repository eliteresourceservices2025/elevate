import { definePermissions } from "@/lib/roles";

// Everyone who signs in may chat in conversations they are a member of; membership is checked on every read and write,
// so a permission here never opens someone else's conversation. A client guest has no role at all: they get only this one action, through the `guest` flag.
// Owner decision 2026-11-17: only HR Admins and Super Admins create, rename, change the people of, and delete group chats.
// Managing a group never lets them read it: they read a chat only as a member, or through an approved access request (Phase 6).
export const messagesPermissions = definePermissions({
  "messages.use": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
    // A client guest: Messages only, and only their own conversations (membership is still checked on every read and write).
    alsoFlag: { guest: "own" },
  },
  // Owner decision 2026-11-17: HR Admin and Super Admin invite client guests and make client groups; Team Leads may later (counsel/owner).
  "messages.invite_guests": { roles: { super_admin: "all", hr_admin: "all" } },
  "messages.create_group": { roles: { super_admin: "all", hr_admin: "all" } },
  "messages.manage_group": { roles: { super_admin: "all", hr_admin: "all" } },
});
