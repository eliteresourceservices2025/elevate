import { definePermissions } from "@/lib/roles";

// Matrix rows: payroll. No role grants any of these, not even Super Admin: access comes only from the person's payroll level
// (core.users.payroll_access), chosen by a Super Admin. Source of truth: docs/superpowers/specs/2026-11-04-payroll-design.md section 8.
// `payroll.view_own` is the exception: every role, own payslips only.
export const payrollPermissions = definePermissions({
  "payroll.view": { roles: {}, payrollLevels: ["preparer", "approver", "viewer"] },
  "payroll.view_history": { roles: {}, payrollLevels: ["preparer", "approver", "viewer"] },
  "payroll.prepare": { roles: {}, payrollLevels: ["preparer"] },
  "payroll.manage_rates": { roles: {}, payrollLevels: ["preparer"] },
  "payroll.mark_paid": { roles: {}, payrollLevels: ["preparer"] },
  "payroll.export": { roles: {}, payrollLevels: ["preparer"] },
  "payroll.approve": { roles: {}, payrollLevels: ["approver"] },
  "payroll.view_own": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
  },
});
