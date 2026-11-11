import type { PayrollLevel } from "@/lib/roles";
import type { ExtraKey } from "./calculate";

// Every payroll label lives here so a wording change from counsel is one edit. Payroll copy says "overtime (OT)" (the executives' and
// HR's choice); the schedules and extra-hours request screens keep their own wording. The statement of pay is the "Contractor Payment Statement".

export const PAY_ITEM_TYPES = [
  "absence_days",
  "sick_leave_days",
  "bereavement_days",
  "pto_days",
  "late_minutes",
  "partial_days",
  "partial_minutes",
  "extra_regular",
  "extra_rest_day",
  "extra_rest_day_over_8",
  "holiday",
  "allowance",
  "reimbursement",
  "bonus",
  "adjustment",
  "loan",
  "other_deduction",
  "client_hours",
] as const;
export type PayItemType = (typeof PAY_ITEM_TYPES)[number];

export const PAY_ITEM_LABELS: Record<PayItemType, string> = {
  absence_days: "Absent days",
  sick_leave_days: "Sick leave (SL) days, unpaid",
  bereavement_days: "Bereavement days, paid",
  pto_days: "PTO days, paid",
  late_minutes: "Late and undertime minutes",
  partial_days: "Days worked (partial cutoff)",
  partial_minutes: "Hours worked (partial cutoff)",
  extra_regular: "Overtime (OT), regular day",
  extra_rest_day: "Overtime (OT), rest day",
  extra_rest_day_over_8: "Overtime (OT), rest day past 8 hours",
  holiday: "Holiday pay",
  allowance: "Allowance",
  reimbursement: "Reimbursement",
  bonus: "Bonus",
  adjustment: "Adjustment",
  loan: "Loan",
  other_deduction: "Other deduction",
  client_hours: "Client hours (reference only)",
};

export const PAYMENT_METHODS = ["remitly"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  remitly: "Remitly",
};

/** The overtime rates and holiday pay in `SettingsSnapshot.multipliersBp`, mapped to the pay item whose label names them (ruling R3). */
export const EXTRA_KEY_ITEM: Record<ExtraKey, PayItemType> = {
  regular: "extra_regular",
  restDay: "extra_rest_day",
  restDayOver8: "extra_rest_day_over_8",
  holiday: "holiday",
};

/** The overtime rates that are settings (holiday pay is always one to one), and their field names in the settings form. */
export const OT_SETTING_KEYS = ["regular", "restDay", "restDayOver8"] as const;
export const EXTRA_KEY_FORM: Record<(typeof OT_SETTING_KEYS)[number], "extraRegular" | "extraRestDay" | "extraRestDayOver8"> = {
  regular: "extraRegular",
  restDay: "extraRestDay",
  restDayOver8: "extraRestDayOver8",
};

/** Item types a Preparer itemizes: any number of named lines, each with a name and an amount. */
export const ITEMIZED_TYPES = ["allowance", "reimbursement", "bonus", "adjustment"] as const;
export type ItemizedType = (typeof ITEMIZED_TYPES)[number];
/** Names offered while typing an itemized line. Only suggestions: any plain name up to 60 characters works. */
export const ITEM_NAME_SUGGESTIONS: Record<ItemizedType, readonly string[]> = {
  allowance: ["Health allowance", "Transportation allowance", "Internet allowance", "Hazard fee"],
  reimbursement: ["Supplies", "Transportation", "Medical"],
  bonus: ["Performance bonus", "Holiday bonus", "Referral bonus"],
  adjustment: ["Correction of an earlier payment", "Other adjustment"],
};
export const isItemized = (type: string): type is ItemizedType => (ITEMIZED_TYPES as readonly string[]).includes(type);

/** Column and field labels of the Rates tab. */
export const RATES_LABELS = {
  person: "Person",
  client: "Client",
  clientShort: "Client",
  alias: "Alias",
  aliasShort: "Alias",
  hoursPerDay: "Hours per day",
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
  warn: "Warn when total payable compensation changes by more than (percent)",
  warnShort: "Warn at",
  ratesLegend: "Overtime (OT) rates, as a percent of the normal hourly rate. Holiday pay is always 100% (one to one).",
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
  "signatory_changed",
  "run_people_synced",
  "run_line_removed",
  "run_line_restored",
  "timesheet_imported",
  "suggestions_confirmed_all",
] as const;
export type ChangeAction = (typeof CHANGE_ACTIONS)[number];

