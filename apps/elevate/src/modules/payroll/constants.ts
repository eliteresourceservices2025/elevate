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

export const unreadableNotice = (n: number) =>
  `${n} pay ${n === 1 ? "line" : "lines"} can't be read. This usually means a problem with the encryption key. Tell the system owner before changing any rates.`;

export const UNREADABLE_HINT = "This line can't be read, so it can't be changed from here.";

/** Labels of the Settings tab(the five rates take theirs from PAY_ITEM_LABELS). */
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

export const RUN_STATUSES = ["draft", "in_review", "approved", "paid", "cancelled"] as const;
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
  "run_cancelled",
] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

export const CHANGE_ACTION_LABELS: Record<ChangeAction, string> = {
  access_changed: "Payroll access changed",
  line_created: "Pay line added",
  line_updated: "Pay line changed",
  line_ended: "Pay line ended",
  settings_changed: "Pay settings changed",
  run_created: "Pay run created",
  usd_rate_changed: "Dollar rate changed",
  item_saved: "Amount saved on a line",
  item_dismissed: "Amount removed from a line",
  suggestions_refreshed: "Suggestions updated from approved hours",
  suggestion_confirmed: "Suggested amount confirmed",
  line_confirmed: "Line checked by another Preparer",
  run_submitted: "Run sent for review",
  run_sent_back: "Run sent back",
  run_approved: "Run approved",
  run_paid: "Run fully paid",
  payment_marked: "Payment recorded",
  list_exported: "Remitly list downloaded",
  payslip_downloaded: "Payslip downloaded",
  run_viewed: "Run opened",
  run_cancelled: "Run cancelled",
};

/** Wording of the change history page. Figures and reasons are shown only there, never in the audit log, notices or logs. */
export const HISTORY_LABELS = {
  description: "Every change to rates, settings and pay runs, newest first. Figures and reasons are shown here only; the audit log never has them.",
  filterRun: "Pay run",
  filterPerson: "Person",
  filterActor: "Changed by",
  filterFrom: "From",
  filterTo: "To",
  anyRun: "All runs",
  anyPerson: "Everyone",
  anyActor: "Anyone",
  apply: "Filter",
  clear: "Clear filters",
  when: "When",
  who: "Changed by",
  what: "Change",
  person: "Person",
  run: "Pay run",
  details: "Details",
  field: "Field",
  before: "Before",
  after: "After",
  none: "None",
  notSet: "Not set",
  unreadable: "Can't be read",
  unreadableHint: "The details of this change can't be read. Tell the system owner.",
  emptyTitle: "No changes found",
  emptyDescription: "Nothing matches these filters.",
  noRecord: "Account without a people record",
  runHistory: "Change history for this run",
  // Names of the values a change row shows.
  reason: "Reason",
  note: "Note",
  accessLevel: "Payroll access",
  noAccess: "No access",
  forPerson: "For",
  lines: "Lines",
  warnings: "Warnings",
  people: "People",
  rows: "People on the list",
  items: "Amounts written",
  paidOn: "Paid on",
  correction: "Correction of an earlier payment",
  period: "Pay period",
  settingsFrom: "Settings start on",
  removed: "Removed",
  suggestedSuffix: "(suggested)",
  assigned: "Assigned to a pay line",
  suggestedAmount: "Suggested",
  amountChanged: "Typed a different amount",
  amountAsSuggested: "Confirmed as suggested",
  amountKind: "Amount",
} as const;

export const PAY_ITEM_STATES = ["suggested", "confirmed", "dismissed"] as const;
export type PayItemState = (typeof PAY_ITEM_STATES)[number];

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  paid: "Paid",
  cancelled: "Cancelled",
};

