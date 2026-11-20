import { deflateRawSync } from "node:zlib";

// Builds .xlsx workbooks for tests, from invented people. `zip` writes a real zip: one entry stored, one deflated, and one in the streamed
// style Jibble uses (sizes after the data, zero in the local header), which is why the app's reader uses the central directory.

type Entry = { name: string; data: Buffer; mode: "stored" | "deflate" | "stream" };

export function zip(entries: Entry[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const packed = e.mode === "stored" ? e.data : deflateRawSync(e.data);
    const method = e.mode === "stored" ? 0 : 8;
    const flags = e.mode === "stream" ? 0x0008 : 0;
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (e.mode !== "stream") {
      local.writeUInt32LE(packed.length, 18);
      local.writeUInt32LE(e.data.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const descriptor = Buffer.alloc(e.mode === "stream" ? 16 : 0);
    if (e.mode === "stream") {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(packed.length, 8);
      descriptor.writeUInt32LE(e.data.length, 12);
    }
    parts.push(local, name, packed, descriptor);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flags, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(e.data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + packed.length + descriptor.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const colName = (i: number) => String.fromCharCode(65 + i);

type Cell = string | number | null;

/** A worksheet from rows of strings and numbers: strings go to the shared table, as Jibble does. */
function sheetXml(rows: Cell[][], strings: string[]): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((v, c) => {
          if (v === null) return "";
          const ref = `${colName(c)}${r + 1}`;
          if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
          let i = strings.indexOf(v);
          if (i < 0) i = strings.push(v) - 1;
          return `<c r="${ref}" t="s"><v>${i}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}

export function workbook(sheets: { name: string; rows: Cell[][] }[]): Buffer {
  const strings: string[] = [];
  const sheetFiles = sheets.map((s) => sheetXml(s.rows, strings));
  const entries: Entry[] = [
    { name: "xl/workbook.xml", mode: "deflate", data: Buffer.from(`<workbook><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", mode: "stored", data: Buffer.from(`<Relationships>${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`) },
    ...sheetFiles.map((xml, i): Entry => ({ name: `xl/worksheets/sheet${i + 1}.xml`, mode: i % 2 === 0 ? "stream" : "deflate", data: Buffer.from(xml) })),
    { name: "xl/sharedStrings.xml", mode: "stream", data: Buffer.from(`<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`) },
  ];
  return zip(entries);
}

export const JIBBLE_HEADER = ["DATE", "DAY", "FIRST IN", "LAST OUT", "PAYROLL HRS", "REG. HRS", "DAILY OT", "DOUBLE OT", "REST DAY OT", "WEEKLY OT", "PUBLIC HOLIDAY OT", "PTO", "TIME OFF POLICY"];

/** One day row. `serial` is the Excel date serial (46328 = Monday 2 November 2026). */
export const jibbleDay = (serial: number, payroll: string, over: Partial<Record<"dailyOt" | "restDayOt" | "holidayOt" | "pto", string>> = {}): Cell[] => [
  serial, "Day", null, null, payroll, payroll, over.dailyOt ?? "0h 00m", "0h 00m", over.restDayOt ?? "0h 00m", "0h 00m", over.holidayOt ?? "0h 00m", over.pto ?? "0h 00m", null,
];

export const jibbleMemberSheet = (name: string, code: string, rows: Cell[][]) => ({
  name: `${name} (${code}) Summary`.slice(0, 31),
  rows: [["Timesheets"], [], ["Period", "01 November 2026 - 09 November 2026"], [], ["Member", name], ["Code", code], ["Manager(s)"], [], JIBBLE_HEADER, ...rows],
});

/** Excel serial of a YYYY-MM-DD date. */
export const excelSerial = (isoDate: string) => Math.round(Date.parse(`${isoDate}T00:00:00Z`) / 86_400_000) + 25_569;
