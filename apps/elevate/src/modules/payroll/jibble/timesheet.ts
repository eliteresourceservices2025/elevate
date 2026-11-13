import { readXlsxSheets, XlsxError, type Cell, type Sheet } from "./xlsx";

// Reads the Jibble "Custom Timesheets" export: one sheet per member, each with a daily table (payroll hours, regular hours and the overtime
// kinds). Only the totals ELEVATE needs are kept (never first-in or last-out times, breaks, screenshots or location). Pure: no database.

export const TIMESHEET_COLUMNS = {
  payroll: "PAYROLL HRS",
  regular: "REG. HRS",
  dailyOt: "DAILY OT",
  doubleOt: "DOUBLE OT",
  restDayOt: "REST DAY OT",
  weeklyOt: "WEEKLY OT",
  holidayOt: "PUBLIC HOLIDAY OT",
  pto: "PTO",
} as const;
type Column = keyof typeof TIMESHEET_COLUMNS;

export type TimesheetDay = { date: string } & Record<Column, number>;
export type TimesheetMember = {
  /** The member code in Jibble, for example "AVL-1". Identifies the member when names differ. */
  code: string;
  name: string;
  days: TimesheetDay[];
};
export type Timesheet = {
  /** Sheets that were not a member sheet (team summary, raw data) or repeated a member already read. Older uploads do not have it. */
  skippedSheets?: number;
  /** Columns (other than Payroll Hrs) that no member sheet had: their amounts are counted as zero, so the Preparer is told. */
  missingColumns?: string[];
  /** The period text printed on the sheet, for example "01 November 2026 - 09 November 2026". */
  periodText: string | null;
  members: TimesheetMember[];
};

export type MemberTotals = Record<Column, number> & { days: number };

const text = (c: Cell | undefined): string => (c === null || c === undefined ? "" : String(c).trim());

/** "8h 06m" -> 486, "0h 00m" -> 0, "-" or blank -> 0. */
export function minutesOf(value: Cell | undefined): number {
  return parseMinutes(value) ?? 0;
}

/** Like `minutesOf`, but null for a value that is not blank, "-" or a recognised time (so it can be refused, never counted as zero). */
export function parseMinutes(value: Cell | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const t = text(value).toLowerCase();
  if (t === "" || t === "-" || t === "--") return 0;
  const m = /^(?:(\d{1,4})\s*h)?\s*(?:(\d{1,2})\s*m)?$/.exec(t);
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}

