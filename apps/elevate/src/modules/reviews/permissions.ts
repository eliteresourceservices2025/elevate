import { definePermissions } from "@/lib/roles";

// Matrix rows: performance reviews and goals (Phase 4.1). HR sees and runs everything; a team lead their downline's reviews and goals;
// the Executive only counts and averages (reviews.summary); everyone else their own. The person reads their lead's part and the final
// rating only after HR shares it. Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
const EVERYONE_OWN = { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } as const;

export const reviewsPermissions = definePermissions({
  "reviews.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  "reviews.summary": { roles: { super_admin: "all", hr_admin: "all", executive: "all" } },
  "reviews.manage_templates": { roles: { super_admin: "all", hr_admin: "all" } },
  "reviews.manage_cycles": { roles: { super_admin: "all", hr_admin: "all" } },
  "reviews.write_self": { roles: EVERYONE_OWN },
  "reviews.write_lead": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team" } },
  "reviews.calibrate": { roles: { super_admin: "all", hr_admin: "all" } },
  "reviews.share": { roles: { super_admin: "all", hr_admin: "all" } },
  "reviews.acknowledge": { roles: EVERYONE_OWN },
  "goals.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  "goals.manage": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
});
