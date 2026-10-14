// Pure helpers for reading an attendance sheet: names, client names and schedule texts. No database, no files.

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Name tokens for matching: lower case, accents and punctuation removed, single-letter initials dropped. */
export function nameTokens(raw: string): string[] {
  return strip(raw)
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^['-]+|['-]+$/g, ""))
    .filter((t) => t.length > 1);
}
export const tokenKey = (tokens: string[]) => [...tokens].sort().join(" ");
/** A client name for comparison: case, accents, punctuation and spacing ignored. */
export const clientKey = (s: string) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type PersonNames = { first: string; middle: string | null; last: string; preferred: string | null };

/** Every spelling of a person's name that a sheet might use, as comparable keys. */
export function employeeKeys(e: PersonNames): Set<string> {
  const keys = new Set<string>();
  const add = (...parts: (string | null | undefined)[]) => {
    const k = tokenKey(nameTokens(parts.filter(Boolean).join(" ")));
    if (k) keys.add(k);
  };
  add(e.first, e.last);
  add(e.first, e.middle, e.last);
  add(e.preferred, e.last);
  add(e.preferred, e.middle, e.last);
  return keys;
}

export const ZONES: Record<string, string> = { AZ: "America/Phoenix", ET: "America/New_York", CT: "America/Chicago", MT: "America/Denver", PT: "America/Los_Angeles" };

const to24 = (raw: string): string => {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(raw.trim());
  if (!m) throw new Error("time");
  return `${String((Number(m[1]) % 12) + (m[3].toLowerCase() === "pm" ? 12 : 0)).padStart(2, "0")}:${m[2]}`;
};

const DAY: Record<string, number> = {
  m: 1, mon: 1, monday: 1, t: 2, tu: 2, tue: 2, tues: 2, tuesday: 2, w: 3, wed: 3, wednesday: 3,
  th: 4, thu: 4, thur: 4, thurs: 4, thursday: 4, r: 4, f: 5, fri: 5, friday: 5, s: 6, sa: 6, sat: 6, saturday: 6, su: 7, sun: 7, sunday: 7,
};
const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const dayNames = (days: number[]) => days.map((d) => DAY_NAMES[d]).join(", ");

/** "T-F", "Mon - Fri", "M,W,F": the working days, or null when the text is not a day pattern. A lone T is read as Tuesday. */
export function parseWeekdays(text: string): number[] | null {
  const t = text.toLowerCase().replace(/\s+/g, "").replace(/[–—]/g, "-");
  const range = /^([a-z]+)-([a-z]+)$/.exec(t);
  if (range && DAY[range[1]] && DAY[range[2]]) {
    const from = DAY[range[1]], to = DAY[range[2]];
    const out: number[] = [];
    for (let d = from; ; d = (d % 7) + 1) {
      out.push(d);
      if (d === to || out.length > 7) break;
    }
    return out;
  }
  const list = t.split(/[,/&]/).filter(Boolean);
  if (list.length > 0 && list.every((x) => DAY[x])) return [...new Set(list.map((x) => DAY[x]))].sort((a, b) => a - b);
  return null;
}

export type ParsedSchedule =
  | { startTime: string; endTime: string; zone: string; weekdays: number[]; pattern: string | null }
  | { error: string };

/** "8:00 am - 5:00 pm AZ", "1:00 pm to 5:00 pm AZ", "5:30 am - 4:30 pm AZ T-F". Anything else is an error with a reason. */
export function parseScheduleText(text: string): ParsedSchedule {
  const m = /^(\d{1,2}:\d{2}\s*(?:am|pm))\s+(?:to|-)\s+(\d{1,2}:\d{2}\s*(?:am|pm))\s+([A-Z]{2})(?:\s+(.+))?$/i.exec(text.replace(/\s+/g, " ").trim());
  if (!m) return { error: "The schedule text is not a shift (for example it says Training)." };
  const zone = ZONES[m[3].toUpperCase()];
  if (!zone) return { error: `Unknown time zone label "${m[3]}".` };
  let weekdays = [1, 2, 3, 4, 5];
  let pattern: string | null = null;
  if (m[4]) {
    const days = parseWeekdays(m[4]);
    if (!days) return { error: `The days "${m[4]}" could not be read.` };
    weekdays = days;
    pattern = m[4];
  }
  try {
    return { startTime: to24(m[1]), endTime: to24(m[2]), zone, weekdays, pattern };
  } catch {
    return { error: "The shift times could not be read." };
  }
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
/** The shift's length in minutes (a shift ending at or before it starts ends the next day). */
export function shiftMinutes(startTime: string, endTime: string): number {
  const d = minutes(endTime) - minutes(startTime);
  return d <= 0 ? d + 1440 : d;
}
/** An unpaid break suggested from the shift length. HR confirms it: the sheet does not say. */
export function suggestedBreak(startTime: string, endTime: string): number {
  const d = shiftMinutes(startTime, endTime);
  return d >= 480 ? 60 : d >= 360 ? 30 : 0;
}
/** Paid hours per week from a shift: (length - break) x working days, to one decimal (the assignment field holds one). */
export function hoursPerWeek(startTime: string, endTime: string, breakMinutes: number, days: number): number {
  return Math.round(((shiftMinutes(startTime, endTime) - breakMinutes) / 60) * days * 10) / 10;
}

/** The key under which a sheet's spelling of a person is remembered. */
export const personKey = (sheetName: string) => tokenKey(nameTokens(sheetName));

// ---- Closest match -------------------------------------------------------------------------------------------------------------

const squash = (s: string) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
const bigrams = (s: string) => {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
  return out;
};

/**
 * How alike two names are, from 0 to 1, ignoring case, accents, punctuation and spacing. "In-House" and "Inhouse Medical" count as
 * close because one holds the other; otherwise the share of letter pairs they have in common.
 */
export function similarity(a: string, b: string): number {
  const x = squash(a), y = squash(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))) return 0.9;
  const bx = bigrams(x), by = bigrams(y);
  let shared = 0;
  for (const [k, n] of bx) shared += Math.min(n, by.get(k) ?? 0);
  const total = [...bx.values()].reduce((s, n) => s + n, 0) + [...by.values()].reduce((s, n) => s + n, 0);
  return total === 0 ? 0 : (2 * shared) / total;
}

/** The one candidate clearly closest to a name, or null (nothing alike enough, or two that are about as close). */
export function closest<T extends { id: string; label: string }>(name: string, candidates: T[], threshold = 0.6): T | null {
  const scored = candidates.map((c) => ({ c, score: similarity(name, c.label) })).sort((p, q) => q.score - p.score);
  const top = scored[0];
  if (!top || top.score < threshold) return null;
  if (scored[1] && scored[1].score >= top.score - 0.08) return null;
  return top.c;
}
