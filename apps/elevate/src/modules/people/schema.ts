import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { core, users } from "@/modules/core/schema";

// People records (A1). Foreign keys point at core.users; writes to users stay in the core module.
// No table here may hold client patient data (HIPAA): clients are names and time zones only.

export const employeeNumberSeq = core.sequence("employee_number_seq", { startWith: 1 });

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const employees = core
  .table(
    "employees",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeNumber: text("employee_number")
        .notNull()
        .default(sql`'ERS-' || lpad(nextval('core.employee_number_seq')::text, 4, '0')`),
      // Set when the person signs in with a matching verified email. Null until then.
      userId: uuid("user_id").references(() => users.id),

      legalFirstName: text("legal_first_name").notNull(),
      legalMiddleName: text("legal_middle_name"),
      legalLastName: text("legal_last_name").notNull(),
      preferredName: text("preferred_name"),
      birthDate: date("birth_date", { mode: "string" }),
      civilStatus: text("civil_status"),

      workEmail: text("work_email").notNull(),
      personalEmail: text("personal_email"),
      mobile: text("mobile"),
      addressLine: text("address_line"),
      city: text("city"),
      province: text("province"),
      postalCode: text("postal_code"),
      country: text("country").notNull().default("PH"),

      // Organization (Phase 1.2). team_id and position_id point at org.teams / org.positions; their
      // foreign keys live in a custom migration so the two schema files do not import each other.
      managerId: uuid("manager_id").references((): AnyPgColumn => employees.id),
      teamId: uuid("team_id"),
      positionId: uuid("position_id"),
      // Display title, kept in sync with the positions catalog (and what the history shows).
      position: text("position"),
      status: text("status").notNull().default("onboarding"),
      workerType: text("worker_type").notNull().default("contractor"),
      startDate: date("start_date", { mode: "string" }),
      endDate: date("end_date", { mode: "string" }),

      createdBy: uuid("created_by"),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [
      uniqueIndex("employees_number_idx").on(t.employeeNumber),
      uniqueIndex("employees_work_email_idx").on(sql`lower(${t.workEmail})`),
      uniqueIndex("employees_user_idx").on(t.userId).where(sql`${t.userId} is not null`),
      index("employees_status_idx").on(t.status),
      index("employees_manager_idx").on(t.managerId),
      index("employees_team_idx").on(t.teamId),
      check("employees_status_chk", sql`${t.status} in ('onboarding','active','probation','on_leave','separated')`),
      check("employees_worker_type_chk", sql`${t.workerType} in ('contractor','employee')`),
      check(
        "employees_civil_status_chk",
        sql`${t.civilStatus} is null or ${t.civilStatus} in ('single','married','widowed','separated','other')`,
      ),
    ],
  )
  .enableRLS();

