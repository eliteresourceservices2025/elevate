// Pure rules for make-up hours (design 2026-11-24). No database and no clock.
//
// A person who was absent or unavailable can ask, BEFORE working it, to make up the time at another hour or day so their hours are not
// short. A lead approves. Time worked inside an approved make-up window is straight time, never extra hours (overtime), and it is counted
// against the missed time it names. Copy says "make-up hours", never "overtime".

const MINUTE = 60_000;
const DAY_MS = 86_400_000;

export const MAKEUP_MIN_MINUTES = 15;
export const MAKEUP_MAX_WINDOW_MINUTES = 960;
export const MAKEUP_DAYS_BACK = 31;
export const MAKEUP_DAYS_AHEAD = 31;
/** A window may start a few minutes before the request is sent (a form left open), but not earlier. */
const START_GRACE_MS = 5 * MINUTE;

/** A problem with a requested make-up window in plain words, or null when it is fine. */
export function checkMakeupWindow(input: { startMs: number; endMs: number; nowMs: number; missedMinutes: number; alreadyMinutes: number }): string | null {
  const { startMs, endMs, nowMs } = input;
  if (endMs <= startMs) return "The end must be after the start.";
  const minutes = Math.round((endMs - startMs) / MINUTE);
  if (minutes < MAKEUP_MIN_MINUTES) return `Ask for at least ${MAKEUP_MIN_MINUTES} minutes.`;
  if (minutes > MAKEUP_MAX_WINDOW_MINUTES) return "A make-up window can be 16 hours at most.";
  if (startMs < nowMs - START_GRACE_MS) return "Make-up hours are asked for before they are worked. Choose a time that has not started.";
  if (startMs > nowMs + MAKEUP_DAYS_AHEAD * DAY_MS) return `Choose a time within the next ${MAKEUP_DAYS_AHEAD} days.`;
  const left = input.missedMinutes - input.alreadyMinutes;
  if (left <= 0) return "You have already asked to make up all of that day.";
  if (minutes > left) return `That is more than the ${left} minutes you still have to make up for that day.`;
  return null;
}

/** What a day's schedule asked for that was not worked, in minutes (never negative; zero without a schedule). */
export function shortfallMinutes(scheduledMinutes: number | null, workedMinutes: number): number {
  if (scheduledMinutes === null) return 0;
  return Math.max(0, scheduledMinutes - workedMinutes);
}

/** The day being made up for must have passed and be recent (yyyy-MM-dd strings, in the person's own zone). */
export function absenceDateProblem(absenceDate: string, today: string): string | null {
  if (absenceDate >= today) return "Choose a day that has already passed.";
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${absenceDate}T00:00:00Z`)) / DAY_MS);
  if (days > MAKEUP_DAYS_BACK) return `Make-up hours can only cover the last ${MAKEUP_DAYS_BACK} days.`;
  return null;
}
