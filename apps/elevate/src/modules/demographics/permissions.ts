import { definePermissions } from "@/lib/roles";

// Voluntary self-identification. Nobody reads another person's gender or religion: the person sees their own, HR sees
// combined counts of 5 or more. Pronouns are shown to everyone who can see the directory.
export const demographicsPermissions = definePermissions({
  "demographics.view_pronouns": { roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" } },
  "demographics.view_own": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "demographics.edit_own": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "demographics.view_summary": { roles: { super_admin: "all", hr_admin: "all" } },
});
