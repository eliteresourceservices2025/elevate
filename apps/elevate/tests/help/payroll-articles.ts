/**
 * The guides whose pictures are taken by capture-payroll.spec.ts, not by capture.spec.ts: payroll needs its own accounts and a whole
 * pay run made through the real screens, and it must never touch the accounts the other pictures use.
 */
export const PAYROLL_ARTICLES = ["how-payroll-works", "prepare-a-pay-run", "approve-a-pay-run", "read-your-payslip"] as const;
