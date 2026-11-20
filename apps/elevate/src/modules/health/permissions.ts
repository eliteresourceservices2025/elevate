import { definePermissions } from "@/lib/roles";

// System health (job check-ins, the Jibble queue, clock activity): HR and Super Admin only.
export const healthPermissions = definePermissions({
  "health.view": { roles: { super_admin: "all", hr_admin: "all" } },
  // Only "how many background jobs are late, out of how many" for the executive dashboard tile. Job names, errors and the health page stay HR and Super Admin.
  "health.view_status": { roles: { super_admin: "all", hr_admin: "all", executive: "all" } },
});
