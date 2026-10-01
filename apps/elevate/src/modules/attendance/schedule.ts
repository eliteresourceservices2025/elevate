// Pure schedule rules. No database and no clock: schedules and dates in, shifts and minutes out.
//
// A schedule is a dated shift pattern: start and end times and working weekdays in the SCHEDULE's time zone (the client's),
// so a US-hours shift stays 9 to 5 for the client whatever the daylight saving date. A shift belongs to the calendar day it
// STARTS in the PERSON's own zone, the same rule as attendance days, so a night shift worked from Manila is one day.

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { SECONDARY_TIMEZONE } from "@/lib/time";

const DAY_MS = 86_400_000;
const MINUTE = 60_000;

/** ISO weekdays: 1 = Monday ... 7 = Sunday. */
export const WEEKDAYS = [
  { n: 1, short: "Mon", long: "Monday" },
  { n: 2, short: "Tue", long: "Tuesday" },
  { n: 3, short: "Wed", long: "Wednesday" },
  { n: 4, short: "Thu", long: "Thursday" },
  { n: 5, short: "Fri", long: "Friday" },
  { n: 6, short: "Sat", long: "Saturday" },
  { n: 7, short: "Sun", long: "Sunday" },
] as const;

export type ScheduleLite = {
  /** First and last day it applies (yyyy-MM-dd, in the schedule zone); no end = still open. */
  effectiveFrom: string;
  effectiveTo: string | null;
  /** HH:mm in the schedule zone. An end at or before the start means the shift ends the next day. */
  startTime: string;
  endTime: string;
  weekdays: readonly number[];
  /** Planned unpaid break inside the shift. */
  breakMinutes: number;
  zone: string;
};

export type Shift = { date: string; startMs: number; endMs: number; scheduledMinutes: number; schedule: ScheduleLite };

export const isValidTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
export const addDays = (date: string, n: number) => new Date(parse(date) + n * DAY_MS).toISOString().slice(0, 10);
export const isoWeekday = (date: string) => ((new Date(parse(date)).getUTCDay() + 6) % 7) + 1;

/** The schedule in force on a calendar date of the schedule zone (the latest one that started). */
export function scheduleFor(schedules: readonly ScheduleLite[], date: string): ScheduleLite | null {
  let best: ScheduleLite | null = null;
  for (const s of schedules) {
    if (s.effectiveFrom <= date && (s.effectiveTo === null || date <= s.effectiveTo) && (best === null || s.effectiveFrom > best.effectiveFrom)) best = s;
  }
  return best;
}

/** The shift that starts on this calendar day in the person's own zone, or null on a rest day. */
export function shiftOn(schedules: readonly ScheduleLite[], personZone: string, date: string): Shift | null {
  // The schedule zone can be a day ahead of or behind the person, so look a day either side.
  for (const d of [addDays(date, -1), date, addDays(date, 1)]) {
    const s = scheduleFor(schedules, d);
    if (!s || !s.weekdays.includes(isoWeekday(d))) continue;
    const startMs = fromZonedTime(`${d}T${s.startTime}:00`, s.zone).getTime();
    let endMs = fromZonedTime(`${d}T${s.endTime}:00`, s.zone).getTime();
    if (endMs <= startMs) endMs = fromZonedTime(`${addDays(d, 1)}T${s.endTime}:00`, s.zone).getTime();
    if (formatInTimeZone(startMs, personZone, "yyyy-MM-dd") === date) {
      return { date, startMs, endMs, scheduledMinutes: Math.max(0, Math.round((endMs - startMs) / MINUTE) - s.breakMinutes), schedule: s };
    }
  }
  return null;
}

/** Whether the person has any schedule at all in force around this date (so a day with no shift is a rest day, not "unscheduled"). */
export const hasScheduleAround = (schedules: readonly ScheduleLite[], date: string) => [addDays(date, -1), date, addDays(date, 1)].some((d) => scheduleFor(schedules, d) !== null);

/** Minutes late (counted from the shift start) when the first clock-in is later than the grace period; otherwise 0. */
export function lateMinutes(firstInMs: number, shift: Shift, graceMinutes: number): number {
  const late = (firstInMs - shift.startMs) / MINUTE;
  return late > graceMinutes ? Math.round(late) : 0;
}

