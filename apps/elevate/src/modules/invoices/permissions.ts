import { definePermissions } from "@/lib/roles";

// Matrix rows: client invoices. HR Admin, Executive and Super Admin only, whatever payroll level a person holds. Invoices carry hours and
// US dollars billed to a client, never a person's pay.
export const invoicesPermissions = definePermissions({
  "invoices.view": { roles: { super_admin: "all", hr_admin: "all", executive: "all" } },
  "invoices.create": { roles: { super_admin: "all", hr_admin: "all", executive: "all" } },
  "invoices.manage_rates": { roles: { super_admin: "all", hr_admin: "all", executive: "all" } },
});
