import { describe, expect, it } from "vitest";
import { dateOf, daysOutside, minutesOf, parseMinutes, readJibbleTimesheet, suggestedAmounts, totalsFor } from "./timesheet";
import { MAX_XLSX_BYTES, readXlsxSheets, XlsxError } from "./xlsx";

import { JIBBLE_HEADER as HEADER, jibbleDay as day, jibbleMemberSheet as memberSheet, workbook, zip } from "../../../../tests/helpers/jibble-workbook";

const sample = () =>
  workbook([
    { name: "Team Summary", rows: [["Custom Timesheets"], ["NAME", "MEMBER CODE", "TYPE"], ["Ana Testcruz", "ATC-1", "Payroll Hours"]] },
    memberSheet("Ana Testcruz", "ATC-1", [
      day(46327, "0h 00m"), // a Sunday off
      day(46328, "8h 06m"),
      day(46329, "8h 30m", { dailyOt: "0h 30m" }),
      day(46330, "9h 00m", { restDayOt: "1h 00m" }),
      day(46331, "4h 00m", { holidayOt: "2h 15m", pto: "4h 00m" }),
      ["TOTALS", null, null, null, "29h 36m"],
    ]),
    memberSheet("Ben & Dela Testpaz", "BDT-1", [day(46328, "7h 00m"), day(46329, "-")]),
  ]);

describe("readXlsxSheets", () => {
  it("reads a streamed, stored and deflated workbook: names, strings with entities, numbers and sparse cells", () => {
    const sheets = readXlsxSheets(sample());
    // (A sheet name is at most 31 characters, so the second member's name is cut, as Excel does.)
    expect(sheets.map((s) => s.name)).toEqual(["Team Summary", "Ana Testcruz (ATC-1) Summary", "Ben & Dela Testpaz (BDT-1) Summ"]);
    expect(sheets[1].rows[4]).toEqual(["Member", "Ana Testcruz"]);
    expect(sheets[1].rows[10][0]).toBe(46328);
    expect(sheets[2].rows[4][1]).toBe("Ben & Dela Testpaz");
    // A blank cell between two filled ones stays an empty slot.
    expect(sheets[1].rows[9][2]).toBeNull();
  });

  it("refuses a file that is not a workbook, is damaged or is too large", () => {
    expect(() => readXlsxSheets(new Uint8Array(0))).toThrow(XlsxError);
    expect(() => readXlsxSheets(Buffer.from("this is plainly not a zip file at all, just text"))).toThrow(XlsxError);
    expect(() => readXlsxSheets(new Uint8Array(MAX_XLSX_BYTES + 1))).toThrow(/not a usable/);
    const noWorkbook = zip([{ name: "xl/worksheets/sheet1.xml", mode: "stored", data: Buffer.from("<worksheet/>") }]);
    expect(() => readXlsxSheets(noWorkbook)).toThrow(/not an Excel workbook/);
    const broken = Buffer.from(sample());
    broken.writeUInt32LE(0xdeadbeef, 0); // the first local header
    expect(() => readXlsxSheets(broken)).toThrow(XlsxError);
  });

  it("refuses a part that unpacks to far more than it should (a zip bomb) without reading it all", () => {
    const bomb = zip([
      { name: "xl/workbook.xml", mode: "stored", data: Buffer.from("<workbook><sheets/></workbook>") },
      { name: "xl/worksheets/sheet1.xml", mode: "deflate", data: Buffer.alloc(30 * 1024 * 1024) },
    ]);
    expect(bomb.length).toBeLessThan(MAX_XLSX_BYTES);
    expect(() => readXlsxSheets(bomb)).toThrow(/damaged or too large|too large/);
  });
});