export const CHANGE_ACTION_LABELS: Record<ChangeAction, string> = {
  access_changed: "Payroll access changed",
  line_created: "Pay line added",
  line_updated: "Pay line changed",
  line_ended: "Pay line ended",
  settings_changed: "Pay settings changed",
  run_created: "Pay run created",
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
  payslip_downloaded: "Contractor payment statement downloaded",
  run_viewed: "Run opened",
  run_cancelled: "Run cancelled",
  signatory_changed: "Payslip signatory changed",
  run_people_synced: "Run updated from the Rates tab",
  run_line_removed: "Person taken off the run",
  run_line_restored: "Person put back on the run",
  timesheet_imported: "Run filled from a Jibble timesheet",
  suggestions_confirmed_all: "All suggested amounts confirmed",
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
  yes: "Yes",
  period: "Pay period",
  settingsFrom: "Settings start on",
  removed: "Removed",
  suggestedSuffix: "(suggested)",
  assigned: "Assigned to a pay line",
  suggestedAmount: "Suggested",
  amountChanged: "Typed a different amount",
  amountAsSuggested: "Confirmed as suggested",
  amountKind: "Amount",
  peopleAdded: "People added",
  peopleUpdated: "Lines moved to a newer rate",
  peopleRemoved: "People taken off",
  membersMatched: "Members filled",
  suggestionsWritten: "Suggestions written",
  keptAsTyped: "Left as already confirmed",
  confirmedCount: "Amounts confirmed",
  signatoryName: "Signatory name",
  signatoryTitle: "Signatory title",
  signatoryPicture: "Signature picture",
  onFile: "On file",
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
  groups: { person: "Person", basis: "Pay basis", deductions: "Absences and late", extra: "Overtime (OT) and holiday", leave: "Paid leave", allowances: "Allowances and gross", additions: "Reimbursements, bonuses and adjustments", loans: "Loan and other deductions", result: "Result", reference: "Reference only" },
  person: "Person",
  client: "Client",
  hoursPerDay: "Hours per day",
  monthly: "Monthly rate",
  base: "Cutoff pay",
  absences: "Absences",
  sickLeave: "Sick leave (SL)",
  bereavement: "Bereavement (paid)",
  pto: "PTO (paid)",
  late: "Late and undertime",
  allowances: "Allowances",
  reimbursements: "Reimbursements",
  bonuses: "Bonuses",
  adjustments: "Adjustments",
  loan: "Loan",
  otherDeductions: "Other deduction",
  gross: "Gross",
  net: "Total payable compensation",
  clientHours: "Client hours",
  confirmation: "Checked by",
  actions: "Actions",
  unconfirmed: "Not yet",
  unreadable: "Can't be read",
  totals: "Totals",
  byClient: "By client",
  period: "Period",
  status: "Status",
  lines: "Lines",
  newRun: "New run",
  noClient: "No client",
  netChange: "Change in total payable from last run",
  grossTotal: "Gross (pesos)",
  netTotal: "Total payable compensation (pesos)",
  corrects: "Corrects the run of",
  hasCorrection: "Includes a correction of an earlier run",
} as const;

/** Item types that may name the earlier run they correct: an adjustment adds pay, an other deduction takes back an overpayment. */
export const CORRECTION_TYPES: readonly PayItemType[] = ["adjustment", "other_deduction"];

