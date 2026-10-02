// Calendar-date helpers on "yyyy-MM-dd" strings. No time zones here: dates are already company-zone calendar dates.

const MS = 86_400_000;
const toMs = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number): string => fromMs(toMs(d) + n * MS);
export const daysBetween = (from: string, to: string): number => Math.round((toMs(to) - toMs(from)) / MS);
export const monthStart = (d: string): string => `${d.slice(0, 7)}-01`;
export const addMonths = (d: string, n: number): string => {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1 + n;
  return fromMs(Date.UTC(y + Math.floor(m / 12), ((m % 12) + 12) % 12, 1));
};
export const monthEnd = (d: string): string => addDays(addMonths(monthStart(d), 1), -1);
/** The Monday of the week containing the date. */
export const weekStart = (d: string): string => addDays(d, -((new Date(toMs(d)).getUTCDay() + 6) % 7));

/** Every date from `from` to `to`, both included (empty when from is after to). */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The first day of every month from the month of `from` through the month of `to`. */
export function eachMonth(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** The Monday of every week from the week of `from` through the week of `to`. */
export function eachWeek(from: string, to: string): string[] {
  const out: string[] = [];
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}

/** The first day of the range that ends at `to` and covers `months` calendar months (the current one counts). */
export const rangeStart = (to: string, months: number): string => addMonths(monthStart(to), -(months - 1));
