import { definePermissions } from "@/lib/roles";

// Matrix rows: privacy incident reports. Everyone may report and follow their own; HR, Super Admin and the designated Privacy Officer
// (a per-person flag) read and handle all of them. Designating the Privacy Officer is HR and Super Admin.
// Source of truth: docs/learn/02-architecture.md ("ELEVATE-side modules").
export const incidentsPermissions = definePermissions({
  "incidents.report": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "incidents.handle": { roles: { super_admin: "all", hr_admin: "all" }, alsoFlag: { privacy_officer: "all" } },
  "incidents.designate": { roles: { super_admin: "all", hr_admin: "all" } },
});
