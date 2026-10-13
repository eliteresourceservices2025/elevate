import { definePermissions } from "@/lib/roles";

// Matrix row: opening ELEVATE Learn (HIPAA training). Every signed-in person may; what they can do inside Learn is decided there,
// from their own assignments. Source of truth: docs/learn/02-architecture.md.
export const learnPermissions = definePermissions({
  "learn.launch": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
});
