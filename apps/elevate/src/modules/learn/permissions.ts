import { definePermissions } from "@/lib/roles";

// Matrix rows: ELEVATE Learn (HIPAA training). Opening Learn is for everyone; what a person does inside Learn is decided there
// from their own assignments. Training STATUS (passed, not yet, overdue) is visible to HR for everyone and to a lead for their team;
// SCORES and attempts are HR's (and the person's own, inside Learn). Source of truth: docs/learn/02-architecture.md.
export const learnPermissions = definePermissions({
  "learn.launch": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "learn.view_status": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  "learn.view_results": { roles: { super_admin: "all", hr_admin: "all" } },
  "learn.assign": { roles: { super_admin: "all", hr_admin: "all" } },
  "learn.grant_retry": { roles: { super_admin: "all", hr_admin: "all" } },
  "learn.export_evidence": { roles: { super_admin: "all", hr_admin: "all" } },
});
