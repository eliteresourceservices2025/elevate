import { definePermissions } from "@/lib/roles";

// Help center: everyone may open it. Which articles a person sees is decided by the article's own audience (see audience.ts);
// the articles are files in the repo, so there is nothing to edit in the app.
export const helpPermissions = definePermissions({
  "help.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" } },
});
