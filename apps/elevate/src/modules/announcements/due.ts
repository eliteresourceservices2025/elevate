// Pure date rules for acknowledgment due dates. Dates are yyyy-MM-dd on the company calendar.

const DAY_MS = 86_400_000;

/** Whole days from `today` to `dueOn`: positive = days left, 0 = due today, negative = days overdue. */
export function daysUntil(dueOn: string, today: string): number {
  return Math.round((Date.parse(`${dueOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export type DueState = "none" | "upcoming" | "soon" | "today" | "overdue";

/** "soon" = within 3 days. Used for badges and banner colour. */
export function dueState(dueOn: string | null, today: string): DueState {
  if (!dueOn) return "none";
  const d = daysUntil(dueOn, today);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  return d <= 3 ? "soon" : "upcoming";
}

/**
 * The scheduled reminder days: 3 days before, the due date, then once a week while overdue.
 * The daily job asks this for every open item; each item and day is recorded once.
 */
export function reminderDue(dueOn: string, today: string): boolean {
  const d = daysUntil(dueOn, today);
  return d === 3 || d === 0 || (d < 0 && -d % 7 === 0);
}

export function describeDue(dueOn: string | null, today: string): string {
  if (!dueOn) return "No due date";
  const d = daysUntil(dueOn, today);
  if (d < 0) return `${-d} ${-d === 1 ? "day" : "days"} overdue`;
  if (d === 0) return "Due today";
  return d === 1 ? "Due tomorrow" : `Due in ${d} days`;
}
