import { definePermissions } from "@/lib/roles";

// System health (job check-ins, the Jibble queue, clock activity): HR and Super Admin only.
export const healthPermissions = definePermissions({
  "health.view": { roles: { super_admin: "all", hr_admin: "all" } },
});
