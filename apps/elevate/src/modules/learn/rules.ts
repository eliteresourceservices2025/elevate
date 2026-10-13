// The pure rules behind the nightly Learn jobs (docs/learn/04-course-and-exam.md). No database, so they are cheap to test.

export type Track = "full" | "essentials" | "refresher";

/** New people finish within 30 days of their start; a renewal opens 60 days before the certificate ends. */
export const NEW_HIRE_DAYS = 30;
export const RENEWAL_OPENS_DAYS = 60;
/** People who already work here when training is switched on get this long. */
export const ROLLOUT_GRACE_DAYS = 30;

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const addDays = (iso: string, days: number): string => new Date(ms(iso) + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string): number => Math.round((ms(to) - ms(from)) / DAY);

/** Full for anyone assigned to a client that handles patient information; Essentials for everyone else. */
export const trackFor = (assignedToPhiClient: boolean): Track => (assignedToPhiClient ? "full" : "essentials");

export type AssignmentNeed =
  | { assign: false }
  | { assign: true; reason: "new_hire" | "renewal" | "manual"; track: Track; dueOn: string };

/**
 * Whether a person needs a training assignment today.
 * - an open assignment already exists: nothing
 * - a current certificate (more than 60 days left): nothing
 * - a certificate that ends within 60 days, or has ended: a renewal on the Refresher track, due when it ends (or in 30 days if it already ended)
 * - no certificate: due 30 days after the start date; people who started long ago (training just switched on) get 30 days from today
 */
export function assignmentNeed(input: { today: string; startDate: string | null; openAssignment: boolean; latestCertificateEndsOn: string | null; assignedToPhiClient: boolean }): AssignmentNeed {
  const { today, startDate, openAssignment, latestCertificateEndsOn: ends } = input;
  if (openAssignment) return { assign: false };

  if (ends) {
    const left = daysBetween(today, ends);
    if (left > RENEWAL_OPENS_DAYS) return { assign: false };
    return { assign: true, reason: "renewal", track: "refresher", dueOn: left >= 0 ? ends : addDays(today, ROLLOUT_GRACE_DAYS) };
  }

  const track = trackFor(input.assignedToPhiClient);
  if (startDate && daysBetween(startDate, today) <= NEW_HIRE_DAYS) {
    // started within the last 30 days (or in the future): due 30 days after the start
    return { assign: true, reason: "new_hire", track, dueOn: addDays(startDate, NEW_HIRE_DAYS) };
  }
  return { assign: true, reason: "manual", track, dueOn: addDays(today, ROLLOUT_GRACE_DAYS) };
}

/** The ISO week of a date as "YYYY-Www" (a week starts on Monday), for the weekly overdue notice. */
export function isoWeekKey(iso: string): string {
  const d = new Date(ms(iso));
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day + 3); // the Thursday of this week decides the year
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type ReminderKind = "d30" | "d7" | "d0";

/**
 * The reminder due today for an open assignment, or null. One notice per threshold (30 days, 7 days, the due date); a person already
 * inside a window gets only its most urgent notice, and a threshold is never repeated.
 */
export function reminderDue(dueOn: string, today: string, sent: ReadonlySet<string>): ReminderKind | null {
  const days = daysBetween(today, dueOn);
  const kind: ReminderKind | null = days <= 0 ? "d0" : days <= 7 ? "d7" : days <= 30 ? "d30" : null;
  if (!kind) return null;
  const order: ReminderKind[] = ["d30", "d7", "d0"];
  // already told at this level or a more urgent one
  if (order.slice(order.indexOf(kind)).some((k) => sent.has(k))) return null;
  return kind;
}

export const isOverdue = (dueOn: string, today: string): boolean => daysBetween(today, dueOn) < 0;

export const describeDue = (dueOn: string, today: string): string => {
  const d = daysBetween(today, dueOn);
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  if (d === 0) return "due today";
  return `due in ${d} day${d === 1 ? "" : "s"}`;
};
