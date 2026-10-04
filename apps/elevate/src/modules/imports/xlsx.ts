import { readSheet } from "read-excel-file/node";
import { MAX_CSV_BYTES, tableFromRecords, type ParsedCsv } from "./csv";

// Reads the first sheet of an .xlsx export as a table, with the same checks as a CSV. A spreadsheet is a zip file, so before it is opened
// the zip's own table of contents is read and a file that would unpack to far more than it should (a "zip bomb") is refused.

const MAX_UNPACKED_BYTES = 40 * 1024 * 1024;

/** Total unpacked size and entry count from a zip's central directory, or null if it does not look like a zip. */
export function zipSummary(bytes: Uint8Array): { unpacked: number; entries: number } | null {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  let unpacked = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) return null;
    unpacked += view.getUint32(offset + 24, true);
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return { unpacked, entries };
}

const pad = (n: number) => String(n).padStart(2, "0");

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  return String(v).trim();
}

export async function parseXlsx(bytes: Uint8Array): Promise<ParsedCsv> {
  if (bytes.length > MAX_CSV_BYTES) return { error: "The file is larger than 2 MB." };
  const zip = zipSummary(bytes);
  if (!zip) return { error: "That is not a valid .xlsx file." };
  if (zip.unpacked > MAX_UNPACKED_BYTES || zip.entries > 200) return { error: "That spreadsheet is too large to read." };
  let data: unknown[][];
  try {
    data = (await readSheet(Buffer.from(bytes))) as unknown[][];
  } catch {
    return { error: "The spreadsheet could not be read. Save it again as .xlsx or .csv." };
  }
  return tableFromRecords(data.map((row) => row.map(cellText)));
}
