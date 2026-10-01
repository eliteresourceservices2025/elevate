import { describe, expect, it } from "vitest";
import { MAX_BULK_ROWS, groupByPerson, normalizeTime, parseCorrectionsCsv, splitCsvLine } from "./bulk-corrections";

describe("reading a spreadsheet of missing events", () => {
  it("reads a header and one event per row, in friendly words or the exact ones", () => {
    const { rows, errors } = parseCorrectionsCsv("email,type,time\nana@example.com,clock_in,2026-10-05 09:00\nANA@example.com,Clock out,2026-10-05T17:30\nben@example.com,break start,2026-10-05 12:00:30\nben@example.com,end break,2026-10-05 13:00\n");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { line: 2, email: "ana@example.com", type: "clock_in", time: "2026-10-05T09:00" },
      { line: 3, email: "ana@example.com", type: "clock_out", time: "2026-10-05T17:30" },
      { line: 4, email: "ben@example.com", type: "break_start", time: "2026-10-05T12:00" },
      { line: 5, email: "ben@example.com", type: "break_end", time: "2026-10-05T13:00" },
    ]);
  });

  it("accepts the columns in any order, an extra note column, quotes, Windows line endings and a byte order mark", () => {
    const text = '﻿note,time,email,type\r\n"Laptop died, then power cut",2026-10-05 21:00,"ana@example.com",in\r\n';
    expect(parseCorrectionsCsv(text).rows).toEqual([{ line: 2, email: "ana@example.com", type: "clock_in", time: "2026-10-05T21:00" }]);
  });

  it("reports each bad row with its line number and keeps the good ones", () => {
    const { rows, errors } = parseCorrectionsCsv("email,type,time\nana@example.com,clock_in,2026-10-05 09:00\nnot-an-email,clock_in,2026-10-05 09:00\nben@example.com,lunch,2026-10-05 09:00\ncy@example.com,clock_in,yesterday\ndi@example.com,clock_in,2026-02-30 09:00\n\n");
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(errors[1].message).toContain("Unknown type");
    expect(errors[2].message).toContain("not a date and time");
  });

  it("needs a header naming email, type and time", () => {
    expect(parseCorrectionsCsv("").errors[0].message).toBe("The file is empty.");
    expect(parseCorrectionsCsv("name,when\nAna,today").errors[0].message).toContain("must name the columns");
  });

  it("stops at the row limit", () => {
    const lines = ["email,type,time", ...Array.from({ length: MAX_BULK_ROWS + 5 }, (_, i) => `p${i}@example.com,clock_in,2026-10-05 09:00`)];
    const { rows, errors } = parseCorrectionsCsv(lines.join("\n"));
    expect(rows).toHaveLength(MAX_BULK_ROWS);
    expect(errors[0].message).toContain(`Only ${MAX_BULK_ROWS} rows`);
  });

  it("splits quoted cells and checks real dates", () => {
    expect(splitCsvLine('a,"b, c","say ""hi""",d')).toEqual(["a", "b, c", 'say "hi"', "d"]);
    expect(normalizeTime("2026-10-05 9:05")).toBe("2026-10-05T09:05");
    expect(normalizeTime("2026-10-05 24:00")).toBeNull();
    expect(normalizeTime("2026-10-05 12:60")).toBeNull();
    expect(normalizeTime("2026-13-05 12:00")).toBeNull();
    expect(normalizeTime("05/10/2026 12:00")).toBeNull();
  });

  it("groups by person in time order", () => {
    const { rows } = parseCorrectionsCsv("email,type,time\nana@example.com,clock_out,2026-10-05 17:00\nben@example.com,clock_in,2026-10-05 09:00\nana@example.com,clock_in,2026-10-05 09:00");
    const grouped = groupByPerson(rows);
    expect([...grouped.keys()]).toEqual(["ana@example.com", "ben@example.com"]);
    expect(grouped.get("ana@example.com")?.map((r) => r.type)).toEqual(["clock_in", "clock_out"]);
  });
});