/** An Excel date serial (days since 1899-12-30) or an ISO date as "YYYY-MM-DD"; null when it is neither. */
export function dateOf(value: Cell | undefined): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 20_000 || value > 80_000) return null;
    return new Date(Math.round((Math.floor(value) - 25_569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const t = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/** One member sheet, or null when the sheet is not one (the team summary, raw sheets). */
function memberOf(sheet: Sheet): { member: TimesheetMember; missing: Column[] } | null {
  let name = "";
  let code = "";
  let header = -1;
  for (let i = 0; i < Math.min(sheet.rows.length, 30); i++) {
    const row = sheet.rows[i];
    const first = text(row[0]).toLowerCase();
    if (first === "member") name = text(row[1]);
    else if (first === "code") code = text(row[1]);
    else if (first === "date" && row.some((c) => text(c).toUpperCase() === TIMESHEET_COLUMNS.payroll)) {
      header = i;
      break;
    }
  }
  if (header < 0 || name === "" || code === "") return null;

  const at = {} as Record<Column, number>;
  for (const key of Object.keys(TIMESHEET_COLUMNS) as Column[]) at[key] = sheet.rows[header].findIndex((c) => text(c).toUpperCase() === TIMESHEET_COLUMNS[key]);
  if (at.payroll < 0) return null;

  const days: TimesheetDay[] = [];
  for (const row of sheet.rows.slice(header + 1)) {
    const date = dateOf(row[0]);
    if (date === null) continue; // a totals row or a blank one
    const day = { date } as TimesheetDay;
    for (const key of Object.keys(at) as Column[]) {
      if (at[key] < 0) {
        day[key] = 0;
        continue;
      }
      const minutes = parseMinutes(row[at[key]]);
      if (minutes === null) throw new XlsxError(`The sheet for ${name.slice(0, 60)} has a value in the ${TIMESHEET_COLUMNS[key]} column on ${date} that ELEVATE can't read (it should look like 8h 06m). Fix it in Jibble and export again.`);
      day[key] = minutes;
    }
    days.push(day);
  }
  const missing = (Object.keys(at) as Column[]).filter((k) => at[k] < 0);
  return { member: { code: code.slice(0, 40), name: name.slice(0, 120), days }, missing };
}

/** Reads a Jibble timesheet workbook. Throws XlsxError with a plain message when it is not one. */
export function readJibbleTimesheet(bytes: Uint8Array): Timesheet {
  const sheets = readXlsxSheets(bytes);
  const members: TimesheetMember[] = [];
  const seen = new Set<string>();
  let periodText: string | null = null;
  let skipped = 0;
  let missingEverywhere: Column[] | null = null;
  for (const sheet of sheets) {
    if (periodText === null) {
      const row = sheet.rows.slice(0, 8).find((r) => text(r[0]).toLowerCase() === "period");
      if (row && text(row[1]) !== "") periodText = text(row[1]).slice(0, 80);
    }
    const read = memberOf(sheet);
    if (!read || seen.has(read.member.code)) {
      skipped += 1;
      continue;
    }
    seen.add(read.member.code);
    members.push(read.member);
    missingEverywhere = missingEverywhere === null ? read.missing : missingEverywhere.filter((k) => read.missing.includes(k));
  }
  if (members.length === 0) throw new XlsxError("That file does not look like a Jibble timesheet export (no member sheets with a Payroll Hrs column were found).");
  return { periodText, members, skippedSheets: skipped, missingColumns: (missingEverywhere ?? []).map((k) => TIMESHEET_COLUMNS[k]) };
}

/** The member's totals in minutes for the days inside [from, to] (inclusive, YYYY-MM-DD). */
export function totalsFor(member: TimesheetMember, from: string, to: string): MemberTotals {
  const totals = { days: 0 } as MemberTotals;
  for (const key of Object.keys(TIMESHEET_COLUMNS) as Column[]) totals[key] = 0;
  for (const d of member.days) {
    if (d.date < from || d.date > to) continue;
    totals.days += 1;
    for (const key of Object.keys(TIMESHEET_COLUMNS) as Column[]) totals[key] += d[key];
  }
  return totals;
}

/** Days of the sheet that fall outside [from, to]: shown to the Preparer so a wrong period is noticed. */
export function daysOutside(timesheet: Timesheet, from: string, to: string): number {
  const dates = new Set<string>();
  for (const m of timesheet.members) for (const d of m.days) if (d.date < from || d.date > to) dates.add(d.date);
  return dates.size;
}

/** What the totals become on a pay line: the items to suggest, in the units the run uses (minutes, day hundredths, hour hundredths). */
export type SuggestedAmounts = {
  client_hours: bigint;
  extra_regular: bigint;
  extra_rest_day: bigint;
  holiday: bigint;
  pto_days: bigint;
};

export function suggestedAmounts(totals: MemberTotals, hoursPerDay: number): SuggestedAmounts {
  return {
    // Hundredths of an hour.
    client_hours: BigInt(Math.round((totals.payroll * 100) / 60)),
    // Daily, double and weekly overtime are paid at the regular overtime percent.
    extra_regular: BigInt(totals.dailyOt + totals.doubleOt + totals.weeklyOt),
    extra_rest_day: BigInt(totals.restDayOt),
    holiday: BigInt(totals.holidayOt),
    // Hundredths of a day: PTO hours divided by the person's hours per day.
    pto_days: BigInt(Math.round((totals.pto * 100) / (60 * Math.max(1, hoursPerDay)))),
  };
}
