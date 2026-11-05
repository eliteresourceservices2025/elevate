import { describe, expect, it } from "vitest";
import { calculateLine, EXTRA_KEYS, type LineInput, type SettingsSnapshot } from "./calculate";
import { PAY_ITEM_LABELS } from "./constants";
import { payslipMarkdown, stripMarkdown, type PayslipInput } from "./payslip";

// Invented person and figures. Money is bigint centavos.
const settings: SettingsSnapshot = {
  cutoffDivisor: 11,
  changeWarnBp: 1000,
  multipliersBp: { regular: 12500, holiday: 20000, restDay: 13000, restDayOver8: 16900, holidayPay: 10000 },
};
const baseInput: LineInput = {
  monthlyCentavos: 2_200_000n,
  hoursPerDay: 8,
  partial: null,
  absenceDayHundredths: 0,
  lateMinutes: 0,
  extra: { regular: 0, holiday: 0, restDay: 0, restDayOver8: 0, holidayPay: 0 },
  pesoAllowance: 0n,
  dollarAllowanceCents: 0n,
  adjustment: 0n,
  loan: 0n,
  otherDeductions: 0n,
};
const lineOf = (alias: string | null, over: Partial<LineInput> = {}) => {
  const input = { ...baseInput, ...over };
  return { alias, input, result: calculateLine(input, settings, 585_000) };
};
const slip = (lines: PayslipInput["lines"], over: Partial<PayslipInput> = {}): PayslipInput => ({
  name: "Liza Testreyes",
  periodStart: "2029-01-01",
  periodEnd: "2029-01-15",
  usdRateE4: 585_000,
  lines,
  ...over,
});

describe("payslipMarkdown", () => {
  it("shows the person's figures, the period and the dollar rate, with labels from the constants", () => {
    const md = payslipMarkdown(
      slip([
        lineOf(null, {
          absenceDayHundredths: 100,
          lateMinutes: 30,
          extra: { regular: 90, holiday: 0, restDay: 0, restDayOver8: 0, holidayPay: 0 },
          pesoAllowance: 100_000n,
          dollarAllowanceCents: 2_000n,
          adjustment: 25_000n,
          loan: 50_000n,
          otherDeductions: 10_000n,
        }),
      ]),
    );
    expect(md).toContain("Liza Testreyes");
    expect(md).toContain("2029-01-01 to 2029-01-15");
    expect(md).toContain("58.50");
    for (const t of ["absence_days", "late_minutes", "extra_regular", "peso_allowance", "dollar_allowance", "adjustment", "loan", "other_deduction"] as const) {
      expect(md).toContain(PAY_ITEM_LABELS[t]);
    }
    const result = lineOf(null, { pesoAllowance: 100_000n }).result;
    expect(result.net).toBeGreaterThan(0n);
    expect(md).toMatch(/Net pay/);
  });

  it("leaves out items that are zero, and never says overtime or PTO", () => {
    const md = payslipMarkdown(slip([lineOf(null)]));
    expect(md).not.toContain(PAY_ITEM_LABELS.absence_days);
    expect(md).not.toContain(PAY_ITEM_LABELS.loan);
    expect(md).not.toMatch(/overtime|pto\b/i);
    const all = payslipMarkdown(
      slip([lineOf("A", { extra: Object.fromEntries(EXTRA_KEYS.map((k) => [k, 60])) as LineInput["extra"] })]),
    );
    expect(all).not.toMatch(/overtime|pto\b/i);
    expect(all).toContain("Extra hours");
  });

  it("gives a two-line person one payslip with both lines and a total", () => {
    const a = lineOf("Front desk");
    const b = lineOf("Billing", { monthlyCentavos: 1_000_000n });
    const md = payslipMarkdown(slip([a, b]));
    expect(md).toContain("Front desk");
    expect(md).toContain("Billing");
    expect(md.match(/^# /gm)).toHaveLength(1);
    expect(md).toContain("Total net pay");
    expect(md).toContain("16,000.00"); // 11,000.00 + 5,000.00
  });

  it("strips Markdown characters from the name and the alias", () => {
    const md = payslipMarkdown(slip([lineOf("**Bold** [link](x) `code` # head_er")], { name: "Li*za_ Test`reyes" }));
    expect(md).not.toMatch(/\*\*Bold|\[link\]|`|_er/);
    expect(md).toContain("Bold link(x) code header");
    expect(md).toContain("Liza Testreyes");
  });

  it("shows a negative adjustment as negative", () => {
    const md = payslipMarkdown(slip([lineOf(null, { adjustment: -25_000n })]));
    expect(md).toContain("-250.00");
  });

  it("does not show a bank detail, a reason or a staff name", () => {
    const md = payslipMarkdown(slip([lineOf(null, { loan: 1_000n })]));
    expect(md).not.toMatch(/bank|account number|reason|prepared by|approved by/i);
  });
});

describe("stripMarkdown", () => {
  it("removes the characters that mean something to the parser and flattens lines", () => {
    expect(stripMarkdown("a*b_c`d#e[f]g\\h<i>\nj")).toBe("abcdefghi j");
    expect(stripMarkdown("   ")).toBe("");
  });
});
