// Expiry rules. Pure. Dates are date-only strings (YYYY-MM-DD) compared in the company time zone,
// so "today" is passed in by the caller.

export type ExpiryStatus = "none" | "valid" | "expiring" | "expired";

export const EXPIRING_WITHIN_DAYS = 30;
/** Reminder thresholds in days before expiry; 0 is the expiry day itself. Newest (most urgent) last. */
export const REMINDER_THRESHOLDS = [30, 7, 0] as const;
export type ReminderThreshold = (typeof REMINDER_THRESHOLDS)[number];

const DAY_MS = 86_400_000;

/** Whole days from `today` to `expiresOn`. Negative once expired. */
export function daysUntil(expiresOn: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${expiresOn}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

export function expiryStatus(expiresOn: string | null | undefined, today: string): ExpiryStatus {
  if (!expiresOn) return "none";
  const d = daysUntil(expiresOn, today);
  if (d < 0) return "expired";
  return d <= EXPIRING_WITHIN_DAYS ? "expiring" : "valid";
}

export type ReminderDecision = {
  /** The one reminder to send now (the most urgent threshold that is due), or null. */
  send: ReminderThreshold | null;
  /** Every due threshold to record as handled, so earlier ones are not sent later. */
  record: ReminderThreshold[];
};

/**
 * Which reminder, if any, is due. Safe to call every day and robust to missed days:
 * a document uploaded with 5 days left is due at both 30 and 7, but only the 7-day reminder is sent.
 */
export function dueReminder(expiresOn: string, today: string, alreadySent: ReadonlySet<number>): ReminderDecision {
  const left = daysUntil(expiresOn, today);
  const due = REMINDER_THRESHOLDS.filter((t) => left <= t && !alreadySent.has(t));
  if (due.length === 0) return { send: null, record: [] };
  return { send: due[due.length - 1], record: due };
}

/** A sentence for notifications and lists. */
export function describeExpiry(expiresOn: string, today: string): string {
  const d = daysUntil(expiresOn, today);
  if (d < 0) return `expired ${-d} ${-d === 1 ? "day" : "days"} ago`;
  if (d === 0) return "expires today";
  return `expires in ${d} ${d === 1 ? "day" : "days"}`;
}
