import { definePermissions } from "@/lib/roles";

// Matrix row "Documents": Super Admin all, HR Admin all, Employee own; nobody else.
// Company documents (policies, forms) are readable by all staff unless marked HR only.
// Source of truth: docs/architecture-plan.md, "Users, roles and permissions".
export const documentsPermissions = definePermissions({
  "documents.view": { roles: { super_admin: "all", hr_admin: "all", employee: "own" } },
  "documents.upload": { roles: { super_admin: "all", hr_admin: "all", employee: "own" } },
  // Verifying is HR's. Nobody verifies a document on their own record (enforced in the action).
  "documents.verify": { roles: { super_admin: "all", hr_admin: "all" } },
  // A person may archive their own file only while it is unverified (enforced in the action).
  "documents.archive": { roles: { super_admin: "all", hr_admin: "all", employee: "own" } },
  "documents.manage_types": { roles: { super_admin: "all", hr_admin: "all" } },
  "documents.view_overview": { roles: { super_admin: "all", hr_admin: "all" } },
  "documents.view_company": {
    roles: { super_admin: "all", hr_admin: "all", team_lead: "all", recruiter: "all", executive: "all", employee: "all" },
  },
  "documents.manage_company": { roles: { super_admin: "all", hr_admin: "all" } },
});
