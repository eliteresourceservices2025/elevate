// The scheduled jobs and how often each should succeed, in minutes. A job is "late" when it has not succeeded for more than
// 2.5 times that (plus a few minutes), which catches a stopped job service without false alarms for one slow run.
// Pure: no database. The cron times themselves live in src/inngest/functions.ts.

export type JobInfo = { label: string; everyMinutes: number };

const DAILY = 1440;
const WEEKLY = 10_080;

export const JOBS: Record<string, JobInfo> = {
  "document-expiry-reminders": { label: "Document expiry reminders", everyMinutes: DAILY },
  "document-pending-cleanup": { label: "Unfinished upload cleanup", everyMinutes: DAILY },
  "acknowledgment-reminders": { label: "Acknowledgment reminders", everyMinutes: DAILY },
  "daily-digest": { label: "Daily notification digest", everyMinutes: DAILY * 3 }, // weekdays only: a weekend is a gap
  "email-sender": { label: "Email sender", everyMinutes: 30 },
  "candidate-email-sender": { label: "Applicant email sender", everyMinutes: 30 },
  "recruiting-retention": { label: "Applicant data retention", everyMinutes: DAILY },
  "esign-reminders": { label: "Signature reminders and expiry", everyMinutes: DAILY },
  "esign-seal-sweep": { label: "Sealing signed documents", everyMinutes: 30 },
  "offboarding-separations": { label: "Removing access after the last working day", everyMinutes: 60 },
  "checklist-sync": { label: "Checklist auto-completion", everyMinutes: 60 },
  "checklist-reminders": { label: "Checklist reminders", everyMinutes: DAILY },
  "safevoice-notify": { label: "Safe Voice handler notifications", everyMinutes: 60 },
  "import-purge": { label: "Import preview clean-up", everyMinutes: DAILY },
  "early-reviews": { label: "Early-engagement reviews", everyMinutes: DAILY },
  "review-reminders": { label: "Review reminders", everyMinutes: DAILY },
  "leave-expiry": { label: "Prize day expiry", everyMinutes: DAILY },
  "leave-request-reminders": { label: "Time off request reminders", everyMinutes: DAILY },
  "attendance-rebuild": { label: "Nightly attendance rebuild", everyMinutes: DAILY },
  "missed-clockouts": { label: "Missed clock-out notices", everyMinutes: 60 },
  "overbreak-alerts": { label: "Overbreak alerts", everyMinutes: 10 },
  "selfie-purge": { label: "Selfie cleanup", everyMinutes: DAILY },
  "quiet-session-alerts": { label: "Quiet session alerts", everyMinutes: 30 },
  "evidence-purge": { label: "Screenshot proof cleanup", everyMinutes: DAILY },
  "jibble-mirror": { label: "Sending clock calls to Jibble", everyMinutes: 15 },
  "jibble-repair": { label: "Jibble repair", everyMinutes: 30 },
  "jibble-people-sync": { label: "Matching people to Jibble", everyMinutes: DAILY },
  "jibble-unmatched": { label: "Unmatched Jibble people report", everyMinutes: DAILY },
  "jibble-comparison": { label: "Nightly Jibble comparison", everyMinutes: DAILY },
  "extra-hours-reminders": { label: "Extra hours reminders", everyMinutes: 60 },
  "extra-hours-weekly": { label: "Weekly extra hours notice", everyMinutes: WEEKLY },
  "approval-reminders": { label: "Hours approval reminders", everyMinutes: WEEKLY },
  "approval-summary": { label: "Hours approval summary for HR", everyMinutes: WEEKLY },
  "health-check": { label: "Health check", everyMinutes: 60 },
  "analytics-nightly": { label: "Nightly People analytics summaries", everyMinutes: DAILY },
};

export type JobState = "ok" | "late" | "failing" | "waiting";

/** ok = succeeded in time; late = has not succeeded for too long; failing = the last run failed (and it is not yet late); waiting = never run yet. */
export function jobState(input: { everyMinutes: number; lastSuccessMs: number | null; lastErrorMs: number | null; nowMs: number }): JobState {
  const allowed = input.everyMinutes * 2.5 + 5; // minutes
  if (input.lastSuccessMs === null) return input.lastErrorMs !== null ? "failing" : "waiting";
  if (input.nowMs - input.lastSuccessMs > allowed * 60_000) return "late";
  if (input.lastErrorMs !== null && input.lastErrorMs > input.lastSuccessMs) return "failing";
  return "ok";
}

/**
 * Whether a cron request is the host's own scheduler: it sends "Authorization: Bearer <CRON_SECRET>". Compared in constant time.
 * Without a secret configured nobody is let in.
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
