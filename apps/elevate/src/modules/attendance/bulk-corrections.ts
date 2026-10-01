// Pure reading of an HR spreadsheet of missing clock events (for an outage or a lot of people at once). No database, no clock.
// Columns: email, type, time (and an optional note that is ignored). Times are local to the zone HR picks.

import type { ClockType } from "./clock";

export const MAX_BULK_ROWS = 500;

export type BulkRow = { line: number; email: string; type: ClockType; /** yyyy-MM-ddTHH:mm in the chosen zone. */ time: string };
export type BulkParse = { rows: BulkRow[]; errors: { line: number; message: string }[] };

const TYPES = new Map<string, ClockType>([
  ["clock_in", "clock_in"], ["clock in", "clock_in"], ["clock-in", "clock_in"], ["in", "clock_in"], ["start", "clock_in"],
  ["clock_out", "clock_out"], ["clock out", "clock_out"], ["clock-out", "clock_out"], ["out", "clock_out"], ["end", "clock_out"],
  ["break_start", "break_start"], ["break start", "break_start"], ["start break", "break_start"], ["break_in", "break_start"],
  ["break_end", "break_end"], ["break end", "break_end"], ["end break", "break_end"], ["break_out", "break_end"],
]);

/** Splits one CSV line, honoring double quotes ("a, b" and "" for a quote). */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    if (quoted) {
      if (c === '"' && line.charAt(i + 1) === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  out.push(cell.trim());
  return out;
}

/** "2026-10-05 21:30", "2026-10-05T21:30" or with seconds, to "2026-10-05T21:30"; null when it is not a real date and time. */
export function normalizeTime(value: string): string | null {
  const pieces = value.trim().split(/[ T]/);
  if (pieces.length !== 2) return null;
  const dateParts = pieces[0].split("-");
  const timeParts = pieces[1].split(":");
  if (dateParts.length !== 3 || (timeParts.length !== 2 && timeParts.length !== 3)) return null;
  if (!/^\d{4}$/.test(dateParts[0]) || !/^\d{2}$/.test(dateParts[1]) || !/^\d{2}$/.test(dateParts[2]) || !/^\d{1,2}$/.test(timeParts[0]) || !/^\d{2}$/.test(timeParts[1]) || (timeParts.length === 3 && !/^\d{2}$/.test(timeParts[2]))) return null;
  const [y, mo, d] = dateParts;
  const [h, mi] = timeParts;
  const hour = Number(h);
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (hour > 23 || Number(mi) > 59 || date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${mo}-${d}T${String(hour).padStart(2, "0")}:${mi}`;
}

/** Reads the text of a CSV file: a header row naming email, type and time, then one event per row. */
export function parseCorrectionsCsv(text: string): BulkParse {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const errors: BulkParse["errors"] = [];
  const rows: BulkRow[] = [];
  const headerAt = lines.findIndex((l) => l.trim() !== "");
  if (headerAt < 0) return { rows, errors: [{ line: 1, message: "The file is empty." }] };
  const header = splitCsvLine(lines.at(headerAt) ?? "").map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const [ei, ti, tmi] = [col("email"), col("type"), col("time")];
  if (ei < 0 || ti < 0 || tmi < 0) return { rows, errors: [{ line: headerAt + 1, message: "The first row must name the columns: email, type, time." }] };

  for (let i = headerAt + 1; i < lines.length; i++) {
    const text = lines.at(i) ?? "";
    if (text.trim() === "") continue;
    const cells = splitCsvLine(text);
    const line = i + 1;
    const email = (cells.at(ei) ?? "").toLowerCase();
    const rawType = cells.at(ti) ?? "";
    const rawTime = cells.at(tmi) ?? "";
    const type = TYPES.get(rawType.toLowerCase());
    const time = normalizeTime(rawTime);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push({ line, message: "That is not an email address." });
    else if (!type) errors.push({ line, message: `Unknown type "${rawType}". Use clock_in, clock_out, break_start or break_end.` });
    else if (!time) errors.push({ line, message: `"${rawTime}" is not a date and time like 2026-10-05 21:30.` });
    else if (rows.length >= MAX_BULK_ROWS) {
      errors.push({ line, message: `Only ${MAX_BULK_ROWS} rows at a time.` });
      break;
    } else rows.push({ line, email, type, time });
  }
  return { rows, errors };
}

/** Rows grouped by person, in time order. */
export function groupByPerson(rows: readonly BulkRow[]): Map<string, BulkRow[]> {
  const out = new Map<string, BulkRow[]>();
  for (const r of rows) out.set(r.email, [...(out.get(r.email) ?? []), r]);
  for (const list of out.values()) list.sort((a, b) => a.time.localeCompare(b.time));
  return out;
}
