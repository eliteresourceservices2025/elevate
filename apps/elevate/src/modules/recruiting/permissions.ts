import { definePermissions } from "@/lib/roles";

// Matrix row: recruiting (ATS). DEFERRED to Phase 3.1: team lead 'assigned openings' and executive 'summary' grant nothing until defined.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const recruitingPermissions = definePermissions({
  "recruiting.view": { roles: { super_admin: "all", hr_admin: "all", recruiter: "all" } },
});
