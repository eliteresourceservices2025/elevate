import "server-only";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { cleanupPendingUploads, runExpiryReminders } from "@/modules/documents/jobs";
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

export const functions = [documentExpiryReminders, documentPendingCleanup];
