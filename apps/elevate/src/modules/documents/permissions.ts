import { definePermissions } from "@/lib/roles";

// Matrix row: documents.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const documentsPermissions = definePermissions({
  "documents.manage": { roles: { super_admin: "all", hr_admin: "all", employee: "own" } },
});
