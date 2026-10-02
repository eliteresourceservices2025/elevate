import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { employees } from "@/modules/people/schema";
import { talent } from "@/modules/recruiting/schema";
import type { Question } from "./constants";

// Performance reviews (D1) and goals. A cycle keeps its own copy of the questions, so editing a template later never changes a cycle
// already running. Submitted self and lead reviews, calibrations and acknowledgments are append-only (database triggers); a review
// row only moves forward (timestamps are set once).

export const reviewTemplates = talent
  .table(
    "review_templates",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      name: text("name").notNull(),
      questions: jsonb("questions").$type<Question[]>().notNull(),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      createdBy: uuid("created_by").references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("review_templates_name_idx").on(sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`)],
  )
  .enableRLS();

export const reviewCycles = talent
  .table(
    "review_cycles",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      name: text("name").notNull(),
      type: text("type").notNull(),
      /** The questions at the time the cycle was launched. */
      questions: jsonb("questions").$type<Question[]>().notNull(),
      selfDueOn: date("self_due_on", { mode: "string" }).notNull(),
      leadDueOn: date("lead_due_on", { mode: "string" }).notNull(),
      calibrateDueOn: date("calibrate_due_on", { mode: "string" }).notNull(),
      status: text("status").notNull().default("open"),
      createdBy: uuid("created_by").references(() => users.id),
      closedAt: timestamp("closed_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("review_cycles_type_chk", sql`${t.type} in ('quarterly','annual','early')`), check("review_cycles_status_chk", sql`${t.status} in ('open','closed')`)],
  )
  .enableRLS();

export const reviews = talent
  .table(
    "reviews",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      cycleId: uuid("cycle_id")
        .notNull()
        .references(() => reviewCycles.id),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      /** Who writes the lead's review: the person's lead when the cycle launched. Null = HR writes it. */
      leadUserId: uuid("lead_user_id").references(() => users.id),
      /** 3 or 5 for an early-engagement review, else null. One of each per person. */
      milestone: smallint("milestone"),
      selfSubmittedAt: timestamp("self_submitted_at", { withTimezone: true }),
      leadSubmittedAt: timestamp("lead_submitted_at", { withTimezone: true }),
      calibratedAt: timestamp("calibrated_at", { withTimezone: true }),
      sharedAt: timestamp("shared_at", { withTimezone: true }),
      acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
      lastReminderOn: date("last_reminder_on", { mode: "string" }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("reviews_cycle_employee_idx").on(t.cycleId, t.employeeId),
      uniqueIndex("reviews_milestone_idx").on(t.employeeId, t.milestone).where(sql`${t.milestone} is not null`),
      index("reviews_employee_idx").on(t.employeeId),
      check("reviews_milestone_chk", sql`${t.milestone} is null or ${t.milestone} in (3,5)`),
    ],
  )
  .enableRLS();

/** A submitted self or lead review. Append-only: never edited. */
export const reviewResponses = talent
  .table(
    "review_responses",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      reviewId: uuid("review_id")
        .notNull()
        .references(() => reviews.id),
      role: text("role").notNull(),
      answers: jsonb("answers").$type<Record<string, { rating?: number; text?: string }>>().notNull(),
      overallRating: smallint("overall_rating"),
      comments: text("comments"),
      authorUserId: uuid("author_user_id").references(() => users.id),
      submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("review_responses_role_idx").on(t.reviewId, t.role),
      check("review_responses_role_chk", sql`${t.role} in ('self','lead')`),
      check("review_responses_rating_chk", sql`${t.overallRating} is null or ${t.overallRating} between 1 and 5`),
    ],
  )
  .enableRLS();

/** HR's calibration: the final rating and summary. Append-only; the newest row is current and only until the review is shared. */
export const reviewCalibrations = talent
  .table(
    "review_calibrations",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      reviewId: uuid("review_id")
        .notNull()
        .references(() => reviews.id),
      finalRating: smallint("final_rating").notNull(),
      summary: text("summary"),
      /** Required when the final rating differs from the lead's overall rating. */
      changeReason: text("change_reason"),
      calibratedBy: uuid("calibrated_by").references(() => users.id),
      calibratedAt: timestamp("calibrated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("review_calibrations_review_idx").on(t.reviewId), check("review_calibrations_rating_chk", sql`${t.finalRating} between 1 and 5`)],
  )
  .enableRLS();

/** "I have read this" (not "I agree"), with an optional comment. One per review, insert-only. */
export const reviewAcknowledgments = talent
  .table(
    "review_acknowledgments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      reviewId: uuid("review_id")
        .notNull()
        .references(() => reviews.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      comment: text("comment"),
      acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("review_acknowledgments_review_idx").on(t.reviewId)],
  )
  .enableRLS();

export const goals = talent
  .table(
    "goals",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      title: text("title").notNull(),
      description: text("description"),
      targetOn: date("target_on", { mode: "string" }),
      status: text("status").notNull().default("not_started"),
      createdBy: uuid("created_by").references(() => users.id),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("goals_employee_idx").on(t.employeeId), check("goals_status_chk", sql`${t.status} in ('not_started','in_progress','done','dropped')`)],
  )
  .enableRLS();

export const goalNotes = talent
  .table(
    "goal_notes",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      goalId: uuid("goal_id")
        .notNull()
        .references(() => goals.id),
      authorUserId: uuid("author_user_id").references(() => users.id),
      note: text("note").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [index("goal_notes_goal_idx").on(t.goalId)],
  )
  .enableRLS();

/** One row. Early-engagement reviews (month 3 and 5) are on by default. */
export const reviewSettings = talent
  .table(
    "review_settings",
    {
      id: integer("id").primaryKey().default(1),
      earlyEnabled: boolean("early_enabled").notNull().default(true),
      /** The template for early reviews; null = the built-in short one. */
      earlyTemplateId: uuid("early_template_id").references(() => reviewTemplates.id),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("review_settings_one_row_chk", sql`${t.id} = 1`)],
  )
  .enableRLS();
