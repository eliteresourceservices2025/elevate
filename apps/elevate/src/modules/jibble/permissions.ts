import { definePermissions } from "@/lib/roles";

// The Jibble link (screenshots only): connection, people matching and the send log are HR's.
export const jibblePermissions = definePermissions({
  "jibble.manage": { roles: { super_admin: "all", hr_admin: "all" } },
});