/** Minutes left before the shift end when the last clock-out is earlier than the grace period allows; otherwise 0. */
export function earlyLeaveMinutes(lastOutMs: number, shift: Shift, graceMinutes: number): number {
  const early = (shift.endMs - lastOutMs) / MINUTE;
  return early > graceMinutes ? Math.round(early) : 0;
}

/** Hours worked beyond the scheduled hours count as extra only past a small threshold. */
export const EXTRA_THRESHOLD_MINUTES = 15;

/**
 * Extra minutes in a day: worked time beyond the scheduled hours. Work on a rest day or a holiday counts in full. People with
 * no schedule at all have no extra (nothing to measure against). Anything under the threshold is ignored.
 */
export function extraMinutes(input: { workedMinutes: number; shift: Shift | null; hasSchedule: boolean; holiday: boolean }, threshold = EXTRA_THRESHOLD_MINUTES): number {
  if (!input.hasSchedule || input.workedMinutes < threshold) return 0;
  if (input.shift === null || input.holiday) return input.workedMinutes;
  const over = input.workedMinutes - input.shift.scheduledMinutes;
  return over >= threshold ? over : 0;
}

/** The weekdays (JavaScript 0 = Sunday ... 6) a person works in their OWN zone, for counting leave days. Uses the shift start mapping. */
export function workingWeekdaysInZone(schedule: ScheduleLite, personZone: string): Set<number> {
  const out = new Set<number>();
  // A reference week around the schedule's start; daylight saving only moves a shift by an hour, never a whole day, for real shifts.
  const base = schedule.effectiveFrom;
  for (let i = 0; i < 7; i++) {
    const d = addDays(base, i);
    if (!schedule.weekdays.includes(isoWeekday(d))) continue;
    const startMs = fromZonedTime(`${d}T${schedule.startTime}:00`, schedule.zone).getTime();
    out.add(new Date(parse(formatInTimeZone(startMs, personZone, "yyyy-MM-dd"))).getUTCDay());
  }
  return out;
}

const to12h = (ms: number, zone: string) => formatInTimeZone(ms, zone, "h:mm a");

/** "9:00 AM - 5:00 PM" in a zone for one shift. */
export const shiftRange = (shift: Shift, zone: string) => `${to12h(shift.startMs, zone)} - ${to12h(shift.endMs, zone)}`;

export const weekdaysLabel = (weekdays: readonly number[]): string => {
  const set = [...new Set(weekdays)].sort((a, b) => a - b);
  if (set.length === 7) return "Every day";
  if (set.join() === "1,2,3,4,5") return "Mon to Fri";
  // A run of consecutive days reads as "Tue to Sat"; anything else is listed.
  const consecutive = set.length > 2 && set.every((n, i) => i === 0 || n === set[i - 1] + 1);
  const short = (n: number) => WEEKDAYS.find((w) => w.n === n)?.short ?? "";
  return consecutive ? `${short(set[0])} to ${short(set[set.length - 1])}` : set.map(short).join(", ");
};

/**
 * One line for a schedule in the client's zone and Manila, for example
 * "Mon to Fri, 9:00 AM - 5:00 PM New York (9:00 PM - 5:00 AM Manila)". Uses the first working day in the reference week.
 */
export function describeSchedule(schedule: ScheduleLite, referenceDate: string, secondaryZone = SECONDARY_TIMEZONE): { days: string; client: string; manila: string; zone: string } {
  const d = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(referenceDate, i)).find((x) => schedule.weekdays.includes(isoWeekday(x))) ?? referenceDate;
  const startMs = fromZonedTime(`${d}T${schedule.startTime}:00`, schedule.zone).getTime();
  let endMs = fromZonedTime(`${d}T${schedule.endTime}:00`, schedule.zone).getTime();
  if (endMs <= startMs) endMs = fromZonedTime(`${addDays(d, 1)}T${schedule.endTime}:00`, schedule.zone).getTime();
  const range = (zone: string) => `${to12h(startMs, zone)} - ${to12h(endMs, zone)}`;
  return { days: weekdaysLabel(schedule.weekdays), client: range(schedule.zone), manila: range(secondaryZone), zone: schedule.zone };
}
