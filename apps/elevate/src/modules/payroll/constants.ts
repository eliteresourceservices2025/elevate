import type { PayrollLevel } from "@/lib/roles";
import type { ExtraKey } from "./calculate";

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

export const PAYMENT_METHODS = ["remitly"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  remitly: "Remitly",
};

/** The five extra-time rates in `SettingsSnapshot.multipliersBp`, mapped to the pay item whose label names them (ruling R3). */
export const EXTRA_KEY_ITEM: Record<ExtraKey, PayItemType> = {
  regular: "extra_regular",
  holiday: "extra_holiday",
  restDay: "extra_rest_day",
  restDayOver8: "extra_rest_day_over_8",
  holidayPay: "holiday",
};

/** The matching field name in the settings form and `savePaySettingsSchema`. */
export const EXTRA_KEY_FORM: Record<ExtraKey, "extraRegular" | "extraHoliday" | "extraRestDay" | "extraRestDayOver8" | "holiday"> = {
  regular: "extraRegular",
  holiday: "extraHoliday",
  restDay: "extraRestDay",
  restDayOver8: "extraRestDayOver8",
  holidayPay: "holiday",
};

/** Column and field labels of the Rates tab. */
export const RATES_LABELS = {
  person: "Person",
  client: "Client",
  clientShort: "Client",
  alias: "Alias",
  aliasShort: "Alias",
  hoursPerDay: "Hours per day",
  fte: "FTE",
  monthly: "Monthly rate (pesos)",
  paymentMethod: "Payment method",
  startsOn: "Starts on",
  starts: "Starts",
  lastDay: "Last day",
  reason: "Reason",
  reasonForChange: "Reason for the change",
} as const;

/** Labels of the Settings tab (the five rates take theirs from PAY_ITEM_LABELS). */
export const SETTINGS_LABELS = {
  startsOn: "Starts on",
  divisor: "Cutoff divisor",
  warn: "Warn when net pay changes by more than (percent)",
  warnShort: "Warn at",
  ratesLegend: "Rates, as a percent of the normal hourly rate",
  reasonOptional: "Reason (optional)",
  changeButton: "Change settings",
  changeTitle: "Change pay settings",
  noneTitle: "No settings in force",
  noneDescription: "No version of the pay settings is dated today or earlier. A Preparer adds one.",
} as const;

export const RUN_STATUSES =["draft", "in_review", "approved", "paid"] as const;
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

export const PAY_ITEM_STATES = ["suggested", "confirmed", "dismissed"] as const;
export type PayItemState = (typeof PAY_ITEM_STATES)[number];
