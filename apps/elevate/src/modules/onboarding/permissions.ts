import { definePermissions } from "@/lib/roles";

// Matrix rows: onboarding and offboarding. Recruiter "hand-off only" is still deferred: it grants nothing beyond the hire itself.
// A person always sees their own checklist; a team lead sees and acts on their downline's (for the tasks that are theirs); HR sees all.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
const OWN = { recruiter: "own", executive: "own", employee: "own" } as const;

export const onboardingPermissions = definePermissions({
  "onboarding.manage": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  "onboarding.view_own_tasks": { roles: { employee: "own" } },
  "onboarding.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", ...OWN } },
  "onboarding.manage_templates": { roles: { super_admin: "all", hr_admin: "all" } },
  "offboarding.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", ...OWN } },
  "offboarding.manage": { roles: { super_admin: "all", hr_admin: "all" } },
  "offboarding.exit_interview": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "certificates.issue": { roles: { super_admin: "all", hr_admin: "all" } },
});
