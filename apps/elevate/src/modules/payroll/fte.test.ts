import { describe, expect, it } from "vitest";
import { calculateLine, type LineInput, type SettingsSnapshot } from "./calculate";
import { effectiveFte, formatFte, parseFte, perFteCutoffCentavos, perFteMonthlyCentavos, runFteTotal } from "./fte";
import { formatItemValue, itemUnit, parseItemValue } from "./items";
import { formatPesos, parseMoney } from "./money";

describe("parseFte / formatFte", () => {
  it("reads 1, 0.5, 0, .5 and 0,25 as hundredths", () => {
    expect(parseFte("1")).toBe(100);
    expect(parseFte("0.5")).toBe(50);
    expect(parseFte(".5")).toBe(50);
    expect(parseFte("0,25")).toBe(25);
    expect(parseFte("0")).toBe(0);
    expect(parseFte(" 2 ")).toBe(200);
  });

  it("refuses a blank, a negative, a count above 2 and words", () => {
    for (const bad of ["", "  ", "-1", "2.01", "3", "one", "1.234", "1..5", "100"]) expect(parseFte(bad), bad).toBeNull();
  });

  it("writes a count the way people read it", () => {
    expect(formatFte(100)).toBe("1");
    expect(formatFte(50)).toBe("0.5");
    expect(formatFte(25)).toBe("0.25");
    expect(formatFte(0)).toBe("0");
    expect(formatFte(2800)).toBe("28");
    expect(formatFte(2750)).toBe("27.5");
    expect(formatFte(10n)).toBe("0.1");
  });
});

describe("effectiveFte", () => {
  it("is what was typed for the run, else the rate's own count, else 0 (never guessed as 1)", () => {
    expect(effectiveFte(100, 50n)).toBe(50);
    expect(effectiveFte(100, 0n)).toBe(0); // 0 typed for the run wins: it does not count this time
    expect(effectiveFte(50, null)).toBe(50);
    expect(effectiveFte(undefined, undefined)).toBe(0);
    expect(effectiveFte(0, undefined)).toBe(0);
  });
});

describe("runFteTotal", () => {
  it("adds the effective FTE of every line and never counts a line paid per FTE", () => {
    const lines = [
      { perFte: false, effectiveHundredths: 100 },
      { perFte: false, effectiveHundredths: 50 },
      { perFte: false, effectiveHundredths: 50 },
      { perFte: false, effectiveHundredths: 0 },
      { perFte: true, effectiveHundredths: 100 }, // an internal-team line: ignored
    ];
    expect(runFteTotal(lines)).toBe(200);
    expect(runFteTotal([])).toBe(0);
  });
});

describe("a line paid per FTE", () => {
  const m = (s: string) => parseMoney(s)!;
  const settings: SettingsSnapshot = { cutoffDivisor: 11, changeWarnBp: 1000, multipliersBp: { regular: 12500, restDay: 13000, restDayOver8: 16900, holiday: 10000 } };
  const input = (monthlyCentavos: bigint, over: Partial<LineInput> = {}): LineInput => ({
    monthlyCentavos,
    hoursPerDay: 8,
    partial: null,
    absenceDayHundredths: 0,
    sickLeaveDayHundredths: 0,
    bereavementDayHundredths: 0,
    ptoDayHundredths: 0,
    lateMinutes: 0,
    extra: { regular: 0, restDay: 0, restDayOver8: 0, holiday: 0 },
    allowances: [],
    reimbursements: [],
    bonuses: [],
    adjustments: [],
    loan: 0n,
    otherDeductions: 0n,
    ...over,
  });

  it("is paid the run's total FTE times its amount per FTE for the cutoff", () => {
    expect(formatPesos(perFteCutoffCentavos(m("1,500"), 2800))).toBe("42,000.00"); // 28 FTE x 1,500
    expect(formatPesos(perFteCutoffCentavos(m("1,100"), 2800))).toBe("30,800.00");
    expect(formatPesos(perFteCutoffCentavos(m("1,100"), 2750))).toBe("30,250.00"); // 27.5 FTE
    expect(formatPesos(perFteCutoffCentavos(m("1,500"), 0))).toBe("0.00");
  });

  it("rounds once, half up", () => {
    // 1,333.33 x 0.5 FTE = 666.665 -> 666.67
    expect(formatPesos(perFteCutoffCentavos(m("1,333.33"), 50))).toBe("666.67");
  });

  it("goes through the same calculator, so the cutoff is half the monthly figure it is given", () => {
    const monthly = perFteMonthlyCentavos(m("1,500"), 2800);
    expect(formatPesos(monthly)).toBe("84,000.00");
    const r = calculateLine(input(monthly), settings);
    expect(formatPesos(r.cutoff)).toBe("42,000.00");
    expect(formatPesos(r.base)).toBe("42,000.00");
    expect(formatPesos(r.net)).toBe("42,000.00");
  });

  it("still takes an absence off at monthly / (2 x divisor), and adds a named allowance", () => {
    const monthly = perFteMonthlyCentavos(m("1,500"), 2800); // 84,000.00 a month
    const r = calculateLine(input(monthly, { absenceDayHundredths: 100, allowances: [{ label: "Health allowance", amount: m("3,100") }] }), settings);
    expect(formatPesos(r.absences)).toBe("3,818.18"); // 84,000 / 22
    expect(formatPesos(r.net)).toBe("41,281.82"); // 42,000 - 3,818.18 + 3,100
  });
});

describe("the FTE item", () => {
  it("is typed as 1, 0.5 or 0 (0 is allowed here only), and never above 2", () => {
    expect(itemUnit("fte")).toBe("fte");
    expect(parseItemValue("fte", "1")).toBe(100n);
    expect(parseItemValue("fte", "0.5")).toBe(50n);
    expect(parseItemValue("fte", "0")).toBe(0n);
    for (const bad of ["", "-1", "3", "abc", "2.5"]) expect(parseItemValue("fte", bad), bad).toBeNull();
    expect(parseItemValue("absence_days", "0")).toBeNull(); // every other type still refuses 0
  });

  it("is shown the way it is typed", () => {
    expect(formatItemValue("fte", 50n)).toBe("0.5");
    expect(formatItemValue("fte", 0n)).toBe("0");
  });
});
