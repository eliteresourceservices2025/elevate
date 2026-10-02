import { sql } from "drizzle-orm";
import { boolean, check, date, index, jsonb, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { offers } from "@/modules/offers/schema";
import { employees } from "@/modules/people/schema";
import { applications, talent } from "@/modules/recruiting/schema";
import { documentTypes } from "@/modules/documents/schema";

// Onboarding and offboarding (C2, C3). A case is a checklist for one person; its tasks are copied from a template when the case opens,
// so changing a template later never changes a case already running.

export const checklistTemplates = talent
  .table(
    "checklist_templates",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      kind: text("kind").notNull(),
      name: text("name").notNull(),
      /** The position this template is for. Empty = the default, used for any position without its own. */
      positionId: uuid("position_id"),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      createdBy: uuid("created_by").references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check("checklist_templates_kind_chk", sql`${t.kind} in ('onboarding','offboarding')`),
      uniqueIndex("checklist_templates_position_idx").on(t.kind, t.positionId).where(sql`${t.archivedAt} is null and ${t.positionId} is not null`),
      uniqueIndex("checklist_templates_default_idx").on(t.kind).where(sql`${t.archivedAt} is null and ${t.positionId} is null`),
    ],
  )
  .enableRLS();

export const checklistTemplateItems = talent
  .table(
    "checklist_template_items",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      templateId: uuid("template_id")
        .notNull()
        .references(() => checklistTemplates.id),
      position: smallint("position").notNull(),
      title: text("title").notNull(),
      details: text("details"),
      owner: text("owner").notNull(),
      dueOffsetDays: smallint("due_offset_days").notNull().default(0),
      required: boolean("required").notNull().default(true),
      check: text("check_kind").notNull().default("manual"),
      documentTypeId: uuid("document_type_id").references(() => documentTypes.id),
      policyId: uuid("policy_id"),
      policyKind: text("policy_kind"),
      signTemplateId: uuid("sign_template_id"),
      href: text("href"),
    },
    (t) => [
      index("checklist_template_items_template_idx").on(t.templateId, t.position),
      check("checklist_template_items_owner_chk", sql`${t.owner} in ('hr','lead','person')`),
      check("checklist_template_items_check_chk", sql`${t.check} in ('manual','document','required_documents','policy','account','signature','exit_interview','access')`),
    ],
  )
  .enableRLS();

/** Opened by a hire (3.3). */
export const onboardingCases = talent
  .table(
    "onboarding_cases",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => applications.id),
      offerId: uuid("offer_id").references(() => offers.id),
      templateId: uuid("template_id").references(() => checklistTemplates.id),
      startDate: date("start_date", { mode: "string" }),
      status: text("status").notNull().default("open"),
      /** Set when HR hired without a signed offer: the reason is required. */
      hiredWithoutOfferReason: text("hired_without_offer_reason"),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      completedBy: uuid("completed_by").references(() => users.id),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("onboarding_cases_application_idx").on(t.applicationId),
      uniqueIndex("onboarding_cases_employee_idx").on(t.employeeId),
      check("onboarding_cases_status_chk", sql`${t.status} in ('open','completed','cancelled')`),
      check("onboarding_cases_reason_chk", sql`(${t.offerId} is not null) or coalesce(length(trim(${t.hiredWithoutOfferReason})), 0) > 0`),
    ],
  )
  .enableRLS();

export const offboardingCases = talent
  .table(
    "offboarding_cases",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      lastWorkingDay: date("last_working_day", { mode: "string" }).notNull(),
      reason: text("reason").notNull(),
      note: text("note"),
      templateId: uuid("template_id").references(() => checklistTemplates.id),
      status: text("status").notNull().default("open"),
      /** When the account was switched off and the person marked separated. Empty until then. */
      accessRemovedAt: timestamp("access_removed_at", { withTimezone: true }),
      /** What the separation did, so a retry knows what is left: { person, account, assignments, schedules, requests }. */
      steps: jsonb("steps").$type<Record<string, boolean>>().notNull().default({}),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      completedBy: uuid("completed_by").references(() => users.id),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("offboarding_cases_open_idx").on(t.employeeId).where(sql`${t.status} = 'open'`),
      check("offboarding_cases_status_chk", sql`${t.status} in ('open','completed','cancelled')`),
      check("offboarding_cases_reason_chk", sql`${t.reason} in ('resignation','end_of_contract','termination','other')`),
    ],
  )
  .enableRLS();

export const checklistTasks = talent
  .table(
    "checklist_tasks",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      onboardingCaseId: uuid("onboarding_case_id").references(() => onboardingCases.id),
      offboardingCaseId: uuid("offboarding_case_id").references(() => offboardingCases.id),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      position: smallint("position").notNull(),
      title: text("title").notNull(),
      details: text("details"),
      owner: text("owner").notNull(),
      /** The person who owns it when it is a lead's or the person's own task. HR tasks belong to every HR admin. */
      ownerUserId: uuid("owner_user_id").references(() => users.id),
      dueOn: date("due_on", { mode: "string" }).notNull(),
      required: boolean("required").notNull().default(true),
      check: text("check_kind").notNull().default("manual"),
      documentTypeId: uuid("document_type_id").references(() => documentTypes.id),
      policyId: uuid("policy_id"),
      policyKind: text("policy_kind"),
      signTemplateId: uuid("sign_template_id"),
      /** The Sign envelope of a signature task. */
      envelopeId: uuid("envelope_id"),
      href: text("href"),
      status: text("status").notNull().default("todo"),
      completedBy: uuid("completed_by").references(() => users.id),
      completedAt: timestamp("completed_at", { withTimezone: true }),
      /** True when ELEVATE closed it because it saw the document, acknowledgment or signature. */
      autoCompleted: boolean("auto_completed").notNull().default(false),
      note: text("note"),
      lastReminderOn: date("last_reminder_on", { mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("checklist_tasks_onboarding_idx").on(t.onboardingCaseId, t.position),
      index("checklist_tasks_offboarding_idx").on(t.offboardingCaseId, t.position),
      index("checklist_tasks_owner_idx").on(t.ownerUserId, t.status),
      check("checklist_tasks_one_case_chk", sql`(${t.onboardingCaseId} is null) <> (${t.offboardingCaseId} is null)`),
      check("checklist_tasks_status_chk", sql`${t.status} in ('todo','done','skipped')`),
      check("checklist_tasks_owner_chk", sql`${t.owner} in ('hr','lead','person')`),
    ],
  )
  .enableRLS();

/** Private to HR. One per offboarding case. */
export const exitInterviews = talent
  .table(
    "exit_interviews",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      offboardingCaseId: uuid("offboarding_case_id")
        .notNull()
        .references(() => offboardingCases.id),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      reasonForLeaving: text("reason_for_leaving").notNull(),
      wentWell: text("went_well"),
      toImprove: text("to_improve"),
      wouldReturn: text("would_return").notNull(),
      submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("exit_interviews_case_idx").on(t.offboardingCaseId), check("exit_interviews_return_chk", sql`${t.wouldReturn} in ('yes','maybe','no')`)],
  )
  .enableRLS();

/** Certificates of engagement HR issued. The PDF is kept in the signed-docs bucket. */
export const certificates = talent
  .table(
    "certificates",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      reference: text("reference").notNull(),
      storagePath: text("storage_path").notNull(),
      sha256: text("sha256").notNull(),
      issuedBy: uuid("issued_by")
        .notNull()
        .references(() => users.id),
      issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("certificates_reference_idx").on(t.reference)],
  )
  .enableRLS();
