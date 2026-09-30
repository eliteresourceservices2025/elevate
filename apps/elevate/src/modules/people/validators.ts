import { z } from "zod";
import { isValidTimeZone } from "@/lib/time";
import {
  CIVIL_STATUSES,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_VISIBILITY,
  EMPLOYEE_STATUSES,
  SENSITIVE_FIELDS,
  WORKER_TYPES,
} from "./constants";
import {
  normalizeBankAccountNumber,
  normalizePagibig,
  normalizePayRate,
  normalizePhilhealth,
  normalizeSss,
  normalizeTin,
} from "./ids";

// One schema per form, reused by the server action (CLAUDE.md rule 5). Empty strings become undefined.

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const text = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());
const requiredText = (label: string, max = 80) =>
  z.string().trim().min(1, `Enter ${label}`).max(max, `Use ${max} characters or fewer`);
const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));
const optionalEmail = z.preprocess(blankToUndefined, email.optional());
const uuid = z.uuid();

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "Enter a real date");
const optionalDate = z.preprocess(blankToUndefined, isoDate.optional());

const birthDate = z.preprocess(
  blankToUndefined,
  isoDate
    .refine((v) => v >= "1930-01-01", "Check the birth year")
    .refine((v) => v <= new Date(Date.now() - 15 * 365.25 * 864e5).toISOString().slice(0, 10), "Check the birth date")
    .optional(),
);

const mobile = z.preprocess(
  blankToUndefined,
  z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number").optional(),
);

const countryCode = z.string().trim().length(2, "Use a 2-letter country code").toUpperCase();
const address = {
  addressLine: text(160),
  city: text(80),
  province: text(80),
  postalCode: text(12),
};

export const employeeFieldsSchema = z.object({
  legalFirstName: requiredText("a first name"),
  legalMiddleName: text(80),
  legalLastName: requiredText("a last name"),
  preferredName: text(80),
  birthDate,
  civilStatus: z.preprocess(blankToUndefined, z.enum(CIVIL_STATUSES).optional()),
  workEmail: email,
  personalEmail: optionalEmail,
  mobile,
  ...address,
  country: z.preprocess(blankToUndefined, countryCode.default("PH")),
  positionId: z.preprocess(blankToUndefined, uuid.optional()),
  status: z.enum(EMPLOYEE_STATUSES).default("onboarding"),
  workerType: z.enum(WORKER_TYPES).default("contractor"),
  startDate: optionalDate,
  endDate: optionalDate,
});

const separatedNeedsEndDate = (v: { status?: string; endDate?: string }) => v.status !== "separated" || Boolean(v.endDate);
const endDateRule = { message: "Enter the last working day for a separated person", path: ["endDate"] };

// Team and manager are optional at creation and go through the dated reporting rules.
export const createEmployeeSchema = employeeFieldsSchema
  .extend({
    teamId: z.preprocess(blankToUndefined, uuid.optional()),
    managerId: z.preprocess(blankToUndefined, uuid.optional()),
  })
  .refine(separatedNeedsEndDate, endDateRule);

export const updateEmployeeSchema = employeeFieldsSchema
  .extend({ employeeId: uuid })
  .refine(separatedNeedsEndDate, endDateRule);

export const archiveEmployeeSchema = z.object({ employeeId: uuid, restore: z.boolean().default(false) });

// --- Sensitive fields -------------------------------------------------------

const idField = (normalize: (v: string) => string | null, message: string) =>
  z
    .union([z.string().trim(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === null || v === "") return v === undefined ? undefined : null;
      const out = normalize(v);
      if (out === null) ctx.addIssue({ code: "custom", message });
      return out ?? z.NEVER;
    });

const plainSensitive = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : v));

/** Values per field; `null` clears a value, a missing key leaves it unchanged. */
export const sensitiveValuesSchema = z.object({
  tin: idField(normalizeTin, "TIN must be 9 or 12 digits"),
  sss: idField(normalizeSss, "SSS number must be 10 digits"),
  philhealth: idField(normalizePhilhealth, "PhilHealth number must be 12 digits"),
  pagibig: idField(normalizePagibig, "Pag-IBIG number must be 12 digits"),
  bankName: plainSensitive(80),
  bankAccountName: plainSensitive(120),
  bankAccountNumber: idField(normalizeBankAccountNumber, "Account number must be 6 to 34 letters or digits"),
  payRate: idField(normalizePayRate, "Enter a pay rate like 25000 or 25000.50"),
});

