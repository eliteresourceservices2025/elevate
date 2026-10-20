import { z } from "zod";

// Nager.Date (https://date.nager.at, free, no key) as a source of public holidays. Pure: no database and no
// server-only import, so it is unit tested with a fixture. Only a year and a country code ever leave ELEVATE.

export type HolidayCalendarCode = "PH" | "US";
export type HolidayKindCode = "regular" | "special_non_working" | "special_working" | "federal" | "observed" | "other";
export type HolidayCandidate = { calendar: HolidayCalendarCode; date: string; name: string; kind: HolidayKindCode; verified: boolean };

const nagerRow = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  name: z.string().trim().min(1).max(120),
  global: z.boolean().optional(),
  types: z.array(z.string()).optional(),
});

// Nager does not say which Philippine days are "regular" and which are "special non-working", so we know the
// standing ones by name. Anything else (a day proclaimed that year, Eid'l Fitr, local days) is "other" and HR classifies it.
const PH_REGULAR = ["new year's day", "maundy thursday", "good friday", "day of valor", "labour day", "labor day", "independence day", "national heroes day", "bonifacio day", "christmas day", "rizal day"];
const PH_SPECIAL = ["chinese new year", "holy saturday", "black saturday", "ninoy aquino day", "all saints' day", "immaculate conception", "christmas eve", "last day of the year"];

export function phKind(name: string): HolidayKindCode {
  const n = name.toLowerCase();
  if (PH_REGULAR.includes(n)) return "regular";
  if (PH_SPECIAL.some((s) => n.includes(s))) return "special_non_working";
  return "other";
}

/**
 * The holidays worth adding from one Nager response. US: only nationwide Public or Bank days (state-only, school
 * and observance days are skipped), saved as checked. PH: everything Nager lists, saved as NOT checked, because the
 * government proclaims each year's list and moving dates separately and Nager can be late or miss some.
 * Rows that do not look right are dropped one by one, never the whole response.
 */
export function mapNagerHolidays(calendar: HolidayCalendarCode, json: unknown): HolidayCandidate[] {
  if (!Array.isArray(json)) return [];
  const seen = new Set<string>();
  const out: HolidayCandidate[] = [];
  for (const raw of json) {
    const parsed = nagerRow.safeParse(raw);
    if (!parsed.success) continue;
    const { date, name, global, types } = parsed.data;
    if (calendar === "US" && !(global === true && (types ?? []).some((t) => t === "Public" || t === "Bank"))) continue;
    if (seen.has(date)) continue; // one row per day
    seen.add(date);
    out.push(calendar === "US" ? { calendar, date, name, kind: "federal", verified: true } : { calendar, date, name, kind: phKind(name), verified: false });
  }
  return out;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** One year of one calendar. Throws a short message (status only) when Nager is unreachable or refuses. */
export async function fetchNagerYear(year: number, calendar: HolidayCalendarCode, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<HolidayCandidate[]> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("That year is not supported.");
  const response = await fetchImpl(`https://date.nager.at/api/v3/PublicHolidays/${year}/${calendar}`, { signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Nager.Date refused the request (HTTP ${response.status})`);
  return mapNagerHolidays(calendar, await response.json());
}
