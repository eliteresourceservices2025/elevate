import { describe, expect, it } from "vitest";
import { calculateLine, HOLIDAY_BP, type SettingsSnapshot } from "./calculate";
import { PAY_ITEM_TYPES } from "./constants";
import { buildLineInput, cleanItemLabel, formatItemValue, noItemizedLines, parseItemValue } from "./items";

const settings: SettingsSnapshot = {
  cutoffDivisor: 11,
  changeWarnBp: 1000,
  multipliersBp: { regular: 12500, restDay: 13000, restDayOver8: 16900, holiday: HOLIDAY_BP },
};
const rate = { monthlyCentavos: 2_200_000n };

describe("parseItemValue", () => {
  it("reads minutes as positive whole numbers", () => {
    expect(parseItemValue("late_minutes", "45")).toBe(45n);
    for (const bad of ["0", "-5", "1.5", "", "abc", "1,000", "50000"]) expect(parseItemValue("late_minutes", bad)).toBeNull();
  });
  it("reads days as hundredths, up to two decimals", () => {
    expect(parseItemValue("absence_days", "1.5")).toBe(150n);
    expect(parseItemValue("absence_days", "2")).toBe(200n);
    expect(parseItemValue("partial_days", "0.25")).toBe(25n);
    expect(parseItemValue("sick_leave_days", "1")).toBe(100n);
    expect(parseItemValue("bereavement_days", "3")).toBe(300n);
    expect(parseItemValue("pto_days", "0.5")).toBe(50n);
    for (const bad of ["0", "-1", "1.255", ".5", "32"]) expect(parseItemValue("absence_days", bad)).toBeNull();
  });
  it("reads money through parseMoney: never negative or zero, no symbols", () => {
    expect(parseItemValue("loan", "1,250.50")).toBe(125050n);
    expect(parseItemValue("adjustment", "10")).toBe(1000n);
    expect(parseItemValue("allowance", "500")).toBe(50000n);
    expect(parseItemValue("reimbursement", "75.25")).toBe(7525n);
    expect(parseItemValue("bonus", "2,000")).toBe(200000n);
    for (const bad of ["-100", "$50", "1,25.0", "1.255", "0", ""]) expect(parseItemValue("loan", bad)).toBeNull();
    for (const t of ["allowance", "reimbursement", "bonus", "adjustment"] as const) expect(parseItemValue(t, "0")).toBeNull();
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
    expect(formatItemValue("allowance", 50000n)).toBe("500.00");
    expect(formatItemValue("client_hours", 8650n)).toBe("86.5");
  });
});

describe("cleanItemLabel", () => {
  it("keeps a plain one-line name and refuses an empty or very long one", () => {
    expect(cleanItemLabel("  Health   allowance ")).toBe("Health allowance");
    expect(cleanItemLabel("Line\none\u0000two")).toBe("Line one two");
    expect(cleanItemLabel("   ")).toBeNull();
    expect(cleanItemLabel("x".repeat(61))).toBeNull();
    expect(cleanItemLabel("x".repeat(60))).toHaveLength(60);
  });
});

describe("buildLineInput", () => {
  it("is the line's own figures when there are no items", () => {
    const { input, clientHoursHundredths } = buildLineInput(rate, 8, new Map());
    expect(input).toMatchObject({
      monthlyCentavos: 2_200_000n,
      hoursPerDay: 8,
      partial: null,
      absenceDayHundredths: 0,
      sickLeaveDayHundredths: 0,
      bereavementDayHundredths: 0,
      ptoDayHundredths: 0,
      lateMinutes: 0,
      allowances: [],
      reimbursements: [],
      bonuses: [],
      adjustments: [],
      loan: 0n,
      otherDeductions: 0n,
    });
    expect(clientHoursHundredths).toBe(0n);
  });

  it("maps every item type, takes the itemized lines as they are, and client hours never reach the calculator", () => {
    const items = new Map<(typeof PAY_ITEM_TYPES)[number], bigint>([
      ["absence_days", 100n],
      ["sick_leave_days", 50n],
      ["bereavement_days", 200n],
      ["pto_days", 100n],
      ["late_minutes", 30n],
      ["extra_regular", 120n],
      ["extra_rest_day_over_8", 60n],
      ["holiday", 480n],
      ["loan", 10_000n],
      ["other_deduction", 5_000n],
      ["client_hours", 17_000n],
    ]);
    const itemized = {
      ...noItemizedLines(),
      allowance: [{ label: "Health allowance", amount: 100_000n }],
      adjustment: [{ label: "Correction", amount: 50_000n }],
    };
    const { input, clientHoursHundredths } = buildLineInput(rate, 8, items, itemized);
    expect(input.absenceDayHundredths).toBe(100);
    expect(input.sickLeaveDayHundredths).toBe(50);
    expect(input.bereavementDayHundredths).toBe(200);
    expect(input.ptoDayHundredths).toBe(100);
    expect(input.lateMinutes).toBe(30);
    expect(input.extra).toEqual({ regular: 120, restDay: 0, restDayOver8: 60, holiday: 480 });
    expect(input.allowances).toEqual([{ label: "Health allowance", amount: 100_000n }]);
    expect(input.adjustments).toEqual([{ label: "Correction", amount: 50_000n }]);
    expect(input.loan).toBe(10_000n);
    expect(input.otherDeductions).toBe(5_000n);
    expect(clientHoursHundredths).toBe(17_000n);
    expect(Object.keys(input)).not.toContain("clientHours");
    expect(calculateLine(input, settings).issues).toEqual([]);
  });

  it("a partial cutoff comes from days and/or minutes", () => {
    expect(buildLineInput(rate, 8, new Map([["partial_days", 500n]])).input.partial).toEqual({ dayHundredths: 500, minutes: 0 });
    expect(buildLineInput(rate, 8, new Map([["partial_minutes", 90n]])).input.partial).toEqual({ dayHundredths: 0, minutes: 90 });
  });
});
