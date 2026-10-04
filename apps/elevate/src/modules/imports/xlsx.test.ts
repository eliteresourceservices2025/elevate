import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";
import { parseXlsx, zipSummary } from "./xlsx";
import { defaultMapping } from "./mapping";
import { normalizeRow } from "./normalize";

// Spreadsheets are built here with invented data; a real export is never used in tests.

async function sheet(rows: (string | number | Date | null)[][]): Promise<Uint8Array> {
  const data = rows.map((r) => r.map((v) => (v === null ? { value: null } : v instanceof Date ? { value: v, type: Date, format: "yyyy-mm-dd" } : typeof v === "number" ? { value: v, type: Number } : { value: v, type: String })));
  const buf = await writeXlsxFile(data as never).toBuffer();
  return new Uint8Array(buf);
}

describe("parseXlsx", () => {
  it("reads the first sheet as a table: text, numbers and dates", async () => {
    const bytes = await sheet([
      ["Employee ID *", "First Name *", "Last Name *", "Email *", "Hire Date", "Pay Rate *"],
      [1001, "Ana", "Reyes", "ana.reyes@example.com", new Date(Date.UTC(2025, 5, 2)), 12000.5],
      [1002, "Ben", "Cruz", "ben.cruz@example.com", "06/03/2025", null],
    ]);
    const r = await parseXlsx(bytes);
    expect("error" in r).toBe(false);
    if ("headers" in r) {
      expect(r.headers).toEqual(["Employee ID *", "First Name *", "Last Name *", "Email *", "Hire Date", "Pay Rate *"]);
      expect(r.rows[0]).toMatchObject({ "Employee ID *": "1001", "First Name *": "Ana", "Hire Date": "2025-06-02", "Pay Rate *": "12000.5" });
      expect(r.rows[1]).toMatchObject({ "Hire Date": "06/03/2025", "Pay Rate *": "" });
      // And it goes through the same mapping and rules as a CSV
      const n = normalizeRow(r.rows[0], defaultMapping(r.headers), { dateFormat: "mdy", today: "2026-10-03" });
      expect(n.input).toMatchObject({ workEmail: "ana.reyes@example.com", startDate: "2025-06-02" });
    }
  });

  it("refuses files that are not spreadsheets, empty sheets and repeated headers", async () => {
    expect(await parseXlsx(new TextEncoder().encode("a,b\n1,2"))).toHaveProperty("error");
    expect(await parseXlsx(await sheet([["A", "A"], ["1", "2"]]))).toHaveProperty("error");
    expect(await parseXlsx(await sheet([["A", "B"]]))).toHaveProperty("error");
  });

  it("reads a zip's table of contents, and refuses one that unpacks to far too much", () => {
    const real = zipSummary(new Uint8Array([0x50, 0x4b, 5, 6, ...new Array(18).fill(0)]));
    expect(real).toEqual({ unpacked: 0, entries: 0 });
    expect(zipSummary(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
