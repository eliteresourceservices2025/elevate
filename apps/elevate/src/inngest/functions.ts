import "server-only";
import { DEFAULT_TIMEZONE, SECONDARY_TIMEZONE, formatInZone } from "@/lib/time";
import { purgeEvidence, purgeSelfies, rebuildAttendanceDays, runExtraHoursReminders, runHrApprovalSummary, runLeadApprovalReminders, runMissedClockouts, runOverbreakAlerts, runQuietSessionAlerts, runWeeklyExtraHoursNotice } from "@/modules/attendance/jobs";
import { runAckReminders } from "@/modules/announcements/jobs";
import { processMirrorQueue, purgeJibbleData, runJibbleComparison, runJibbleRepair, runJibbleUnmatchedReport, syncJibblePeople } from "@/modules/jibble/jobs";
import { cleanupPendingUploads, runExpiryReminders } from "@/modules/documents/jobs";
import { runLeaveExpiry } from "@/modules/timeoff/jobs";
import { runLeaveRequestReminders } from "@/modules/timeoff/request-jobs";
import { runDailyDigest } from "@/modules/notifications/digest";
import { flushEmailQueue } from "@/modules/notifications/email-queue";
import { todayInZone } from "@/modules/org/service";
import { runRecruitingRetention, sendCandidateEmails } from "@/modules/recruiting/jobs";
import { runEsignReminders, runEsignSealSweep } from "@/modules/signing/jobs";
import { runChecklistReminders, runChecklistSync, runSeparations } from "@/modules/onboarding/jobs";
import { runSafevoiceNotify } from "@/modules/safevoice/jobs";
import { runEarlyReviewScheduler, runReviewReminders } from "@/modules/reviews/jobs";
import { runHealthCheck, trackJob as track } from "@/modules/health/service";
import { inngest } from "./client";

// Every job is a thin wrapper around a plain, tested function in its module.

/** Daily at 1:00 AM in the company time zone: expiry reminders at 30 days, 7 days and the day itself. */
export const documentExpiryReminders = inngest.createFunction(
  { id: "document-expiry-reminders", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 0 1 * * *` } },
  async ({ step }) => step.run("send-reminders", () => track("document-expiry-reminders", () => runExpiryReminders(todayInZone()))),
);

/** Daily at 2:00 AM: remove uploads that were started and never finished. */
export const documentPendingCleanup = inngest.createFunction(
  { id: "document-pending-cleanup", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 0 2 * * *` } },
  async ({ step }) => step.run("cleanup", () => track("document-pending-cleanup", () => cleanupPendingUploads())),
);

/** Daily at 1:30 AM: acknowledgment reminders (3 days before, the due day, weekly while overdue). */
export const acknowledgmentReminders = inngest.createFunction(
  { id: "acknowledgment-reminders", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 30 1 * * *` } },
  async ({ step }) => step.run("remind", () => track("acknowledgment-reminders", () => runAckReminders(todayInZone()))),
);

/** Weekdays at 8:00 AM Manila time: queue the daily digest for people with unread notifications. */
export const dailyDigest = inngest.createFunction(
  { id: "daily-digest", triggers: { cron: `TZ=${SECONDARY_TIMEZONE} 0 8 * * 1-5` } },
  async ({ step }) => step.run("queue", () => track("daily-digest", () => runDailyDigest(formatInZone(new Date(), SECONDARY_TIMEZONE, "yyyy-MM-dd")))),
);

/** Every 15 minutes: send queued email within the daily budget (acknowledgments first, then digests). */
export const emailSender = inngest.createFunction(
  { id: "email-sender", triggers: { cron: "*/15 * * * *" } },
  async ({ step }) => step.run("send", () => track("email-sender", () => flushEmailQueue())),
);

/** Daily at 1:15 AM: write off prize days past their expiry and remind people of ones expiring within 7 days. */
export const leaveExpiry = inngest.createFunction(
  { id: "leave-expiry", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 15 1 * * *` } },
  async ({ step }) => step.run("expire", () => track("leave-expiry", () => runLeaveExpiry(todayInZone()))),
);

/** Daily at 1:20 AM: remind approvers of requests waiting 2 working days, and send stale lead steps (4 days) to HR. */
export const leaveRequestReminders = inngest.createFunction(
  { id: "leave-request-reminders", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 20 1 * * *` } },
  async ({ step }) => step.run("remind", () => track("leave-request-reminders", () => runLeaveRequestReminders(todayInZone()))),
);

/** Daily at 2:30 AM: rebuild attendance_days from the clock events for the last few days. */
export const attendanceRebuild = inngest.createFunction(
  { id: "attendance-rebuild", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 30 2 * * *` } },
  async ({ step }) => step.run("rebuild", () => track("attendance-rebuild", () => rebuildAttendanceDays())),
);

