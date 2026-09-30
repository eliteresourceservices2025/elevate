import { definePermissions } from "@/lib/roles";

// Matrix row: onboarding/offboarding. DEFERRED to Phase 3.4: recruiter 'hand-off only' grants nothing until defined.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const onboardingPermissions = definePermissions({
  "onboarding.manage": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  "onboarding.view_own_tasks": { roles: { employee: "own" } },
});
