// Pure pay period rules for the hours export. Dates are yyyy-MM-dd; nothing here reads a clock.
// ELEVATE does not compute pay: it cuts hours into the periods HR's payroll uses and exports them.

export type PayPeriodKind = "semi_monthly" | "weekly" | "biweekly" | "monthly";
export type PayPeriod = { start: string; end: string; label: string };

const DAY_MS = 86_400_000;
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);
const format = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => format(parse(date) + n * DAY_MS);
const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const label = (start: string, end: string) => {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sd}-${ed}, ${sy}`;
  return `${MONTHS[sm - 1]} ${sd}, ${sy} - ${MONTHS[em - 1]} ${ed}, ${ey}`;
};

/** The Monday on or before a date. */
export const mondayOf = (date: string) => addDays(date, -((new Date(parse(date)).getUTCDay() + 6) % 7));

/** The pay period that contains a date. For every-two-weeks periods, anchor is a Monday a period starts on. */
export function periodContaining(kind: PayPeriodKind, date: string, anchor = "2026-01-05"): PayPeriod {
  const [y, m, d] = date.split("-").map(Number);
  let start: string;
  let end: string;
  if (kind === "semi_monthly") {
    const firstHalf = d <= 15;
    start = `${y}-${pad(m)}-${firstHalf ? "01" : "16"}`;
    end = firstHalf ? `${y}-${pad(m)}-15` : `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
  } else if (kind === "monthly") {
    start = `${y}-${pad(m)}-01`;
    end = `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
  } else if (kind === "weekly") {
    start = mondayOf(date);
    end = addDays(start, 6);
  } else {
    const blocks = Math.floor((parse(date) - parse(anchor)) / (14 * DAY_MS));
    start = format(parse(anchor) + blocks * 14 * DAY_MS);
    end = addDays(start, 13);
  }
  return { start, end, label: label(start, end) };
}

/** The current period and the ones before it, newest first. */
export function recentPeriods(kind: PayPeriodKind, today: string, count: number, anchor = "2026-01-05"): PayPeriod[] {
  const out: PayPeriod[] = [];
  let cursor = today;
  for (let i = 0; i < count; i++) {
    const p = periodContaining(kind, cursor, anchor);
    out.push(p);
    cursor = addDays(p.start, -1);
  }
  return out;
}

export const PAY_PERIOD_LABELS: Record<PayPeriodKind, string> = {
  semi_monthly: "Twice a month (1st-15th and 16th-end)",
  weekly: "Every week (Monday to Sunday)",
  biweekly: "Every two weeks",
  monthly: "Once a month",
};

/** Hours with two decimals for a payroll spreadsheet. */
export const toHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;
