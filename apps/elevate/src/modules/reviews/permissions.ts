import { definePermissions } from "@/lib/roles";

// Matrix row: performance reviews. DEFERRED to Phase 4.1: executive 'summary' grants nothing until defined.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const reviewsPermissions = definePermissions({
  "reviews.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
});
