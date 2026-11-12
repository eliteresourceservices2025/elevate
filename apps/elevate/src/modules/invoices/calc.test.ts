import { describe, expect, it } from "vitest";
import { buildInvoiceLines, formatDollars, formatHours, invoiceNumber, parseDollars, rateInForce, unconfirmedNote } from "./calc";

describe("invoice lines", () => {
  const rows = [
    { personName: "Ana Testcruz", alias: "Front desk", hundredths: 8650n, confirmed: true },
    { personName: "Ben Testreyes", alias: null, hundredths: 3333n, confirmed: false },
    { personName: "Zero Hours", alias: null, hundredths: 0n, confirmed: true },
  ];

  it("rounds each line half up and the total is the sum of the lines", () => {
    // 86.50 h x 12.35 = 1068.275 -> 1068.28 ; 33.33 h x 12.35 = 411.6255 -> 411.63
    const r = buildInvoiceLines(rows, 1235n);
    expect(r.lines.map((l) => l.amountCents)).toEqual([106828n, 41163n]);
    expect(r.totalCents).toBe(106828n + 41163n);
    expect(r.totalHoursHundredths).toBe(11983n);
  });

  it("leaves off lines with no hours and counts suggested ones", () => {
    const r = buildInvoiceLines(rows, 1000n);
    expect(r.lines).toHaveLength(2);
    expect(r.unconfirmedLines).toBe(1);
    expect(buildInvoiceLines([rows[2]], 1000n).lines).toEqual([]);
  });

  it("rounds an exact half up", () => {
    // 0.01 h x 0.50 = 0.5 cents -> 1 cent
    expect(buildInvoiceLines([{ personName: "A", alias: null, hundredths: 1n, confirmed: true }], 50n).totalCents).toBe(1n); // 0.5 -> 1
    expect(buildInvoiceLines([{ personName: "A", alias: null, hundredths: 1n, confirmed: true }], 49n).totalCents).toBe(0n);
  });
});

describe("rate lookup", () => {
  const at = (s: string) => new Date(s);
  const rates = [
    { effectiveFrom: "2031-01-01", createdAt: at("2030-12-01T00:00:00Z"), rateCents: 2000n },
    { effectiveFrom: "2031-03-01", createdAt: at("2031-01-05T00:00:00Z"), rateCents: 2500n },
    { effectiveFrom: "2031-03-01", createdAt: at("2031-01-06T00:00:00Z"), rateCents: 2600n },
  ];
  it("takes the newest row at or before the date; a later row for the same start wins", () => {
    expect(rateInForce(rates, "2030-12-31")).toBeNull();
    expect(rateInForce(rates, "2031-01-01")?.rateCents).toBe(2000n);
    expect(rateInForce(rates, "2031-02-28")?.rateCents).toBe(2000n);
    expect(rateInForce(rates, "2031-03-01")?.rateCents).toBe(2600n);
    expect(rateInForce(rates, "2040-01-01")?.rateCents).toBe(2600n);
  });
});

describe("numbers and formatting", () => {
  it("numbers and revisions", () => {
    expect(invoiceNumber(2031, 7)).toBe("INV-2031-0007");
    expect(invoiceNumber(2031, 7, 1)).toBe("INV-2031-0007");
    expect(invoiceNumber(2031, 7, 2)).toBe("INV-2031-0007-R2");
    expect(invoiceNumber(2031, 7, 1, true)).toBe("TEST-2031-0007");
    expect(invoiceNumber(2031, 7, 3, true)).toBe("TEST-2031-0007-R3");
    expect(invoiceNumber(2031, 12345, 3)).toBe("INV-2031-12345-R3");
  });
  it("formats dollars and hours", () => {
    expect(formatDollars(123456n)).toBe("1,234.56");
    expect(formatDollars(5n)).toBe("0.05");
    expect(formatHours(8650n)).toBe("86.50");
    expect(formatHours(0n)).toBe("0.00");
  });
  it("reads a typed rate", () => {
    expect(parseDollars("25")).toBe(2500n);
    expect(parseDollars("25.5")).toBe(2550n);
    expect(parseDollars("1,025.50")).toBeNull(); // over the 999.99 limit
    expect(parseDollars("0")).toBeNull();
    expect(parseDollars("-3")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
    expect(parseDollars("25.555")).toBeNull();
  });
  it("words the unconfirmed note", () => {
    expect(unconfirmedNote(1)).toBe("1 line uses suggested hours that is not confirmed yet.");
    expect(unconfirmedNote(3)).toBe("3 lines use suggested hours that are not confirmed yet.");
  });
});
