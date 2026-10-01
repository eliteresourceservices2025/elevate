import { definePermissions } from "@/lib/roles";

// Matrix row: recruiting (ATS). Team leads reach only the openings they are on the hiring team for: their scope is "team", and
// the resource's chain is that opening's hiring team. Executives get counts only (recruiting.summary). Recruiters see ATS data only.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const recruitingPermissions = definePermissions({
  "recruiting.view": { roles: { super_admin: "all", hr_admin: "all", recruiter: "all", team_lead: "team" } },
  "recruiting.summary": { roles: { super_admin: "all", hr_admin: "all", recruiter: "all", team_lead: "team", executive: "all" } },
  "recruiting.manage_openings": { roles: { super_admin: "all", hr_admin: "all", recruiter: "all" } },
  "recruiting.move": { roles: { super_admin: "all", hr_admin: "all", recruiter: "all" } },
  "recruiting.interview": { roles: { super_admin: "all", hr_admin: "all", recruiter: "all" } },
  "recruiting.scorecard": { roles: { super_admin: "own", hr_admin: "own", recruiter: "own", team_lead: "own" } },
  "recruiting.download_resume": { roles: { super_admin: "all", hr_admin: "all", recruiter: "all", team_lead: "team" } },
  "recruiting.manage_retention": { roles: { super_admin: "all", hr_admin: "all" } },
});
