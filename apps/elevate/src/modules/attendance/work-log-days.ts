import { fromZonedTime } from "date-fns-tz";
import { addDays } from "./schedule";

// Pure: puts working stretches into the person's own calendar days (cutting one that crosses midnight in their zone).

export type Stretch = { from: number; to: number };

/** For each date (yyyy-MM-dd) the parts of the stretches that fall in that day in `zone`. Every requested date gets a list, maybe empty. */
export function splitByDay<T extends Stretch>(stretches: readonly T[], dates: readonly string[], zone: string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const date of dates) {
    const start = fromZonedTime(`${date}T00:00:00`, zone).getTime();
    const end = fromZonedTime(`${addDays(date, 1)}T00:00:00`, zone).getTime();
    out[date] = stretches.filter((s) => s.to > start && s.from < end).map((s) => ({ ...s, from: Math.max(s.from, start), to: Math.min(s.to, end) }));
  }
  return out;
}