/** Wording of paying an approved run: the Remitly list and recording each person's reference. ELEVATE sends no money. */
export const PAYMENT_LABELS = {
  title: "Payment",
  hint: "Download the list, pay each person in Remitly at the rate Remitly shows, then record the Remitly reference here. The list has names and pesos only, never account numbers.",
  download: "Download Remitly list",
  downloaded: (rows: number) => `Downloaded ${rows} ${rows === 1 ? "person" : "people"}.`,
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
 * Wording of the Contractor Payment Statement (the /my-pay page, the PDF and the notice; it was called the payslip). Item names come from
 * PAY_ITEM_LABELS. The notice carries no amount, period or name.
 */
export const PAYSLIP_LABELS = {
  pageTitle: "My payment statements",
  pageDescription: "Your contractor payment statements. One appears here after the pay run it belongs to is paid.",
  emptyTitle: "No statements yet",
  emptyDescription: "A contractor payment statement appears here once the pay run it belongs to is marked paid.",
  period: "Pay period",
  net: "Total payable compensation",
  download: "Download PDF",
  documentTitle: "Contractor Payment Statement",
  number: "Statement number",
  paidOn: "Paid on",
  paidBy: "Paid by",
  earnings: "Pay for the period",
  gross: "Gross pay",
  leaveTitle: "Leave (days)",
  computationTitle: "How your pay was worked out",
  compensationTitle: "Compensation",
  deductionsTitle: "Deductions",
  totalCompensation: "Total compensation",
  totalDeductions: "Total deductions",
  client: "Client",
  hiredOn: "Date of hire",
  monthlyRate: "Monthly rate",
  dailyRate: "Daily rate",
  hourlyRate: "Hourly rate",
  hoursPerDay: "Hours per day",
  allowancesNone: "Allowances",
  reimbursementsNone: "Reimbursements",
  bonusesNone: "Bonuses",
  adjustmentsNone: "Adjustments",
  certificationTitle: "Certification",
  certificationText:
    "This statement reflects payment for services rendered by the contractor during the period indicated above. The contractor acknowledges receipt of the total payable compensation stated herein.",
  preparedBy: "Prepared by",
  certDate: "Date",
  contractorSignature: "Contractor signature (optional)",
  disclaimerTitle: "Disclaimer",
  disclaimerText:
    "This payment is for services rendered as an Independent Contractor and does not constitute an employer-employee relationship. The contractor is responsible for any applicable taxes, registrations, and government contributions required under applicable laws.",
  noTax: "No tax, SSS, PhilHealth, HDMF or other government contribution is withheld or computed on this statement. A dash means nothing for this period.",
  detailColumn: "Details",
  amountColumn: "Amount (pesos)",
  signedBy: "Authorized by",
  signedOn: "Signed on",
  notSigned: "Not signed",
  footerNote: "A statement of pay for the period shown. It is not a tax document.",
  view: "View",
  back: "Back to My payment statements",
  viewAction: (period: string) => `View the contractor payment statement for ${period}`,
  pageHeading: (period: string) => `Contractor Payment Statement ${period}`,
  viewDescription: "Only you can open this page. Download the PDF to keep or print a copy.",
  unreadableView: "This contractor payment statement can't be read right now. Tell the system owner.",
  preparedFor: "Prepared for",
  details: "Pay details",
  lineHeading: (alias: string) => `Line: ${alias}`,
  base: "Base pay for the period",
  total: "Total payable compensation, all lines",
  unreadable: "Can't be read",
  unreadableDownload: "This contractor payment statement can't be read right now. Tell the system owner.",
  footer: "Contractor Payment Statement",
  noticeKind: "payroll.payslip_ready",
  noticeTitle: "Your contractor payment statement is ready",
  noticeBody: "A contractor payment statement is ready for you. Open My payment statements to read it.",
  noticeLink: "/my-pay",
} as const;

/** Wording of the page where a Super Admin sets who signs the contractor payment statements. */
export const SIGNATORY_LABELS = {
  name: "Name",
  title: "Title",
  titleDefault: "Human Resources Director",
  signature: "Signature picture",
  signatureHint: "A clear picture of the signature on a white background. It is made small, kept private and printed above the name on every statement. Nothing is stored about the file itself.",
  choose: "Choose a picture",
  current: "Signature now",
  none: "No signature picture yet. Statements will show the name and title with a line.",
  remove: "Remove the signature picture",
  save: "Save signatory",
  saved: "Signatory saved.",
  unreadable: "The saved signature can't be read. Choose the picture again.",
  fileError: "Choose a JPG, PNG or WEBP picture.",
  notSetYet: "Nobody is set yet. Payments are never held up: a run paid before then shows Not signed on its statements.",
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

/**
 * Only a line that cannot be read stops a run from being sent (there is nothing to approve). Everything else is a note for the Preparer and
 * the Approver to read: the Approver still decides. (Changed 2026-11-12 so the team can push runs through while they test.)
 */
export const BLOCKING_CHECKS = ["unreadable_line"] as const;
export const WARNING_CHECKS = [
  "missing_multiplier",
  "negative_net",
  "partial_exceeds_cutoff",
  "unassigned_suggestion",
  "own_line_unconfirmed",
  "lines_out_of_date",
  "unapproved_days",
  "no_payout_details",
  "new_or_leaving",
  "rate_change_mid_period",
  "pending_suggestions",
  "no_client_hours",
  "large_change",
] as const;
export type CheckCode = (typeof BLOCKING_CHECKS)[number] | (typeof WARNING_CHECKS)[number];

export const CHECK_LABELS: Record<CheckCode, string> = {
  missing_multiplier: "An overtime (OT) rate is not set in the settings",
  negative_net: "Total payable compensation is below zero",
  partial_exceeds_cutoff: "The days or hours worked pay more than a full cutoff. Check the amount entered.",
  unassigned_suggestion: "Suggested amounts are not assigned to a pay line",
  own_line_unconfirmed: "Your own line needs a confirmation from another Preparer",
  unreadable_line: "This line can't be read",
  lines_out_of_date: "The pay lines changed after this run was created. Use Update people to bring the run up to date.",
  unapproved_days: "Some days in the period are not approved",
  no_payout_details: "No payout details on file",
  new_or_leaving: "Starts, ends or has left during this period",
  rate_change_mid_period: "The rate changes during this period",
  pending_suggestions: "Suggested amounts are waiting for a decision",
  no_client_hours: "Has a client but no client payroll hours, so it can't be invoiced. Add them under Actions > Amounts, or import the Jibble timesheet, before sending for review.",
  large_change: "Total payable compensation changed a lot from the last run",
};

export const LINE_FLAG_LABELS: Record<string, string> = {
  rate_change_mid_period: "Rate changes in the period",
  starts_mid_period: "Starts in the period",
  ends_mid_period: "Ends in the period",
  person_left: "Person has left",
};
