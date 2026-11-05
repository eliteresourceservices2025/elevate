import { describe, expect, it } from "vitest";
import { calculateLine, type SettingsSnapshot } from "./calculate";
import { PAY_ITEM_TYPES } from "./constants";
import { buildLineInput, formatItemValue, formatUsdRate, parseItemValue, parseUsdRate } from "./items";

const settings: SettingsSnapshot = {
  cutoffDivisor: 11,
  changeWarnBp: 1000,
  multipliersBp: { regular: 12500, holiday: 20000, restDay: 13000, restDayOver8: 16900, holidayPay: 10000 },
};
const rate = { monthlyCentavos: 2_200_000n, pesoAllowanceCentavos: 100_000n, dollarAllowanceCents: 1250n };

describe("parseItemValue", () => {
  it("reads minutes as positive whole numbers", () => {
    expect(parseItemValue("late_minutes", "45")).toBe(45n);
    for (const bad of ["0", "-5", "1.5", "", "abc", "1,000", "50000"]) expect(parseItemValue("late_minutes", bad)).toBeNull();
  });
  it("reads days as hundredths, up to two decimals", () => {
    expect(parseItemValue("absence_days", "1.5")).toBe(150n);
    expect(parseItemValue("absence_days", "2")).toBe(200n);
    expect(parseItemValue("partial_days", "0.25")).toBe(25n);
    for (const bad of ["0", "-1", "1.255", ".5", "32"]) expect(parseItemValue("absence_days", bad)).toBeNull();
  });
  it("reads money through parseMoney: never negative, no symbols", () => {
    expect(parseItemValue("loan", "1,250.50")).toBe(125050n);
    expect(parseItemValue("adjustment", "10")).toBe(1000n);
    for (const bad of ["-100", "$50", "1,25.0", "1.255", "0", ""]) expect(parseItemValue("loan", bad)).toBeNull();
  });
  it("lets an allowance be set to zero for one run, but nothing else", () => {
    expect(parseItemValue("peso_allowance", "0")).toBe(0n);
    expect(parseItemValue("dollar_allowance", "0.00")).toBe(0n);
    expect(parseItemValue("adjustment", "0")).toBeNull();
  });
  it("reads client hours as hundredths of an hour", () => {
    expect(parseItemValue("client_hours", "86.5")).toBe(8650n);
  });
  it("every item type has a rule", () => {
    for (const t of PAY_ITEM_TYPES) expect(() => parseItemValue(t, "1")).not.toThrow();
  });
});

describe("formatItemValue", () => {
  it("shows each unit the way it was typed", () => {
    expect(formatItemValue("late_minutes", 45n)).toBe("45");
    expect(formatItemValue("absence_days", 150n)).toBe("1.5");
    expect(formatItemValue("absence_days", 200n)).toBe("2");
    expect(formatItemValue("loan", 125050n)).toBe("1,250.50");
    expect(formatItemValue("client_hours", 8650n)).toBe("86.5");
  });
});

describe("the dollar rate", () => {
  it("round-trips and refuses anything unclear", () => {
    expect(parseUsdRate("58.50")).toBe(585000);
    expect(parseUsdRate("58")).toBe(580000);
    expect(parseUsdRate("58.1234")).toBe(581234);
    for (const bad of ["0", "-58", "58.12345", "$58", "", "1,058"]) expect(parseUsdRate(bad)).toBeNull();
    expect(formatUsdRate(585000)).toBe("58.50");
    expect(formatUsdRate(581234)).toBe("58.1234");
    expect(formatUsdRate(580000)).toBe("58.00");
  });
});

describe("buildLineInput", () => {
  it("is the line's own figures when there are no items", () => {
    const { input, clientHoursHundredths } = buildLineInput(rate, 8, new Map());
    expect(input).toMatchObject({ monthlyCentavos: 2_200_000n, hoursPerDay: 8, partial: null, absenceDayHundredths: 0, lateMinutes: 0, pesoAllowance: 100_000n, dollarAllowanceCents: 1250n, adjustment: 0n, loan: 0n, otherDeductions: 0n });
    expect(clientHoursHundredths).toBe(0n);
  });

  it("maps every item type, an allowance item replaces the line's, and client hours never reach the calculator", () => {
    const items = new Map<(typeof PAY_ITEM_TYPES)[number], bigint>([
      ["absence_days", 100n],
      ["late_minutes", 30n],
      ["extra_regular", 120n],
      ["extra_rest_day_over_8", 60n],
      ["holiday", 480n],
      ["peso_allowance", 0n],
      ["dollar_allowance", 2000n],
      ["adjustment", 50_000n],
      ["loan", 10_000n],
      ["other_deduction", 5_000n],
      ["client_hours", 17_000n],
    ]);
    const { input, clientHoursHundredths } = buildLineInput(rate, 8, items);
    expect(input.absenceDayHundredths).toBe(100);
    expect(input.lateMinutes).toBe(30);
    expect(input.extra).toEqual({ regular: 120, holiday: 0, restDay: 0, restDayOver8: 60, holidayPay: 480 });
    expect(input.pesoAllowance).toBe(0n);
    expect(input.dollarAllowanceCents).toBe(2000n);
    expect(input.adjustment).toBe(50_000n);
    expect(input.loan).toBe(10_000n);
    expect(input.otherDeductions).toBe(5_000n);
    expect(clientHoursHundredths).toBe(17_000n);
    expect(Object.keys(input)).not.toContain("clientHours");
    expect(calculateLine(input, settings, 585000).issues).toEqual([]);
  });

  it("a partial cutoff comes from days and/or minutes", () => {
    expect(buildLineInput(rate, 8, new Map([["partial_days", 500n]])).input.partial).toEqual({ dayHundredths: 500, minutes: 0 });
    expect(buildLineInput(rate, 8, new Map([["partial_minutes", 90n]])).input.partial).toEqual({ dayHundredths: 0, minutes: 90 });
  });
});
