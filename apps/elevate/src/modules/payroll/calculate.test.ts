import { describe, expect, it } from "vitest";
import { calculateLine, type LineInput, type SettingsSnapshot } from "./calculate";
import { formatPesos, parseMoney } from "./money";

const m = (s: string) => parseMoney(s)!;
const f = formatPesos;

const settings: SettingsSnapshot = {
  cutoffDivisor: 11,
  changeWarnBp: 2000,
  multipliersBp: {
    regular: 10000,
    holiday: 10000,
    restDay: 10000,
    restDayOver8: 10000,
    holidayPay: 10000,
  },
};

const noExtra = { regular: 0, holiday: 0, restDay: 0, restDayOver8: 0, holidayPay: 0 };

function input(over: Partial<LineInput> = {}): LineInput {
  return {
    monthlyCentavos: m("30,000.00"),
    hoursPerDay: 8,
    partial: null,
    absenceDayHundredths: 0,
    lateMinutes: 0,
    extra: { ...noExtra },
    pesoAllowance: 0n,
    dollarAllowanceCents: 0n,
    adjustment: 0n,
    loan: 0n,
    otherDeductions: 0n,
    ...over,
  };
}

describe("calculateLine", () => {
  it("full cutoff", () => {
    const r = calculateLine(input(), settings, null);
    expect(f(r.cutoff)).toBe("15,000.00");
    expect(f(r.daily)).toBe("1,363.64");
    expect(f(r.hourly)).toBe("170.45");
    expect(f(r.net)).toBe("15,000.00");
    expect(r.issues).toEqual([]);
  });

  it("keeps the rate unrounded", () => {
    const r = calculateLine(input({ extra: { ...noExtra, regular: 600 } }), settings, null);
    expect(f(r.extra.regular)).toBe("1,704.55");
  });

  it("6-hour day", () => {
    expect(f(calculateLine(input({ hoursPerDay: 6 }), settings, null).hourly)).toBe("227.27");
  });

  it("4-hour line", () => {
    const r = calculateLine(
      input({ monthlyCentavos: m("15,000.00"), hoursPerDay: 4 }),
      settings,
      null,
    );
    expect(f(r.cutoff)).toBe("7,500.00");
    expect(f(r.daily)).toBe("681.82");
    expect(f(r.hourly)).toBe("170.45");
  });

  it("absence", () => {
    const r = calculateLine(input({ absenceDayHundredths: 100 }), settings, null);
    expect(f(r.absences)).toBe("1,363.64");
    expect(f(r.gross)).toBe("13,636.36");
  });

  it("half-day absence", () => {
    const r = calculateLine(input({ absenceDayHundredths: 50 }), settings, null);
    expect(f(r.absences)).toBe("681.82");
  });

  it("late", () => {
    expect(f(calculateLine(input({ lateMinutes: 30 }), settings, null).late)).toBe("85.23");
  });

  it("partial cutoff", () => {
    const r = calculateLine(
      input({ partial: { dayHundredths: 300, minutes: 120 } }),
      settings,
      null,
    );
    expect(f(r.base)).toBe("4,431.82");
  });

  it("applies a multiplier", () => {
    const s = { ...settings, multipliersBp: { ...settings.multipliersBp, regular: 12500 } };
    const r = calculateLine(input({ extra: { ...noExtra, regular: 60 } }), s, null);
    expect(f(r.extra.regular)).toBe("213.07");
  });

  it("converts a dollar allowance and adds it to net", () => {
    const r = calculateLine(input({ dollarAllowanceCents: 5000n }), settings, 585000);
    expect(f(r.dollarAllowancePesos)).toBe("2,925.00");
    expect(f(r.net)).toBe("17,925.00");
    expect(r.issues).toEqual([]);
  });

  it("flags a dollar allowance with no rate", () => {
    const r = calculateLine(input({ dollarAllowanceCents: 5000n }), settings, null);
    expect(r.issues).toContain("missing_usd_rate");
    expect(r.dollarAllowancePesos).toBe(0n);
  });

  it("flags a used but missing multiplier and pays nothing for it", () => {
    const s = { ...settings, multipliersBp: { ...settings.multipliersBp, regular: null } };
    const r = calculateLine(input({ extra: { ...noExtra, regular: 60 } }), s, null);
    expect(r.issues).toContain("missing_multiplier:regular");
    expect(r.extra.regular).toBe(0n);
  });

  it("ignores an unused missing multiplier", () => {
    const s = { ...settings, multipliersBp: { ...settings.multipliersBp, regular: null } };
    expect(calculateLine(input(), s, null).issues).toEqual([]);
  });

  it("adds adjustments and subtracts deductions", () => {
    const r = calculateLine(
      input({ adjustment: m("500"), loan: m("200"), otherDeductions: m("100") }),
      settings,
      null,
    );
    expect(f(r.net)).toBe("15,200.00");
  });

  it("flags negative net", () => {
    const r = calculateLine(input({ loan: m("20,000") }), settings, null);
    expect(f(r.net)).toBe("-5,000.00");
    expect(r.issues).toContain("negative_net");
  });
});