/** Headings and wording of the runs list and the worksheet. */
export const WORKSHEET_LABELS = {
  groups: { person: "Person", basis: "Pay basis", deductions: "Deductions", extra: "Extra hours", allowances: "Allowances", adjustments: "Adjustments", result: "Result", reference: "Reference only" },
  person: "Person",
  client: "Client",
  hoursPerDay: "Hours per day",
  fte: "FTE",
  monthly: "Monthly rate",
  base: "Cutoff pay",
  absences: "Absences",
  late: "Late and undertime",
  pesoAllowance: "Allowance or fee (pesos)",
  dollarAllowance: "Allowance (dollars)",
  dollarAllowancePesos: "Dollar allowance in pesos",
  adjustment: "Reimbursement, bonus or adjustment",
  loan: "Loan",
  otherDeductions: "Other deduction",
  gross: "Gross",
  net: "Net",
  clientHours: "Client hours",
  confirmation: "Checked by",
  actions: "Actions",
  unconfirmed: "Not yet",
  unreadable: "Can't be read",
  totals: "Totals",
  byClient: "By client",
  dollarRate: "Dollar rate",
  noRate: "Not set",
  period: "Period",
  status: "Status",
  lines: "Lines",
  newRun: "New run",
  noClient: "No client",
  netChange: "Change from last run",
  grossTotal: "Gross (pesos)",
  dollarTotal: "Dollar allowances (dollars)",
  dollarPesosTotal: "Dollar allowance in pesos (pesos)",
  netTotal: "Net (pesos)",
  corrects: "Corrects the run of",
  hasCorrection: "Includes a correction of an earlier run",
} as const;

/** Item types that may name the earlier run they correct: an adjustment adds pay, an other deduction takes back an overpayment. */
export const CORRECTION_TYPES: readonly PayItemType[] = ["adjustment", "other_deduction"];

/** Wording of paying an approved run: the Remitly list and recording each person's reference. ELEVATE sends no money. */
export const PAYMENT_LABELS = {
  title: "Payment",
  hint: "Download the list, pay each person in Remitly, then record the Remitly reference here. The list has names, pesos and dollars only, never account numbers.",
  download: "Download Remitly list",
  downloaded: (rows: number) => `Downloaded ${rows} ${rows === 1 ? "person" : "people"}.`,
  noRate: "Set the dollar rate on this run before downloading the list.",
  person: "Person",
  alias: "Alias",
  status: "Status",
  paid: "Paid",
  notPaid: "Not paid yet",
  reference: "Remitly reference",
  paidOn: "Paid on",
  markPaid: "Mark paid",
  markPaidTitle: (name: string) => `Mark paid: ${name}`,
  correct: "Correct",
  correctTitle: (name: string) => `Correct payment: ${name}`,
  actions: "Actions",
  none: "-",
  markedBy: (who: string) => `Marked by ${who}`,
  marked: "Payment recorded.",
  allPaid: "Everyone on this run is paid.",
  ownLine: "Another Preparer records your payment.",
  progress: (paid: number, total: number) => `${paid} of ${total} paid`,
} as const;

/**
 * Wording of the payslip (the /my-pay page, the PDF and the notice). Item names come from PAY_ITEM_LABELS. The notice carries no amount,
 * period or name.
 */
export const PAYSLIP_LABELS = {
  pageTitle: "My pay",
  pageDescription: "Your payslips. One appears here after the pay run it belongs to is paid.",
  emptyTitle: "No payslips yet",
  emptyDescription: "A payslip appears here once the pay run it belongs to is marked paid.",
  period: "Pay period",
  net: "Net pay",
  download: "Download PDF",
  documentTitle: "Payslip",
  preparedFor: "Prepared for",
  details: "Pay details",
  lineHeading: (alias: string) => `Line: ${alias}`,
  base: "Base pay for the period",
  total: "Total net pay",
  dollarRate: "Dollar rate used",
  unreadable: "Can't be read",
  unreadableDownload: "This payslip can't be read right now. Tell the system owner.",
  footer: "Payslip",
  noticeKind: "payroll.payslip_ready",
  noticeTitle: "Your payslip is ready",
  noticeBody: "A payslip is ready for you. Open My pay to read it.",
  noticeLink: "/my-pay",
} as const;

