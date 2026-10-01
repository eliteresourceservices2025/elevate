// Pure working-day rules. A working day is a day the person works (the weekdays of their schedule, or Monday to Friday when
// they have none) that is not a public holiday. Dates are yyyy-MM-dd on the company calendar; nothing here reads a clock.

const DAY_MS = 86_400_000;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const isWeekday = (date: string) => {
  const day = new Date(parse(date)).getUTCDay();
  return day !== 0 && day !== 6;
};

/** Every date from start to end, inclusive. Empty when end is before start. */
export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let ms = parse(start); ms <= parse(end); ms += DAY_MS) out.push(format(ms));
  return out;
}

/** `weekdays` are JavaScript weekdays (0 = Sunday) the person works; leave it out for Monday to Friday. */
export const isWorkingDay = (date: string, holidays: ReadonlySet<string>, weekdays?: ReadonlySet<number>) =>
  (weekdays ? weekdays.has(new Date(parse(date)).getUTCDay()) : isWeekday(date)) && !holidays.has(date);

/** The working days inside a range. */
export function workingDaysIn(start: string, end: string, holidays: ReadonlySet<string>, weekdays?: ReadonlySet<number>): string[] {
  return eachDate(start, end).filter((d) => isWorkingDay(d, holidays, weekdays));
}

/** Days a request uses: its working days, or half a day for a half-day request on a single working day. */
export function requestDays(start: string, end: string, halfDay: boolean, holidays: ReadonlySet<string>, weekdays?: ReadonlySet<number>): number {
  const count = workingDaysIn(start, end, holidays, weekdays).length;
  if (halfDay) return start === end && count === 1 ? 0.5 : 0;
  return count;
}

/** Working days that have passed after `from`, up to and including `to`. Used for reminder and escalation timing. */
export function workingDaysBetween(from: string, to: string, holidays: ReadonlySet<string> = new Set()): number {
  if (to <= from) return 0;
  return eachDate(format(parse(from) + DAY_MS), to).filter((d) => isWorkingDay(d, holidays)).length;
}
