import { definePermissions } from "@/lib/roles";

// Matrix row: Safe Voice. Case access needs the handler flag; no role grants it. Executive sees counts only.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const safevoicePermissions = definePermissions({
  "safevoice.handle": { roles: {  }, requiresFlag: "safevoice_handler", flagScope: "all" },
  "safevoice.view_counts": { roles: { executive: "all" } },
});