export const updateSensitiveSchema = z.object({
  employeeId: uuid,
  values: sensitiveValuesSchema.refine((v) => Object.values(v).some((x) => x !== undefined), "Change at least one field"),
});

export const revealSensitiveSchema = z.object({ employeeId: uuid, field: z.enum(SENSITIVE_FIELDS) });

// --- Self-service change requests -------------------------------------------

export const contactChangeSchema = z
  .object({ mobile, personalEmail: optionalEmail, ...address, country: z.preprocess(blankToUndefined, countryCode.optional()) })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Change at least one field");

export const emergencyContactSchema = z.object({
  name: requiredText("a name"),
  relationship: requiredText("the relationship", 40),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Enter a valid phone number"),
  isPrimary: z.boolean().default(false),
});

export const emergencyContactsChangeSchema = z.object({
  contacts: z
    .array(emergencyContactSchema)
    .min(1, "Add at least one contact")
    .max(5, "Five contacts at most")
    .refine((c) => c.filter((x) => x.isPrimary).length === 1, "Choose exactly one primary contact"),
});

export const bankChangeSchema = z.object({
  bankName: requiredText("the bank name"),
  bankAccountName: requiredText("the account name", 120),
  bankAccountNumber: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const out = normalizeBankAccountNumber(v);
      if (out === null) ctx.addIssue({ code: "custom", message: "Account number must be 6 to 34 letters or digits" });
      return out ?? z.NEVER;
    }),
});

export const reviewChangeSchema = z.object({
  requestId: uuid,
  decision: z.enum(["approve", "reject"]),
  note: text(500),
});

export const cancelChangeSchema = z.object({ requestId: uuid });

// --- Clients and assignments --------------------------------------------------

export const clientSchema = z.object({
  name: requiredText("the client name", 120),
  timeZone: z.string().refine(isValidTimeZone, "Choose a valid time zone"),
  holidayCalendar: z.enum(["PH", "US"]).default("US"),
  isActive: z.boolean().default(true),
});
export const updateClientSchema = clientSchema.extend({ clientId: uuid });

export const assignmentSchema = z.object({
  employeeId: uuid,
  clientId: uuid,
  startDate: isoDate,
  hoursPerWeek: z.preprocess(
    (v) => (v === "" || v === null ? undefined : typeof v === "string" ? Number(v) : v),
    z.number().gt(0, "Hours must be more than 0").max(80, "80 hours at most").optional(),
  ),
});

export const endAssignmentSchema = z.object({ assignmentId: uuid, endDate: isoDate });

// --- Custom fields ------------------------------------------------------------

export const customFieldDefSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,40}$/, "Use lowercase letters, numbers and underscores"),
    label: requiredText("a label", 80),
    fieldType: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    visibility: z.enum(CUSTOM_FIELD_VISIBILITY).default("hr_only"),
    isRequired: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .refine((v) => v.fieldType !== "select" || (v.options && new Set(v.options).size >= 2 && new Set(v.options).size === v.options.length), {
    message: "A select field needs at least two different options",
    path: ["options"],
  });

export const archiveCustomFieldSchema = z.object({ fieldDefId: uuid });

export const customFieldValuesSchema = z.object({
  employeeId: uuid,
  values: z.record(uuid, z.string().trim().max(500)),
});

// --- Directory query ----------------------------------------------------------

export const DIRECTORY_SORTS = ["name", "position", "status", "start"] as const;

export const directoryQuerySchema = z.object({
  q: z.preprocess(blankToUndefined, z.string().trim().max(80).optional()),
  status: z.preprocess(blankToUndefined, z.enum(EMPLOYEE_STATUSES).optional()),
  client: z.preprocess(blankToUndefined, uuid.optional()),
  team: z.preprocess(blankToUndefined, uuid.optional()),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
  sort: z.enum(DIRECTORY_SORTS).catch("name"),
  dir: z.enum(["asc", "desc"]).catch("asc"),
  archived: z.preprocess((v) => v === "1" || v === "true" || v === true, z.boolean()),
});

export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;
export type EmployeeFieldsInput = z.input<typeof employeeFieldsSchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type ContactChangeInput = z.input<typeof contactChangeSchema>;
export type EmergencyContactsInput = z.input<typeof emergencyContactsChangeSchema>;
export type BankChangeInput = z.input<typeof bankChangeSchema>;

export const dataRightsRequestSchema = z.object({
  kind: z.enum(["correction", "deletion", "other"]),
  details: z.string().trim().min(10, "Describe what you need in at least 10 characters").max(1000, "Use 1,000 characters or fewer"),
});
