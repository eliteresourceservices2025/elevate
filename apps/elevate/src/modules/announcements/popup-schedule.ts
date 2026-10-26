import { fromZonedTime } from "date-fns-tz";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";

/** A date-only popup starts at midnight on the company calendar, rather than the browser's local midnight. */
export function popupStartsAt(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = fromZonedTime(`${day}T00:00:00`, DEFAULT_TIMEZONE);
  if (Number.isNaN(at.getTime()) || formatInZone(at, DEFAULT_TIMEZONE, "yyyy-MM-dd") !== day) return null;
  return at;
}
