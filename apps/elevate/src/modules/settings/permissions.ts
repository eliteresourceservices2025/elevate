import { definePermissions } from "@/lib/roles";

// Matrix row: settings, roles, audit log. Invitations: HR Admin and Super Admin (owner decision, 2026-09-30).
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const settingsPermissions = definePermissions({
  "settings.manage_roles": { roles: { super_admin: "all" } },
  "settings.set_safevoice_handler": { roles: { super_admin: "all" } },
  "settings.reset_mfa": { roles: { super_admin: "all" } },
  "settings.deactivate_account": { roles: { super_admin: "all" } },
  "settings.view_audit": { roles: { super_admin: "all" } },
  "settings.manage_policies": { roles: { super_admin: "all", hr_admin: "all" } },
  "invitations.create": { roles: { super_admin: "all", hr_admin: "all" } },
});