/** Wording of sending a run for review and deciding it. Notices never carry an amount, a name or the note. */
export const APPROVAL_LABELS = {
  submit: "Send for review",
  submitted: "Sent for review. The Approvers have been told.",
  submitBlocked: "Fix the problems above before sending this run for review.",
  approve: "Approve",
  approved: "Run approved.",
  sendBack: "Send back",
  sendBackTitle: "Send this run back to the Preparer",
  sendBackNote: "What needs to change",
  sendBackHint: "Kept in the change history and shown on the run. Never sent in a notice. Don't write client or patient details.",
  sentBack: "Run sent back.",
  sentBackNotice: "This run was sent back",
  inReview: "This run is waiting for approval. It can't be changed while it is in review.",
  approveHint:
    "Approving confirms every line of this run, on every page of the worksheet, as it was when this page loaded. If anything changes before you approve, you'll be asked to reload.",
  approveCount: (n: number) => `${n} ${n === 1 ? "line" : "lines"} in this run`,
  approvedNotice: "This run is approved. It can no longer change; a mistake is corrected with an adjustment on a later run.",
  correctionNone: "Not a correction",
  correctionHint: "Choose the approved run this corrects: an adjustment for an underpayment, an other deduction for an overpayment. A reason is needed.",
} as const;

/** The "own line" check as an Approver or Viewer sees it: it is about the person who sent the run, not about them. */
export const OWN_LINE_OF_SUBMITTER = "The line of the person who sent this run needs a confirmation from another Preparer";

/** Wording of the suggestions from approved hours. */
export const SUGGESTION_LABELS = {
  refresh: "Suggest from approved hours",
  refreshed: "Suggestions updated.",
  confirm: "Confirm",
  confirmed: "Amount confirmed.",
  assign: "Assign to line",
  assigned: "Assigned to the line.",
  assignAndConfirm: "Assign and confirm",
  chooseLine: "Choose a pay line",
  thisLine: "Pay line",
  unassignedTitle: "These suggested amounts need a pay line before the run can be sent for review.",
} as const;

/** Deductions entered by hand need a reason, as does overriding a suggestion. */
export const REASON_REQUIRED_TYPES: readonly PayItemType[] = ["loan", "other_deduction"];

export const BLOCKING_CHECKS = ["missing_usd_rate", "missing_multiplier", "negative_net", "unassigned_suggestion", "own_line_unconfirmed", "unreadable_line", "lines_out_of_date"] as const;
export const WARNING_CHECKS = ["unapproved_days", "no_payout_details", "new_or_leaving", "rate_change_mid_period", "pending_suggestions", "large_change"] as const;
export type CheckCode = (typeof BLOCKING_CHECKS)[number] | (typeof WARNING_CHECKS)[number];

export const CHECK_LABELS: Record<CheckCode, string> = {
  missing_usd_rate: "A dollar allowance needs this run's dollar rate",
  missing_multiplier: "An extra-hours rate is not set in the settings",
  negative_net: "Net pay is below zero",
  unassigned_suggestion: "Suggested amounts are not assigned to a pay line",
  own_line_unconfirmed: "Your own line needs a confirmation from another Preparer",
  unreadable_line: "This line can't be read",
  lines_out_of_date: "The pay lines changed after this run was created. Cancel the run and create it again.",
  unapproved_days: "Some days in the period are not approved",
  no_payout_details: "No payout details on file",
  new_or_leaving: "Starts, ends or has left during this period",
  rate_change_mid_period: "The rate changes during this period",
  pending_suggestions: "Suggested amounts are waiting for a decision",
  large_change: "Net pay changed a lot from the last run",
};

export const LINE_FLAG_LABELS: Record<string, string> = {
  rate_change_mid_period: "Rate changes in the period",
  starts_mid_period: "Starts in the period",
  ends_mid_period: "Ends in the period",
  person_left: "Person has left",
};
