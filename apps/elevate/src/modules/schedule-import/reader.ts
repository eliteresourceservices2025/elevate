// Reads an attendance sheet (already split into rows of cells by the CSV or Excel reader) into observations: one per person per day,
// with the client and the schedule text HR wrote. Two layouts: "day blocks" (a date line, a header line, then one row per person,
// repeated per day: HR's current sheet) and a plain table with a row per person. Pure.

export type Observation = { date: string | null; name: string; client: string; schedule: string; row: number };
export type Layout = "day_blocks" | "table";
export type TableColumns = { name: number; client: number; schedule: number; date: number | null; clockIn: number | null };
export type ReadResult = { observations: Observation[]; skipped: { training: number; noClockIn: number }; problems: string[] };

export const MAX_OBSERVATIONS = 2000;

const TIME = /^\d{1,2}:\d{2}\s*[ap]m$/i;

function isoDate(cell: string): string | null {
  const c = cell.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(c);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return validDate(year, m[1], m[2]);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c);
  return m ? validDate(m[1], m[2], m[3]) : null;
}
function validDate(y: string, mo: string, d: string): string | null {
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const t = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso ? null : iso;
}

const norm = (s: string) => s.trim().toLowerCase();
const isHeader = (row: string[]) => row.some((c) => norm(c) === "name") && row.some((c) => norm(c) === "client");
const firstFilled = (row: string[]) => row.find((c) => c.trim() !== "") ?? "";

export function detectLayout(records: string[][]): Layout {
  let blocks = 0;
  for (let i = 0; i < records.length - 1 && blocks < 2; i++) {
    const lead = firstFilled(records[i]);
    if (isoDate(lead) && records[i].filter((c) => c.trim() !== "").length <= 2 && (isHeader(records[i + 1]) || (records[i + 2] && isHeader(records[i + 2])))) blocks += 1;
  }
  return blocks >= 1 ? "day_blocks" : "table";
}

export function guessTableColumns(headers: string[]): Partial<TableColumns> {
  const find = (...names: string[]) => {
    const i = headers.findIndex((h) => names.includes(norm(h)));
    return i >= 0 ? i : undefined;
  };
  return {
    name: find("name", "employee", "employee name", "full name", "va"),
    client: find("client", "client name", "account"),
    schedule: find("schedule", "shift", "schedule text"),
    date: find("date", "day"),
    clockIn: find("in", "time in", "clock in", "clock-in"),
  };
}

export function readDayBlocks(records: string[][]): ReadResult {
  const observations: Observation[] = [];
  const skipped = { training: 0, noClockIn: 0 };
  const problems: string[] = [];
  let date: string | null = null;
  let cols: { name: number; client: number; schedule: number; clockIn: number | null } | null = null;

  for (const [i, row] of records.entries()) {
    const line = i + 1;
    if (row.every((c) => c.trim() === "")) continue;
    const lead = firstFilled(row);
    const asDate = row.filter((c) => c.trim() !== "").length <= 2 ? isoDate(lead) : null;
    if (asDate) {
      date = asDate;
      cols = null;
      continue;
    }
    if (isHeader(row)) {
      const idx = (n: string[]) => row.findIndex((c) => n.includes(norm(c)));
      const name = idx(["name"]), client = idx(["client"]), schedule = idx(["schedule"]), clockIn = idx(["in", "time in", "clock in"]);
      if (schedule < 0) {
        problems.push(`Row ${line}: the header has no Schedule column.`);
        cols = null;
      } else cols = { name, client, schedule, clockIn: clockIn >= 0 ? clockIn : null };
      continue;
    }
    if (!cols || !date) {
      problems.push(`Row ${line}: a person row appears before a date and header.`);
      continue;
    }
    const name = (row[cols.name] ?? "").trim();
    if (!name) continue;
    const client = (row[cols.client] ?? "").trim();
    const schedule = (row[cols.schedule] ?? "").trim();
    if (schedule.toLowerCase() === "training") {
      skipped.training += 1;
      continue;
    }
    if (cols.clockIn !== null && !TIME.test((row[cols.clockIn] ?? "").trim())) {
      skipped.noClockIn += 1;
      continue;
    }
    if (!client || !schedule) {
      problems.push(`Row ${line}: a person is missing the client or the schedule.`);
      continue;
    }
    observations.push({ date, name, client, schedule, row: line });
    if (observations.length > MAX_OBSERVATIONS) return { observations: [], skipped, problems: ["The sheet has more than 2,000 days of data."] };
  }
  return { observations, skipped, problems };
}

export function readTable(records: string[][], columns: TableColumns): ReadResult {
  const observations: Observation[] = [];
  const skipped = { training: 0, noClockIn: 0 };
  const problems: string[] = [];
  for (const [i, row] of records.slice(1).entries()) {
    const line = i + 2;
    if (row.every((c) => c.trim() === "")) continue;
    const name = (row[columns.name] ?? "").trim();
    if (!name) continue;
    const client = (row[columns.client] ?? "").trim();
    const schedule = (row[columns.schedule] ?? "").trim();
    if (schedule.toLowerCase() === "training") {
      skipped.training += 1;
      continue;
    }
    if (columns.clockIn !== null && !TIME.test((row[columns.clockIn] ?? "").trim())) {
      skipped.noClockIn += 1;
      continue;
    }
    if (!client || !schedule) {
      problems.push(`Row ${line}: a person is missing the client or the schedule.`);
      continue;
    }
    const date = columns.date === null ? null : isoDate(row[columns.date] ?? "");
    if (columns.date !== null && !date) {
      problems.push(`Row ${line}: the date could not be read.`);
      continue;
    }
    observations.push({ date, name, client, schedule, row: line });
    if (observations.length > MAX_OBSERVATIONS) return { observations: [], skipped, problems: ["The sheet has more than 2,000 rows of data."] };
  }
  return { observations, skipped, problems };
}
