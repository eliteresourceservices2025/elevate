// Work anniversaries. Pure: dates are plain "yyyy-MM-dd" strings in the company zone.

/** Days before an anniversary when the reminder first goes out (and the most it can be late by while still "before"). */
export const ANNIVERSARY_LEAD_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, "0");
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

/** The anniversary date in a given year. A 29 February start falls on 28 February in a year with no 29th. */
export function anniversaryIn(startDate: string, year: number): string {
  const [, month, day] = startDate.split("-").map(Number);
  const d = month === 2 && day === 29 && !isLeap(year) ? 28 : day;
  return `${year}-${pad(month)}-${pad(d)}`;
}

export type DueAnniversary = { date: string; years: number; daysAway: number };

/**
 * The anniversary to remind about, or null. It is due from 7 days before until the day before (so a day the job did not run is made
 * up, but nothing is sent on or after the day itself). Only whole years of one or more: the first day is not an anniversary.
 */
export function dueAnniversary(startDate: string | null | undefined, today: string, leadDays = ANNIVERSARY_LEAD_DAYS): DueAnniversary | null {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const startYear = Number(startDate.slice(0, 4));
  const thisYear = Number(today.slice(0, 4));
  // This year's anniversary, or next year's when it has already passed (the window can cross New Year).
  for (const year of [thisYear, thisYear + 1]) {
    const years = year - startYear;
    if (years < 1) continue;
    const date = anniversaryIn(startDate, year);
    const daysAway = dayNumber(date) - dayNumber(today);
    if (daysAway >= 1 && daysAway <= leadDays) return { date, years, daysAway };
  }
  return null;
}

/** "1 year" or "3 years". */
export const yearsText = (years: number): string => `${years} ${years === 1 ? "year" : "years"}`;
