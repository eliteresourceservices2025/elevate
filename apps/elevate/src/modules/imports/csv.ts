// A small, strict CSV reader (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes). No database, no dependencies.

export const MAX_ROWS = 2000;
export const MAX_COLUMNS = 120;
export const MAX_CSV_BYTES = 2 * 1024 * 1024;

export type ParsedCsv = { headers: string[]; rows: Record<string, string>[] } | { error: string };

function readRecords(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- numeric index into the text
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (quoted) throw new Error("A quoted value is never closed");
  if (cur !== "" || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** Headers plus one record per non-empty line, keyed by header. Values are trimmed. A header may appear only once. */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  if (text.length > MAX_CSV_BYTES) return { error: "The file is larger than 2 MB." };
  let records: string[][];
  try {
    records = readRecords(text);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "The file could not be read." };
  }
  return tableFromRecords(records);
}

/** The same checks for any source of rows (a CSV, or the first sheet of a spreadsheet): the first row is the headers. */
export function tableFromRecords(records: string[][]): ParsedCsv {
  const first = records[0];
  if (!first || first.every((h) => h.trim() === "")) return { error: "The file is empty." };
  const headers = first.map((h) => h.trim());
  if (headers.length > MAX_COLUMNS) return { error: `The file has more than ${MAX_COLUMNS} columns.` };
  if (headers.some((h) => h === "")) return { error: "Every column needs a header." };
  const seen = new Set<string>();
  for (const h of headers) {
    const key = h.toLowerCase();
    if (seen.has(key)) return { error: `The column "${h}" appears twice.` };
    seen.add(key);
  }
  const body = records.slice(1).filter((r) => r.some((v) => v.trim() !== ""));
  if (body.length === 0) return { error: "The file has headers but no rows." };
  if (body.length > MAX_ROWS) return { error: `The file has more than ${MAX_ROWS} rows.` };
  const rows: Record<string, string>[] = [];
  for (const [i, r] of body.entries()) {
    if (r.length > headers.length) return { error: `Row ${i + 2} has more values than there are columns.` };
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      // eslint-disable-next-line security/detect-object-injection -- h is a header from this file; stored in a plain record
      rec[h] = (r[idx] ?? "").trim();
    });
    rows.push(rec);
  }
  return { headers, rows };
}
