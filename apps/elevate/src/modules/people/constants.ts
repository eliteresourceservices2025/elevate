// Pure constants shared by the schema, validators and UI (safe to import in client components).

export const EMPLOYEE_STATUSES = ["onboarding", "active", "probation", "on_leave", "separated"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
export const STATUS_LABELS: Record<EmployeeStatus, string> = {
  onboarding: "Onboarding",
  active: "Active",
  probation: "Probation",
  on_leave: "On leave",
  separated: "Separated",
};

// Typed EmployeeStatus keys only.
export const statusLabel = (status: EmployeeStatus): string => STATUS_LABELS[status]; // eslint-disable-line security/detect-object-injection

export const CIVIL_STATUSES = ["single", "married", "widowed", "separated", "other"] as const;
export type CivilStatus = (typeof CIVIL_STATUSES)[number];

// ERS engages its people as 1099 contractors today; kept as data so it can change later.
export const WORKER_TYPES = ["contractor", "employee"] as const;
export type WorkerType = (typeof WORKER_TYPES)[number];

/** Encrypted columns in core.employee_sensitive. The key is also part of the encryption context. */
export const SENSITIVE_FIELDS = [
  "tin",
  "sss",
  "philhealth",
  "pagibig",
  "bankName",
  "bankAccountName",
  "bankAccountNumber",
  "payRate",
] as const;
export type SensitiveField = (typeof SENSITIVE_FIELDS)[number];

export const SENSITIVE_LABELS: Record<SensitiveField, string> = {
  tin: "TIN",
  sss: "SSS number",
  philhealth: "PhilHealth number",
  pagibig: "Pag-IBIG number",
  bankName: "Bank name",
  bankAccountName: "Account name",
  bankAccountNumber: "Account number",
  payRate: "Pay rate",
};

export const CHANGE_CATEGORIES = ["contact", "emergency_contacts", "bank", "data_rights"] as const;
export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];
export const CHANGE_CATEGORY_LABELS: Record<ChangeCategory, string> = {
  contact: "Contact details",
  emergency_contacts: "Emergency contacts",
  bank: "Bank details",
  data_rights: "Data rights request",
};

/** What a person can ask about their data (Data Privacy Act rights). HR handles these; nothing is deleted automatically. */
export const DATA_RIGHTS_KINDS = ["correction", "deletion", "other"] as const;
export type DataRightsKind = (typeof DATA_RIGHTS_KINDS)[number];
export const DATA_RIGHTS_LABELS: Record<DataRightsKind, string> = {
  correction: "Correct my data",
  deletion: "Delete my data",
  other: "Something else about my data",
};

export const CHANGE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export const HISTORY_EVENTS = [
  "hired",
  "profile_changed",
  "position_changed",
  "status_changed",
  "manager_changed",
  "team_changed",
  "worker_type_changed",
  "client_assigned",
  "client_ended",
  "sensitive_changed",
  "archived",
  "restored",
] as const;
export type HistoryEvent = (typeof HISTORY_EVENTS)[number];

export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "select"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export const CUSTOM_FIELD_VISIBILITY = ["hr_only", "employee_visible"] as const;
export type CustomFieldVisibility = (typeof CUSTOM_FIELD_VISIBILITY)[number];
