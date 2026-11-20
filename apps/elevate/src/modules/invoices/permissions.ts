import { definePermissions } from "@/lib/roles";

// Matrix rows: client invoices. HR Admin, Executive and Super Admin only, whatever payroll level a person holds. Invoices carry hours and
// US dollars billed to a client, never a person's pay.
export const invoicesPermissions = definePermissions({
  "invoices.view": { roles: { super_admin: "all", hr_admin: "all", executive: "all" } },
  "invoices.create": { roles: { super_admin: "all", hr_admin: "all", executive: "all" } },
  "invoices.manage_rates": { roles: { super_admin: "all", hr_admin: "all", executive: "all" } },
  // Archive a test invoice, restore it, void a real one (owner decision 2026-11-12). Making a corrected version is `invoices.create`.
  "invoices.manage": { roles: { super_admin: "all", hr_admin: "all", executive: "all" } },
  // Deleting invoices for good from the list: void and replaced ones (real too, already retired with a reason) and archived test ones. Never a live invoice.
  "invoices.delete": { roles: { super_admin: "all", hr_admin: "all", executive: "all" } },
});
