import { describe, expect, it } from "vitest";
import { calculateLine, HOLIDAY_BP, type LineInput, type SettingsSnapshot } from "./calculate";
import { formatPesos, parseMoney } from "./money";

const m = (s: string) => parseMoney(s)!;
const f = formatPesos;
const line = (label: string, amount: string) => ({ label, amount: m(amount) });

const settings: SettingsSnapshot = {
  cutoffDivisor: 11,
  changeWarnBp: 2000,
  multipliersBp: {
    regular: 10000,
    restDay: 10000,
    restDayOver8: 10000,
    holiday: HOLIDAY_BP,
  },
};

const noExtra = { regular: 0, restDay: 0, restDayOver8: 0, holiday: 0 };

function input(over: Partial<LineInput> = {}): LineInput {
  return {
    monthlyCentavos: m("30,000.00"),
    hoursPerDay: 8,
    partial: null,
    absenceDayHundredths: 0,
    sickLeaveDayHundredths: 0,
    bereavementDayHundredths: 0,
    ptoDayHundredths: 0,
    lateMinutes: 0,
    extra: { ...noExtra },
    allowances: [],
    reimbursements: [],
    bonuses: [],
    adjustments: [],
    loan: 0n,
    otherDeductions: 0n,
    ...over,
  };
}

describe("calculateLine", () => {
  it("full cutoff", () => {
    const r = calculateLine(input(), settings);
    expect(f(r.cutoff)).toBe("15,000.00");
    expect(f(r.daily)).toBe("1,363.64");
    expect(f(r.hourly)).toBe("170.45");
    expect(f(r.net)).toBe("15,000.00");
    expect(r.issues).toEqual([]);
  });

  it("keeps the rate unrounded", () => {
    const r = calculateLine(input({ extra: { ...noExtra, regular: 600 } }), settings);
    expect(f(r.extra.regular)).toBe("1,704.55");
  });

  it("6-hour day", () => {
    expect(f(calculateLine(input({ hoursPerDay: 6 }), settings).hourly)).toBe("227.27");
  });

  it("4-hour line", () => {
    const r = calculateLine(input({ monthlyCentavos: m("15,000.00"), hoursPerDay: 4 }), settings);
    expect(f(r.cutoff)).toBe("7,500.00");
    expect(f(r.daily)).toBe("681.82");
    expect(f(r.hourly)).toBe("170.45");
  });

  it("absence", () => {
    const r = calculateLine(input({ absenceDayHundredths: 100 }), settings);
    expect(f(r.absences)).toBe("1,363.64");
    expect(f(r.gross)).toBe("13,636.36");
  });

  it("half-day absence", () => {
    const r = calculateLine(input({ absenceDayHundredths: 50 }), settings);
    expect(f(r.absences)).toBe("681.82");
  });

  it("late", () => {
    expect(f(calculateLine(input({ lateMinutes: 30 }), settings).late)).toBe("85.23");
  });

  it("partial cutoff", () => {
    const r = calculateLine(input({ partial: { dayHundredths: 300, minutes: 120 } }), settings);
    expect(f(r.base)).toBe("4,431.82");
    expect(r.issues).toEqual([]);
  });

  it("flags a partial cutoff that pays more than a full cutoff, never one that pays exactly a full cutoff", () => {
    // 11 days at the divisor of 11 is exactly half a month.
    const exact = calculateLine(input({ partial: { dayHundredths: 1100, minutes: 0 } }), settings);
    expect(f(exact.base)).toBe("15,000.00");
    expect(exact.issues).toEqual([]);
    // "15" typed for "1.5" days.
    expect(calculateLine(input({ partial: { dayHundredths: 1500, minutes: 0 } }), settings).issues).toContain("partial_exceeds_cutoff");
    expect(calculateLine(input({ partial: { dayHundredths: 1100, minutes: 1 } }), settings).issues).toContain("partial_exceeds_cutoff");
  });

  it("applies an overtime rate", () => {
    const s = { ...settings, multipliersBp: { ...settings.multipliersBp, regular: 12500 } };
    const r = calculateLine(input({ extra: { ...noExtra, regular: 60 } }), s);
    expect(f(r.extra.regular)).toBe("213.07");
  });

  it("pays holiday pay one to one with the hourly rate", () => {
    // 8 hours at the normal hourly rate of 170.45 (unrounded 170.4545...): exactly one day's pay.
    const r = calculateLine(input({ extra: { ...noExtra, holiday: 480 } }), settings);
    expect(r.extra.holiday).toBe(r.daily);
    expect(f(r.net)).toBe("16,363.64");
  });

  it("flags a used but missing overtime rate and pays nothing for it", () => {
    const s = { ...settings, multipliersBp: { ...settings.multipliersBp, regular: null } };
    const r = calculateLine(input({ extra: { ...noExtra, regular: 60 } }), s);
    expect(r.issues).toContain("missing_multiplier:regular");
    expect(r.extra.regular).toBe(0n);
  });

  it("ignores an unused missing overtime rate", () => {
    const s = { ...settings, multipliersBp: { ...settings.multipliersBp, regular: null } };
    expect(calculateLine(input(), s).issues).toEqual([]);
  });

  it("deducts unpaid sick leave like an absence, and pays bereavement and PTO days without a deduction", () => {
    const sick = calculateLine(input({ sickLeaveDayHundredths: 100 }), settings);
    expect(f(sick.sickLeave)).toBe("1,363.64");
    expect(f(sick.gross)).toBe("13,636.36");
    const paid = calculateLine(input({ bereavementDayHundredths: 300, ptoDayHundredths: 100 }), settings);
    expect(f(paid.net)).toBe("15,000.00");
  });

  it("counts itemized allowances in gross, and reimbursements, bonuses and adjustments after it", () => {
    const r = calculateLine(
      input({
        allowances: [line("Health allowance", "1,000.00"), line("Internet", "500.00")],
        reimbursements: [line("Supplies", "250.00"), line("Taxi", "100.00")],
        bonuses: [line("Performance", "2,000.00")],
        adjustments: [line("Correction", "75.50")],
      }),
      settings,
    );
    expect(f(r.allowances)).toBe("1,500.00");
    expect(f(r.gross)).toBe("16,500.00");
    expect(f(r.reimbursements)).toBe("350.00");
    expect(f(r.bonuses)).toBe("2,000.00");
    expect(f(r.adjustments)).toBe("75.50");
    expect(f(r.net)).toBe("18,925.50");
  });

  it("subtracts a loan and other deductions from the total payable only", () => {
    const r = calculateLine(input({ allowances: [line("Health allowance", "1,000.00")], loan: m("200.00"), otherDeductions: m("100.00") }), settings);
    expect(f(r.gross)).toBe("16,000.00");
    expect(f(r.net)).toBe("15,700.00");
  });

  it("flags a negative total payable", () => {
    const r = calculateLine(input({ loan: m("20,000") }), settings);
    expect(f(r.net)).toBe("-5,000.00");
    expect(r.issues).toContain("negative_net");
  });
});
