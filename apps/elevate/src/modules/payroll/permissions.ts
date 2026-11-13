import { definePermissions } from "@/lib/roles";

// Matrix rows: payroll. No role grants any of these, not even Super Admin: access comes only from the person's payroll level
// (core.users.payroll_access), chosen by a Super Admin. Source of truth: docs/superpowers/specs/2026-11-04-payroll-design.md section 8.
// `payroll.view_own` is the exception: every role, own payslips only.
export const payrollPermissions = definePermissions({
  "payroll.view": { roles: {}, payrollLevels: ["preparer", "approver", "viewer"] },
  "payroll.view_history": { roles: {}, payrollLevels: ["preparer", "approver", "viewer"] },
  "payroll.prepare": { roles: {}, payrollLevels: ["preparer"] },
  "payroll.manage_rates": { roles: {}, payrollLevels: ["preparer"] },
  // Paying (the Remitly list and marking payments): both working levels (owner decision 2026-11-12). Nobody marks their own payment.
  "payroll.mark_paid": { roles: {}, payrollLevels: ["preparer", "approver"] },
  "payroll.export": { roles: {}, payrollLevels: ["preparer", "approver"] },
  "payroll.approve": { roles: {}, payrollLevels: ["approver"] },
  // Releasing a run's contractor payment statements to the people on it (owner decisions 2026-11-12): a Preparer or an Approver, once the run is approved.
  "payroll.release_statements": { roles: {}, payrollLevels: ["preparer", "approver"] },
  // Marking a run as a test run, archiving it and restoring it: both levels that work on runs (never a viewer).
  "payroll.manage_test_runs": { roles: {}, payrollLevels: ["preparer", "approver"] },
  // Deleting archived test runs (and archived cancelled runs) for good: the same two working levels. Real approved or paid runs can never be deleted.
  "payroll.purge_archived": { roles: {}, payrollLevels: ["preparer", "approver"] },
  "payroll.view_own": {
    roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" },
  },
});
