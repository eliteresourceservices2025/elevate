import { formatInTimeZone } from "date-fns-tz";

// Times are stored in UTC and shown in the viewer's zone (CLAUDE.md rule 8).
// Arizona has no daylight saving, so "MST/AZT" is America/Phoenix.
export const DEFAULT_TIMEZONE = "America/Phoenix";
export const SECONDARY_TIMEZONE = "Asia/Manila";

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Return `zone` if valid, otherwise fall back to the default. */
export function resolveTimeZone(zone: string | null | undefined): string {
  return zone && isValidTimeZone(zone) ? zone : DEFAULT_TIMEZONE;
}

export function formatInZone(
  date: Date | string | number,
  zone: string | null | undefined,
  pattern = "MMM d, yyyy h:mm a",
): string {
  return formatInTimeZone(date, resolveTimeZone(zone), pattern);
}

export type DualTime = { primary: string; secondary: string; primaryZone: string; secondaryZone: string };

/**
 * Format one instant in the viewer's zone and a second zone (default Manila),
 * for schedules and the clock, which always show both.
 */
export function formatDual(
  date: Date | string | number,
  options: { zone?: string | null; secondaryZone?: string | null; pattern?: string } = {},
): DualTime {
  const primaryZone = resolveTimeZone(options.zone);
  const secondaryZone =
    options.secondaryZone && isValidTimeZone(options.secondaryZone)
      ? options.secondaryZone
      : SECONDARY_TIMEZONE;
  const pattern = options.pattern ?? "MMM d, yyyy h:mm a";
  return {
    primaryZone,
    secondaryZone,
    primary: formatInTimeZone(date, primaryZone, pattern),
    secondary: formatInTimeZone(date, secondaryZone, pattern),
  };
}

/** Format a date-only value (YYYY-MM-DD) without any time-zone shift, e.g. "Sep 1, 2026". */
export function formatDateOnly(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(d);
}
