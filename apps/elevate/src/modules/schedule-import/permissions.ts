import { definePermissions } from "@/lib/roles";

// Importing schedules and client assignments from an attendance sheet. HR and Super Admin only: the sheet names people and their clients.
export const scheduleImportPermissions = definePermissions({
  "scheduleimport.manage": { roles: { super_admin: "all", hr_admin: "all" } },
});
