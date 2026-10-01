import { definePermissions } from "@/lib/roles";

// ELEVATE Sign (C4). HR and Super Admin create, send, void and see every envelope. Everyone sees and signs only their own signer row.
// Source of truth: docs/architecture-plan.md, "E-signatures".
const EVERYONE = { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } as const;

export const signingPermissions = definePermissions({
  "signing.manage": { roles: { super_admin: "all", hr_admin: "all" } },
  "signing.view_own": { roles: EVERYONE },
  "signing.sign": { roles: EVERYONE },
});
