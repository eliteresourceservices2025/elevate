import type { CalendarView } from "@/modules/timeoff/request-queries";

export type DayOut = { date: string; label: string; names: string[]; extra: number; count: number; holidays: string[] };

const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** "Today", "Tomorrow", then "Wed, Oct 7". */
export function dayLabel(ymd: string, today: string): string {
  if (ymd === today) return "Today";
  if (ymd === addDays(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${ymd}T12:00:00Z`));
}

/** The months a window of days touches, as "yyyy-MM" (a week can cross the end of a month). */
export function monthsTouched(today: string, days: number): string[] {
  return [...new Set([today.slice(0, 7), addDays(today, days - 1).slice(0, 7)])];
}

/**
 * The next `days` days from calendar views, one row per day: who is out (names, or only a count for views that hide names) and
 * any holiday. Pending requests are left out (they are not leave yet). Weekends are skipped unless something falls on them.
 */
export function weekAhead(views: CalendarView[], today: string, days = 7, maxNames = 4): DayOut[] {
  const entries = views.flatMap((v) => v.entries).filter((e) => !e.pending);
  const holidays = views.flatMap((v) => v.holidays);
  const counts = views.reduce<Record<string, number>>((acc, v) => ({ ...acc, ...v.counts }), {});
  const out: DayOut[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const names = [...new Set(entries.filter((e) => e.startDate <= date && e.endDate >= date).map((e) => e.name))].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line security/detect-object-injection -- date is a yyyy-MM-dd string we built
    const count = names.length > 0 ? names.length : (counts[date] ?? 0);
    const todaysHolidays = [...new Set(holidays.filter((h) => h.date === date).map((h) => `${h.name} (${h.calendar})`))];
    if ((weekday === 0 || weekday === 6) && count === 0 && todaysHolidays.length === 0) continue;
    out.push({ date, label: dayLabel(date, today), names: names.slice(0, maxNames), extra: Math.max(0, names.length - maxNames), count, holidays: todaysHolidays });
  }
  return out;
}
