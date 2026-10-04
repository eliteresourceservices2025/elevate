import { definePermissions } from "@/lib/roles";

// Importing people from TalentHR (Phase 5). HR and Super Admin only: the files hold personal data and pay rates.
export const importsPermissions = definePermissions({
  "imports.manage": { roles: { super_admin: "all", hr_admin: "all" } },
});
