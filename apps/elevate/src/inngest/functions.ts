import "server-only";
import { DEFAULT_TIMEZONE, SECONDARY_TIMEZONE, formatInZone } from "@/lib/time";
import { purgeSelfies, rebuildAttendanceDays, runMissedClockouts } from "@/modules/attendance/jobs";
import { runAckReminders } from "@/modules/announcements/jobs";
import { cleanupPendingUploads, runExpiryReminders } from "@/modules/documents/jobs";
import { runLeaveExpiry } from "@/modules/timeoff/jobs";
import { runLeaveRequestReminders } from "@/modules/timeoff/request-jobs";
import { runDailyDigest } from "@/modules/notifications/digest";
import { flushEmailQueue } from "@/modules/notifications/email-queue";
import { todayInZone } from "@/modules/org/service";
import { inngest } from "./client";

// Every job is a thin wrapper around a plain, tested function in its module.

/** Daily at 1:00 AM in the company time zone: expiry reminders at 30 days, 7 days and the day itself. */
export const documentExpiryReminders = inngest.createFunction(
  { id: "document-expiry-reminders", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 0 1 * * *` } },
  async ({ step }) => step.run("send-reminders", () => runExpiryReminders(todayInZone())),
);

/** Daily at 2:00 AM: remove uploads that were started and never finished. */
export const documentPendingCleanup = inngest.createFunction(
  { id: "document-pending-cleanup", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 0 2 * * *` } },
  async ({ step }) => step.run("cleanup", () => cleanupPendingUploads()),
);

/** Daily at 1:30 AM: acknowledgment reminders (3 days before, the due day, weekly while overdue). */
export const acknowledgmentReminders = inngest.createFunction(
  { id: "acknowledgment-reminders", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 30 1 * * *` } },
  async ({ step }) => step.run("remind", () => runAckReminders(todayInZone())),
);

/** Weekdays at 8:00 AM Manila time: queue the daily digest for people with unread notifications. */
export const dailyDigest = inngest.createFunction(
  { id: "daily-digest", triggers: { cron: `TZ=${SECONDARY_TIMEZONE} 0 8 * * 1-5` } },
  async ({ step }) => step.run("queue", () => runDailyDigest(formatInZone(new Date(), SECONDARY_TIMEZONE, "yyyy-MM-dd"))),
);

/** Every 15 minutes: send queued email within the daily budget (acknowledgments first, then digests). */
export const emailSender = inngest.createFunction(
  { id: "email-sender", triggers: { cron: "*/15 * * * *" } },
  async ({ step }) => step.run("send", () => flushEmailQueue()),
);

/** Daily at 1:15 AM: write off prize days past their expiry and remind people of ones expiring within 7 days. */
export const leaveExpiry = inngest.createFunction(
  { id: "leave-expiry", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 15 1 * * *` } },
  async ({ step }) => step.run("expire", () => runLeaveExpiry(todayInZone())),
);

/** Daily at 1:20 AM: remind approvers of requests waiting 2 working days, and send stale lead steps (4 days) to HR. */
export const leaveRequestReminders = inngest.createFunction(
  { id: "leave-request-reminders", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 20 1 * * *` } },
  async ({ step }) => step.run("remind", () => runLeaveRequestReminders(todayInZone())),
);

/** Daily at 2:30 AM: rebuild attendance_days from the clock events for the last few days. */
export const attendanceRebuild = inngest.createFunction(
  { id: "attendance-rebuild", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 30 2 * * *` } },
  async ({ step }) => step.run("rebuild", () => rebuildAttendanceDays()),
);

/** Hourly: tell people and their leads about sessions open for more than 12 hours. */
export const missedClockouts = inngest.createFunction(
  { id: "missed-clockouts", triggers: { cron: "5 * * * *" } },
  async ({ step }) => step.run("check", () => runMissedClockouts()),
);

/** Daily at 2:40 AM: delete clock-in selfies after 30 days. */
export const selfiePurge = inngest.createFunction(
  { id: "selfie-purge", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 40 2 * * *` } },
  async ({ step }) => step.run("purge", () => purgeSelfies()),
);

export const functions = [documentExpiryReminders, documentPendingCleanup, acknowledgmentReminders, dailyDigest, emailSender, leaveExpiry, leaveRequestReminders, attendanceRebuild, missedClockouts, selfiePurge];
