import { inflateRawSync } from "node:zlib";

// A small, dependency-free .xlsx reader for the Jibble timesheet export. Jibble writes its workbook as a streamed zip (sizes follow each
// file), which the spreadsheet library the app uses elsewhere cannot open, so this reads the zip's central directory instead. It reads
// only the workbook, its sheet list, the shared strings and the sheets. Everything is bounded (file size, number of parts, unpacked size,
// rows and columns) so a hostile file cannot use much memory or time. Nothing is evaluated: formulas are ignored, values are read as text.

export class XlsxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxError";
  }
}

export const MAX_XLSX_BYTES = 8 * 1024 * 1024;
const MAX_PARTS = 400;
const MAX_PART_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_SHEETS = 200;
const MAX_ROWS = 5_000;
const MAX_COLS = 100;

export type Cell = string | number | null;
export type Sheet = { name: string; rows: Cell[][] };

const WANTED = /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[A-Za-z0-9_-]+\.xml)$/;

/** The parts of the zip that a workbook needs, unpacked. */
function unzip(bytes: Uint8Array): Map<string, Buffer> {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_XLSX_BYTES) throw new XlsxError("That file is not a usable Excel file.");
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("That file is not an Excel (.xlsx) file.");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count > MAX_PARTS) throw new XlsxError("That Excel file has too many parts.");

  const out = new Map<string, Buffer>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) throw new XlsxError("That Excel file is damaged.");
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!WANTED.test(name)) continue;
    if (size > MAX_PART_BYTES || size === 0xffffffff || compressedSize === 0xffffffff) throw new XlsxError("That Excel file is too large to read.");
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw new XlsxError("That Excel file is damaged.");
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (start + compressedSize > buf.length) throw new XlsxError("That Excel file is damaged.");
    const data = buf.subarray(start, start + compressedSize);
    let content: Buffer;
    if (method === 0) content = data;
    else if (method === 8) {
      try {
        content = inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES });
      } catch {
        throw new XlsxError("That Excel file is damaged or too large.");
      }
    } else throw new XlsxError("That Excel file uses a format that can't be read.");
    total += content.length;
    if (total > MAX_TOTAL_BYTES) throw new XlsxError("That Excel file is too large to read.");
    out.set(name, content);
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16) || 32);
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10) || 32);
    return ENTITIES[body] ?? whole;
  });

/**
 * The elements named `tag` in `xml`, in order, found by plain scanning so the time is proportional to the size of the text: a hostile file
 * with thousands of unclosed tags must not make a lazy pattern rescan the rest of the text for each one. An element that is opened and
 * never closed means the file is damaged, and reading stops.
 */
function* elements(xml: string, tag: string): Generator<{ attrs: string; body: string }> {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let i = 0;
  for (;;) {
    const start = xml.indexOf(open, i);
    if (start < 0) return;
    const next = xml.charAt(start + open.length);
    if (next !== " " && next !== ">" && next !== "/" && next !== "\n" && next !== "\r" && next !== "\t") {
      i = start + open.length; // another tag that starts with the same letters (for example <cols> for <c>)
      continue;
    }
    const end = xml.indexOf(">", start);
    if (end < 0) throw new XlsxError("That Excel file is damaged.");
    const head = xml.slice(start + open.length, end);
    if (head.endsWith("/")) {
      yield { attrs: head.slice(0, -1), body: "" };
      i = end + 1;
      continue;
    }
    const closeAt = xml.indexOf(close, end + 1);
    if (closeAt < 0) throw new XlsxError("That Excel file is damaged.");
    yield { attrs: head, body: xml.slice(end + 1, closeAt) };
    i = closeAt + close.length;
  }
}

const textOf = (xml: string): string => [...elements(xml, "t")].map((e) => decode(e.body)).join("");

/** "B12" -> column 1 (zero-based). */
function columnOf(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function parseSheet(xml: string, strings: string[]): Cell[][] {
  const rows: Cell[][] = [];
  for (const row of elements(xml, "row")) {
    if (rows.length >= MAX_ROWS) break;
    const rowNumber = Number(/\br="(\d+)"/.exec(row.attrs)?.[1] ?? rows.length + 1);
    if (rowNumber > MAX_ROWS) break;
    const cells: Cell[] = [];
    for (const cell of elements(row.body, "c")) {
      const col = columnOf(/\br="([A-Z]+\d+)"/.exec(cell.attrs)?.[1] ?? "");
      if (col < 0 || col >= MAX_COLS) continue;
      const type = /\bt="([^"]+)"/.exec(cell.attrs)?.[1];
      let value: Cell = null;
      if (type === "inlineStr") value = textOf(cell.body);
      else {
        const v = [...elements(cell.body, "v")][0]?.body;
        if (v !== undefined) {
          if (type === "s") value = strings[Number(v)] ?? null;
          else if (type === "str" || type === "e" || type === "b") value = decode(v);
          else {
            const num = Number(v);
            value = Number.isFinite(num) ? num : decode(v);
          }
        }
      }
      while (cells.length <= col) cells.push(null);
      cells[col] = value;
    }
    while (rows.length < rowNumber - 1) rows.push([]);
    rows.push(cells);
  }
  return rows;
}

/** Every sheet of the workbook, in order, with its rows as text and numbers. Throws XlsxError for anything that is not a readable workbook. */
export function readXlsxSheets(bytes: Uint8Array): Sheet[] {
  const parts = unzip(bytes);
  const workbook = parts.get("xl/workbook.xml")?.toString("utf8");
  if (!workbook) throw new XlsxError("That file is not an Excel workbook.");
  const rels = parts.get("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const targets = new Map<string, string>();
  for (const r of elements(rels, "Relationship")) {
    const id = /\bId="([^"]+)"/.exec(r.attrs)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(r.attrs)?.[1];
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }
  const sharedXml = parts.get("xl/sharedStrings.xml")?.toString("utf8") ?? "";
  const strings = [...elements(sharedXml, "si")].map((e) => textOf(e.body));

  const sheets: Sheet[] = [];
  for (const s of elements(workbook, "sheet")) {
    if (sheets.length >= MAX_SHEETS) break;
    const name = /\bname="([^"]*)"/.exec(s.attrs)?.[1];
    const rid = /\br:id="([^"]+)"/.exec(s.attrs)?.[1];
    const target = rid ? targets.get(rid) : undefined;
    const xml = target ? parts.get(target)?.toString("utf8") : undefined;
    if (name === undefined || xml === undefined) continue;
    sheets.push({ name: decode(name), rows: parseSheet(xml, strings) });
  }
  if (sheets.length === 0) throw new XlsxError("That Excel file has no sheets.");
  return sheets;
}
