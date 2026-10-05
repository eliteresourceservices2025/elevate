export type TrackerCase = {
  id: string;
  name: string;
  position: string | null;
  /** Start date (onboarding) or last working day (offboarding). */
  date: string;
  done: number;
  total: number;
  overdue: number;
  accessRemoved: boolean;
};

export const percentDone = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : 0);

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** "Starts today", "Starts in 3 days", "Started 2 days ago" (onboarding); "Last day today", "Last day in 3 days", "Left 2 days ago" (offboarding). */
export function whenLabel(kind: "onboarding" | "offboarding", date: string, today: string): string {
  const n = days(today, date);
  const unit = (x: number) => `${x} ${x === 1 ? "day" : "days"}`;
  if (kind === "onboarding") return n === 0 ? "Starts today" : n > 0 ? `Starts in ${unit(n)}` : `Started ${unit(-n)} ago`;
  return n === 0 ? "Last day today" : n > 0 ? `Last day in ${unit(n)}` : `Last day was ${unit(-n)} ago`;
}

/** Cases with overdue required tasks first, then the soonest date; at most `limit`. */
export function orderCases(cases: TrackerCase[], limit = 6): TrackerCase[] {
  return [...cases].sort((a, b) => Number(b.overdue > 0) - Number(a.overdue > 0) || a.date.localeCompare(b.date) || a.name.localeCompare(b.name)).slice(0, limit);
}