/** Hourly: tell people and their leads about sessions open for more than 12 hours. */
export const missedClockouts = inngest.createFunction(
  { id: "missed-clockouts", triggers: { cron: "5 * * * *" } },
  async ({ step }) => step.run("check", () => track("missed-clockouts", () => runMissedClockouts())),
);

/** Every 5 minutes: tell leads about timed breaks that are still running past their length. */
export const overbreakAlerts = inngest.createFunction(
  { id: "overbreak-alerts", triggers: { cron: "*/5 * * * *" } },
  async ({ step }) => step.run("check", () => track("overbreak-alerts", () => runOverbreakAlerts())),
);

/** Daily at 2:40 AM: delete clock-in selfies after 30 days. */
export const selfiePurge = inngest.createFunction(
  { id: "selfie-purge", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 40 2 * * *` } },
  async ({ step }) => step.run("purge", () => track("selfie-purge", () => purgeSelfies())),
);

/** Every 15 minutes: tell leads about clocked-in people who have not been seen for 2 hours. */
export const quietSessionAlerts = inngest.createFunction(
  { id: "quiet-session-alerts", triggers: { cron: "*/15 * * * *" } },
  async ({ step }) => step.run("check", () => track("quiet-session-alerts", () => runQuietSessionAlerts())),
);

/** Daily at 2:50 AM: delete time-claim screenshots 90 days after the decision (and ones never attached). */
export const evidencePurge = inngest.createFunction(
  { id: "evidence-purge", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 50 2 * * *` } },
  async ({ step }) => step.run("purge", () => track("evidence-purge", () => purgeEvidence())),
);

/** Sends waiting clock calls to Jibble: right away when a clock event asks, and every 5 minutes as a safety sweep (retries). */
export const jibbleMirror = inngest.createFunction(
  { id: "jibble-mirror", triggers: [{ event: "jibble/mirror.requested" }, { cron: "*/5 * * * *" }] },
  async ({ step }) => step.run("send", () => track("jibble-mirror", () => processMirrorQueue())),
);

/** Every 10 minutes: put Jibble back in step with ELEVATE for people who are working (or just clocked out) on teams that use Jibble. */
export const jibbleRepair = inngest.createFunction(
  { id: "jibble-repair", triggers: { cron: "*/10 * * * *" } },
  async ({ step }) => step.run("repair", () => track("jibble-repair", () => runJibbleRepair())),
);

/** Daily at 3:20 AM: tell HR who clocked in with no Jibble account yesterday (they worked without screenshots). */
export const jibbleUnmatched = inngest.createFunction(
  { id: "jibble-unmatched", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 20 3 * * *` } },
  async ({ step }) => step.run("report", () => track("jibble-unmatched", () => runJibbleUnmatchedReport())),
);

/** Daily at 3:00 AM: match people to Jibble accounts by work email. */
export const jibblePeopleSync = inngest.createFunction(
  { id: "jibble-people-sync", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 0 3 * * *` } },
  async ({ step }) => step.run("sync", () => track("jibble-people-sync", () => syncJibblePeople())),
);

/** Daily at 3:10 AM (after the 2:30 attendance rebuild): compare yesterday's Jibble totals with ELEVATE's and clean up old totals. */
export const jibbleComparison = inngest.createFunction(
  { id: "jibble-comparison", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 10 3 * * *` } },
  async ({ step }) => {
    const compared = await step.run("compare", () => track("jibble-comparison", () => runJibbleComparison()));
    await step.run("purge", () => purgeJibbleData());
    return compared;
  },
);

/** Every 30 minutes: nudge requests for extra hours whose window is about to start and nobody has answered. */
export const extraHoursReminders = inngest.createFunction(
  { id: "extra-hours-reminders", triggers: { cron: "*/30 * * * *" } },
  async ({ step }) => step.run("remind", () => track("extra-hours-reminders", () => runExtraHoursReminders())),
);

/** Mondays at 8:00 AM Manila: HR gets last week's approved extra hours per client. */
export const extraHoursWeekly = inngest.createFunction(
  { id: "extra-hours-weekly", triggers: { cron: `TZ=${SECONDARY_TIMEZONE} 0 8 * * 1` } },
  async ({ step }) => step.run("summarize", () => track("extra-hours-weekly", () => runWeeklyExtraHoursNotice())),
);

/** Mondays at 8:00 AM Manila: remind each lead of unapproved hours from last week. */
export const approvalReminders = inngest.createFunction(
  { id: "approval-reminders", triggers: { cron: `TZ=${SECONDARY_TIMEZONE} 0 8 * * 1` } },
  async ({ step }) => step.run("remind", () => track("approval-reminders", () => runLeadApprovalReminders())),
);

/** Wednesdays at 8:00 AM Manila: tell HR who is still holding up last week's hours. */
export const approvalSummary = inngest.createFunction(
  { id: "approval-summary", triggers: { cron: `TZ=${SECONDARY_TIMEZONE} 0 8 * * 3` } },
  async ({ step }) => step.run("summarize", () => track("approval-summary", () => runHrApprovalSummary())),
);

/** Every 30 minutes: tell HR when a scheduled job has stopped running or a Jibble call has waited too long. */
export const healthCheck = inngest.createFunction(
  { id: "health-check", triggers: { cron: "*/30 * * * *" } },
  async ({ step }) => step.run("check", () => track("health-check", () => runHealthCheck())),
);

/** Every 10 minutes: send queued applicant emails (received, rejection, interview) under their own daily cap. */
export const candidateEmailSender = inngest.createFunction(
  { id: "candidate-email-sender", triggers: { cron: "*/10 * * * *" } },
  async ({ step }) => step.run("send", () => track("candidate-email-sender", () => sendCandidateEmails())),
);

/** Daily at 3:30 AM Phoenix: remove personal data of applicants past the retention period (only when HR has switched it on). */
export const recruitingRetention = inngest.createFunction(
  { id: "recruiting-retention", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 30 3 * * *` } },
  async ({ step }) => step.run("purge", () => track("recruiting-retention", () => runRecruitingRetention())),
);

