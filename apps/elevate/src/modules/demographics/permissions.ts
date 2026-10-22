import { definePermissions } from "@/lib/roles";

// Voluntary self-identification. Gender, sexual orientation and religion are private to the person (HR sees combined
// counts of 5 or more) unless the person switches "show on my profile" on for that answer; only then does
// demographics.view_shared return it to colleagues. Pronouns are shown to everyone who can see the directory.
export const demographicsPermissions = definePermissions({
  "demographics.view_pronouns": { roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" } },
  "demographics.view_shared": { roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" } },
  "demographics.view_own": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "demographics.edit_own": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "demographics.view_summary": { roles: { super_admin: "all", hr_admin: "all" } },
});