describe("a crafted file", () => {
  const withSheet = (sheet: string) =>
    zip([
      { name: "xl/workbook.xml", mode: "stored", data: Buffer.from('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { name: "xl/_rels/workbook.xml.rels", mode: "stored", data: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') },
      { name: "xl/worksheets/sheet1.xml", mode: "deflate", data: Buffer.from(sheet) },
    ]);

  it("is refused quickly when it has hundreds of thousands of unclosed cells (no rescanning of the rest for each one)", () => {
    const started = performance.now();
    expect(() => readXlsxSheets(withSheet('<worksheet><sheetData><row r="1">' + '<c r="A1">'.repeat(300_000) + "</row></sheetData></worksheet>"))).toThrow(/damaged/);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("is refused quickly with many unclosed rows, and does not mistake <cols> for a cell", () => {
    const started = performance.now();
    expect(() => readXlsxSheets(withSheet("<worksheet><sheetData>" + '<row r="1">'.repeat(200_000) + "</sheetData></worksheet>"))).toThrow(/damaged/);
    expect(performance.now() - started).toBeLessThan(2_000);
    const ok = readXlsxSheets(withSheet('<worksheet><cols><col min="1"/></cols><sheetData><row r="1"><c r="A1"><v>5</v></c><c r="B1" t="inlineStr"><is><t>hi &amp; bye</t></is></c></row></sheetData></worksheet>'));
    expect(ok[0].rows[0]).toEqual([5, "hi & bye"]);
  });
});

describe("a value that can't be read is refused, never counted as zero", () => {
  it("parseMinutes tells a blank or dash from a value it doesn't understand", () => {
    expect(parseMinutes("")).toBe(0);
    expect(parseMinutes("-")).toBe(0);
    expect(parseMinutes(null)).toBe(0);
    expect(parseMinutes("8h 06m")).toBe(486);
    expect(parseMinutes("abc")).toBeNull();
    expect(parseMinutes("8.5 hours")).toBeNull();
    expect(parseMinutes(-3)).toBeNull();
  });

  it("refuses a sheet with an unreadable time and names the person, column and day", () => {
    const bad = workbook([memberSheet("Ana Testcruz", "ATC-1", [day(46328, "eight hours")])]);
    expect(() => readJibbleTimesheet(bad)).toThrow(/Ana Testcruz.*PAYROLL HRS.*2026-11-02/);
  });

  it("counts the sheets it did not read as a person", () => {
    const sheet = readJibbleTimesheet(sample());
    expect(sheet.members).toHaveLength(2);
    expect(sheet.skippedSheets).toBe(1); // the team summary
    expect(sheet.missingColumns).toEqual([]);
  });
});

describe("minutesOf and dateOf", () => {
  it("reads Jibble durations and Excel dates, and treats anything else as nothing", () => {
    expect(minutesOf("8h 06m")).toBe(486);
    expect(minutesOf("0h 00m")).toBe(0);
    expect(minutesOf("12h 59m")).toBe(779);
    expect(minutesOf("-")).toBe(0);
    expect(minutesOf(null)).toBe(0);
    expect(minutesOf("abc")).toBe(0);
    expect(dateOf(46328)).toBe("2026-11-02");
    expect(dateOf(46328.5)).toBe("2026-11-02");
    expect(dateOf("2026-11-02")).toBe("2026-11-02");
    expect(dateOf("TOTALS")).toBeNull();
    expect(dateOf(12)).toBeNull();
  });
});

describe("readJibbleTimesheet", () => {
  it("reads each member's code, name and days, and ignores the summary sheet and the totals row", () => {
    const t = readJibbleTimesheet(sample());
    expect(t.periodText).toBe("01 November 2026 - 09 November 2026");
    expect(t.members.map((m) => [m.code, m.name, m.days.length])).toEqual([
      ["ATC-1", "Ana Testcruz", 5],
      ["BDT-1", "Ben & Dela Testpaz", 2],
    ]);
  });

  it("totals the days inside the run's period, by kind, and counts the days outside it", () => {
    const t = readJibbleTimesheet(sample());
    const ana = t.members[0];
    const all = totalsFor(ana, "2026-11-01", "2026-11-15");
    expect(all).toMatchObject({ days: 5, payroll: 486 + 510 + 540 + 240, dailyOt: 30, restDayOt: 60, holidayOt: 135, pto: 240 });
    // Only 2 to 3 November.
    expect(totalsFor(ana, "2026-11-02", "2026-11-03")).toMatchObject({ days: 2, payroll: 996, dailyOt: 30, restDayOt: 0 });
    expect(daysOutside(t, "2026-11-02", "2026-11-03")).toBe(3); // 1, 4 and 5 November
  });

  it("turns totals into suggested amounts: client hours, overtime by kind, holiday pay and PTO days", () => {
    const t = readJibbleTimesheet(sample());
    const s = suggestedAmounts(totalsFor(t.members[0], "2026-11-01", "2026-11-15"), 8);
    expect(s.client_hours).toBe(BigInt(Math.round((1776 * 100) / 60)));
    expect(s.extra_regular).toBe(30n);
    expect(s.extra_rest_day).toBe(60n);
    expect(s.holiday).toBe(135n);
    expect(s.pto_days).toBe(50n); // 4 hours of an 8 hour day: half a day
    // A 6 hour day makes the same PTO two thirds of a day.
    expect(suggestedAmounts(totalsFor(t.members[0], "2026-11-01", "2026-11-15"), 6).pto_days).toBe(67n);
  });

  it("refuses a workbook that is not a Jibble timesheet, and ignores a repeated member code", () => {
    expect(() => readJibbleTimesheet(workbook([{ name: "Sheet1", rows: [["a", "b"], [1, 2]] }]))).toThrow(/does not look like a Jibble timesheet/);
    const twice = workbook([memberSheet("Ana Testcruz", "ATC-1", [day(46328, "8h 00m")]), memberSheet("Ana Testcruz", "ATC-1", [day(46328, "1h 00m")])]);
    const t = readJibbleTimesheet(twice);
    expect(t.members).toHaveLength(1);
    expect(totalsFor(t.members[0], "2026-11-01", "2026-11-15").payroll).toBe(480);
  });

  it("keeps no clock times, only totals", () => {
    const t = readJibbleTimesheet(sample());
    expect(JSON.stringify(t)).not.toMatch(/first|last out|break/i);
    expect(Object.keys(t.members[0].days[0]).sort()).toEqual(["dailyOt", "date", "doubleOt", "holidayOt", "payroll", "pto", "regular", "restDayOt", "weeklyOt"]);
  });
});
