import type { PayrollLevel } from "@/lib/roles";

// Every payroll label lives here so a wording change from counsel is one edit. Copy says "extra hours", never "overtime".

export const PAY_ITEM_TYPES = [
  "absence_days",
  "late_minutes",
  "partial_days",
  "partial_minutes",
  "extra_regular",
  "extra_holiday",
  "extra_rest_day",
  "extra_rest_day_over_8",
  "holiday",
  "peso_allowance",
  "dollar_allowance",
  "adjustment",
  "loan",
  "other_deduction",
  "client_hours",
] as const;
export type PayItemType = (typeof PAY_ITEM_TYPES)[number];

export const PAY_ITEM_LABELS: Record<PayItemType, string> = {
  absence_days: "Absent days",
  late_minutes: "Late and undertime minutes",
  partial_days: "Days worked (partial cutoff)",
  partial_minutes: "Hours worked (partial cutoff)",
  extra_regular: "Extra hours, regular day",
  extra_holiday: "Extra hours, holiday",
  extra_rest_day: "Extra hours, rest day",
  extra_rest_day_over_8: "Extra hours, rest day past 8 hours",
  holiday: "Holiday pay",
  peso_allowance: "Allowance or fee (pesos)",
  dollar_allowance: "Allowance (dollars)",
  adjustment: "Reimbursement, bonus or adjustment",
  loan: "Loan",
  other_deduction: "Other deduction",
  client_hours: "Client hours (reference only)",
};

export const RUN_STATUSES = ["draft", "in_review", "approved", "paid"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const PAYROLL_LEVEL_LABELS: Record<PayrollLevel, string> = {
  preparer: "Preparer",
  approver: "Approver",
  viewer: "Viewer",
};

export const CHANGE_ACTIONS = [
  "access_changed",
  "line_created",
  "line_updated",
  "line_ended",
  "settings_changed",
  "run_created",
  "usd_rate_changed",
  "item_saved",
  "item_dismissed",
  "suggestions_refreshed",
  "suggestion_confirmed",
  "line_confirmed",
  "run_submitted",
  "run_sent_back",
  "run_approved",
  "run_paid",
  "payment_marked",
  "list_exported",
  "payslip_downloaded",
  "run_viewed",
] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];