// Government IDs, payout details and pay rate. Every *_enc column is AES-256-GCM via src/lib/crypto.ts
// with context "employee_sensitive:<field>:<employeeId>". `masks` holds display-only masked strings
// computed at write time, so showing a masked value never needs a decrypt.
export const employeeSensitive = core
  .table("employee_sensitive", {
    employeeId: uuid("employee_id")
      .primaryKey()
      .references(() => employees.id),
    tinEnc: text("tin_enc"),
    sssEnc: text("sss_enc"),
    philhealthEnc: text("philhealth_enc"),
    pagibigEnc: text("pagibig_enc"),
    bankNameEnc: text("bank_name_enc"),
    bankAccountNameEnc: text("bank_account_name_enc"),
    bankAccountNumberEnc: text("bank_account_number_enc"),
    payRateEnc: text("pay_rate_enc"),
    payCurrency: text("pay_currency").notNull().default("PHP"),
    masks: jsonb("masks").$type<Record<string, string>>().notNull().default({}),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();

// Append-only (trigger in the migration). Sensitive changes are recorded as a marker only:
// what changed and when, never the old or new values.
export const employmentHistory = core
  .table(
    "employment_history",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      eventType: text("event_type").notNull(),
      effectiveDate: date("effective_date", { mode: "string" }).notNull().default(sql`current_date`),
      summary: text("summary").notNull(),
      before: jsonb("before"),
      after: jsonb("after"),
      changedBy: uuid("changed_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("employment_history_employee_idx").on(t.employeeId, t.createdAt)],
  )
  .enableRLS();

export const emergencyContacts = core
  .table(
    "emergency_contacts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      name: text("name").notNull(),
      relationship: text("relationship").notNull(),
      phone: text("phone").notNull(),
      isPrimary: boolean("is_primary").notNull().default(false),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [index("emergency_contacts_employee_idx").on(t.employeeId)],
  )
  .enableRLS();

export const clients = core
  .table(
    "clients",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      name: text("name").notNull(),
      timeZone: text("time_zone").notNull().default("America/New_York"),
      /** Which public holiday calendar applies to people assigned to this client ('US' or 'PH'). */
      holidayCalendar: text("holiday_calendar").notNull().default("US"),
      isActive: boolean("is_active").notNull().default(true),
      createdBy: uuid("created_by"),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [uniqueIndex("clients_name_idx").on(sql`lower(${t.name})`), check("clients_holiday_calendar_chk", sql`${t.holidayCalendar} in ('PH','US')`)],
  )
  .enableRLS();

export const clientAssignments = core
  .table(
    "client_assignments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id),
      startDate: date("start_date", { mode: "string" }).notNull(),
      endDate: date("end_date", { mode: "string" }),
      hoursPerWeek: numeric("hours_per_week", { precision: 4, scale: 1 }),
      createdBy: uuid("created_by"),
      ...stamps,
    },
    (t) => [
      index("client_assignments_employee_idx").on(t.employeeId),
      index("client_assignments_client_idx").on(t.clientId),
      // One open assignment per person and client.
      uniqueIndex("client_assignments_open_idx").on(t.employeeId, t.clientId).where(sql`${t.endDate} is null`),
      check("client_assignments_dates_chk", sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
      check("client_assignments_hours_chk", sql`${t.hoursPerWeek} is null or (${t.hoursPerWeek} > 0 and ${t.hoursPerWeek} <= 80)`),
    ],
  )
  .enableRLS();

// HR-defined extra fields. Never sensitive: anything sensitive must be a built-in encrypted field.
export const customFieldDefs = core
  .table(
    "custom_field_defs",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      key: text("key").notNull(),
      label: text("label").notNull(),
      fieldType: text("field_type").notNull(),
      options: jsonb("options").$type<string[]>(),
      visibility: text("visibility").notNull().default("hr_only"),
      isRequired: boolean("is_required").notNull().default(false),
      sortOrder: integer("sort_order").notNull().default(0),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [
      uniqueIndex("custom_field_defs_key_idx").on(t.key),
      check("custom_field_defs_type_chk", sql`${t.fieldType} in ('text','number','date','select')`),
      check("custom_field_defs_visibility_chk", sql`${t.visibility} in ('hr_only','employee_visible')`),
    ],
  )
  .enableRLS();

export const customFieldValues = core
  .table(
    "custom_field_values",
    {
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      fieldDefId: uuid("field_def_id")
        .notNull()
        .references(() => customFieldDefs.id),
      value: text("value").notNull(),
      updatedBy: uuid("updated_by"),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.employeeId, t.fieldDefId] })],
  )
  .enableRLS();

// Self-service edits waiting for HR. Contact and emergency changes keep plain `payload`;
// bank changes keep only `payload_enc` (encrypted JSON), cleared as soon as the request is resolved.
export const changeRequests = core
  .table(
    "change_requests",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      category: text("category").notNull(),
      payload: jsonb("payload"),
      payloadEnc: text("payload_enc"),
      status: text("status").notNull().default("pending"),
      requestedBy: uuid("requested_by").notNull(),
      reviewedBy: uuid("reviewed_by"),
      reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
      reviewNote: text("review_note"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("change_requests_status_idx").on(t.status, t.createdAt),
      // One pending request per person and category, so edits cannot stack up.
      uniqueIndex("change_requests_pending_idx").on(t.employeeId, t.category).where(sql`${t.status} = 'pending'`),
      check("change_requests_category_chk", sql`${t.category} in ('contact','emergency_contacts','bank','data_rights')`),
      check("change_requests_status_chk", sql`${t.status} in ('pending','approved','rejected','cancelled')`),
    ],
  )
  .enableRLS();