/** Daily at 8:30 AM Manila: expire overdue documents and remind people whose turn it is to sign. */
export const esignReminders = inngest.createFunction(
  { id: "esign-reminders", triggers: { cron: `TZ=${SECONDARY_TIMEZONE} 30 8 * * *` } },
  async ({ step }) => step.run("remind", () => track("esign-reminders", () => runEsignReminders())),
);

/** Every 5 minutes: seal any document where everyone has signed but sealing did not finish. */
export const esignSealSweep = inngest.createFunction(
  { id: "esign-seal-sweep", triggers: { cron: "*/5 * * * *" } },
  async ({ step }) => step.run("seal", () => track("esign-seal-sweep", () => runEsignSealSweep())),
);

/** Hourly: remove access for people whose last working day has ended in their own time zone. */
export const offboardingSeparations = inngest.createFunction(
  { id: "offboarding-separations", triggers: { cron: "5 * * * *" } },
  async ({ step }) => step.run("separate", () => track("offboarding-separations", () => runSeparations())),
);

/** Every 30 minutes: close checklist tasks that ELEVATE can see are done. */
export const checklistSync = inngest.createFunction(
  { id: "checklist-sync", triggers: { cron: "*/30 * * * *" } },
  async ({ step }) => step.run("sync", () => track("checklist-sync", () => runChecklistSync())),
);

/** Daily at 8:30 AM Manila: remind owners of checklist tasks that are due or late. */
export const checklistReminders = inngest.createFunction(
  { id: "checklist-reminders", triggers: { cron: `TZ=${SECONDARY_TIMEZONE} 30 8 * * *` } },
  async ({ step }) => step.run("remind", () => track("checklist-reminders", () => runChecklistReminders(formatInZone(new Date(), SECONDARY_TIMEZONE, "yyyy-MM-dd")))),
);

/** Daily at 1:45 AM in the company time zone: open the month 3 and month 5 early-engagement reviews that came due. */
export const earlyReviews = inngest.createFunction(
  { id: "early-reviews", triggers: { cron: `TZ=${DEFAULT_TIMEZONE} 45 1 * * *` } },
  async ({ step }) => step.run("open", () => track("early-reviews", () => runEarlyReviewScheduler(todayInZone()))),
);

/** Daily at 8:45 AM Manila: remind whoever has the next step on a review that is due or late. */
export const reviewReminders = inngest.createFunction(
  { id: "review-reminders", triggers: { cron: `TZ=${SECONDARY_TIMEZONE} 45 8 * * *` } },
  async ({ step }) => step.run("remind", () => track("review-reminders", () => runReviewReminders(formatInZone(new Date(), SECONDARY_TIMEZONE, "yyyy-MM-dd")))),
);

/** Hourly: tell the designated Safe Voice handlers (in the app, counts and a link only) when there is something new. */
export const safevoiceNotify = inngest.createFunction(
  { id: "safevoice-notify", triggers: { cron: "20 * * * *" } },
  async ({ step }) => step.run("notify", () => track("safevoice-notify", () => runSafevoiceNotify())),
);

export const functions = [documentExpiryReminders, documentPendingCleanup, acknowledgmentReminders, dailyDigest, emailSender, leaveExpiry, leaveRequestReminders, attendanceRebuild, missedClockouts, overbreakAlerts, selfiePurge, quietSessionAlerts, evidencePurge, jibbleMirror, jibblePeopleSync, jibbleComparison, jibbleRepair, jibbleUnmatched, extraHoursReminders, extraHoursWeekly, approvalReminders, approvalSummary, healthCheck, candidateEmailSender, recruitingRetention, esignReminders, esignSealSweep, offboardingSeparations, checklistSync, checklistReminders, earlyReviews, reviewReminders, safevoiceNotify];
