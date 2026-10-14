import { DEFAULT_TIMEZONE, isValidTimeZone } from "./time";

/** Keep valid stored aliases selectable even when they are absent from the canonical IANA list. */
export function clientTimeZones(available: readonly string[], stored: readonly string[] = []): string[] {
  return [...new Set([...available, "UTC", DEFAULT_TIMEZONE, ...stored.filter(isValidTimeZone)])].sort((a, b) => a.localeCompare(b));
}
