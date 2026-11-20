// Pure rules for the dashboard's birthday, anniversary and new-joiner tiles. No database here.
// A birthday is only ever a month and a day: nothing in this file returns or keeps the year.

export type Celebrant = { name: string; monthDay: string; label: string; today: boolean; years?: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "11-22" to "Nov 22". */
export function monthDayLabel(monthDay: string): string {
  const [m, d] = monthDay.split("-").map(Number);
  return `${MONTHS[m - 1] ?? "?"} ${d}`;
}

/** The month and day of a yyyy-MM-dd date, or null if it is not one. */
export function monthDayOf(ymd: string | null | undefined): string | null {
  return ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? ymd.slice(5, 10) : null;
}

/** 29 February falls on 28 February in a year that is not a leap year (same rule as the anniversary reminders). */
export function monthDayInYear(monthDay: string, year: number): string {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return monthDay === "02-29" && !leap ? "02-28" : monthDay;
}

/**
 * The people whose birthday falls in the month of `today`, soonest first (today's first of all, earlier days of the month last),
 * with `today` flagged. Only first name and last initial are shown. The year is never kept.
 */
export function birthdaysThisMonth(rows: readonly { first: string; last: string; monthDay: string }[], today: string): Celebrant[] {
  const year = Number(today.slice(0, 4));
  const month = today.slice(5, 7);
  const todayMd = today.slice(5, 10);
  const out: Celebrant[] = [];
  for (const r of rows) {
    const md = /^\d{2}-\d{2}$/.test(r.monthDay) ? r.monthDay : null;
    if (!md) continue;
    const shown = monthDayInYear(md, year);
    if (shown.slice(0, 2) !== month) continue;
    out.push({ name: shortName(r.first, r.last), monthDay: shown, label: monthDayLabel(shown), today: shown === todayMd });
  }
  const upcoming = (c: Celebrant) => (c.monthDay >= todayMd ? 0 : 1);
  return out.sort((a, b) => upcoming(a) - upcoming(b) || a.monthDay.localeCompare(b.monthDay) || a.name.localeCompare(b.name));
}

/** "Maria S." */
export function shortName(first: string, last: string): string {
  const f = first.trim();
  const l = last.trim();
  return l ? `${f} ${l[0].toUpperCase()}.` : f;
}

/** People with a start-date anniversary of one year or more in the month of `today`. */
export function anniversariesThisMonth(rows: readonly { first: string; last: string; startDate: string }[], today: string): Celebrant[] {
  const year = Number(today.slice(0, 4));
  const month = today.slice(5, 7);
  const todayMd = today.slice(5, 10);
  const out: Celebrant[] = [];
  for (const r of rows) {
    const md = monthDayOf(r.startDate);
    if (!md) continue;
    const shown = monthDayInYear(md, year);
    const years = year - Number(r.startDate.slice(0, 4));
    if (shown.slice(0, 2) !== month || years < 1) continue;
    out.push({ name: shortName(r.first, r.last), monthDay: shown, label: monthDayLabel(shown), today: shown === todayMd, years });
  }
  return out.sort((a, b) => a.monthDay.localeCompare(b.monthDay) || a.name.localeCompare(b.name));
}

export type CelebrationRow = { kind: "Bday" | "Anniv" | "New"; name: string; meta: string; today: boolean };

/** The rows of the combined Celebrations tile: two birthdays (today's first), one anniversary, one new joiner. Month and day only, never a year. */
export function celebrationRows(birthdays: readonly Celebrant[], anniversaries: readonly Celebrant[], joiners: readonly { name: string; label: string }[]): CelebrationRow[] {
  const sorted = [...birthdays].sort((a, b) => Number(b.today) - Number(a.today));
  return [
    ...sorted.slice(0, 2).map((c): CelebrationRow => ({ kind: "Bday", name: c.name, meta: c.today ? "Today" : c.label, today: c.today })),
    ...anniversaries.slice(0, 1).map((c): CelebrationRow => ({ kind: "Anniv", name: c.name, meta: c.years === 1 ? "1 year" : `${c.years ?? 0} years`, today: c.today })),
    ...joiners.slice(0, 1).map((j): CelebrationRow => ({ kind: "New", name: j.name, meta: `Started ${j.label}`, today: false })),
  ];
}
