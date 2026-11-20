import { describe, expect, it, vi } from "vitest";
import { calculateLine, HOLIDAY_BP, type LineInput, type SettingsSnapshot } from "./calculate";
import { PAY_ITEM_LABELS } from "./constants";
import { payslipView } from "./payslip";
import { createPayLineSchema } from "./validators";

vi.mock("server-only", () => ({}));
const { amountsToJson, withOtOverride } = await import("./service");

// Invented figures. A person's own overtime percents lie over the company standard; a key left out keeps the standard.
const standard: SettingsSnapshot = { cutoffDivisor: 11, changeWarnBp: 1000, multipliersBp: { regular: 12500, restDay: 13000, restDayOver8: 16900, holiday: HOLIDAY_BP } };
const input: LineInput = {
  monthlyCentavos: 2_200_000n,
  hoursPerDay: 8,
  partial: null,
  absenceDayHundredths: 0,
  sickLeaveDayHundredths: 0,
  bereavementDayHundredths: 0,
  ptoDayHundredths: 0,
  lateMinutes: 0,
  extra: { regular: 120, restDay: 60, restDayOver8: 0, holiday: 0 },
  allowances: [],
  reimbursements: [],
  bonuses: [],
  adjustments: [],
  loan: 0n,
  otherDeductions: 0n,
};

describe("a person's own overtime percents", () => {
  it("replace only the keys they set", () => {
    expect(withOtOverride(standard.multipliersBp, { regular: 15000 })).toEqual({ ...standard.multipliersBp, regular: 15000 });
    expect(withOtOverride(standard.multipliersBp, undefined)).toBe(standard.multipliersBp);
  });

  it("change the pay: hourly 125.00, two hours at 150% is 375.00 and one rest-day hour stays at the standard 130%", () => {
    const own = calculateLine(input, { ...standard, multipliersBp: withOtOverride(standard.multipliersBp, { regular: 15000 }) });
    const plain = calculateLine(input, standard);
    expect(own.extra.regular).toBe(37_500n);
    expect(plain.extra.regular).toBe(31_250n);
    expect(own.extra.restDay).toBe(plain.extra.restDay);
  });

  it("are written only when set, so existing pay lines keep their stored shape", () => {
    expect(amountsToJson({ monthlyCentavos: 100n })).toEqual({ monthlyCentavos: "100" });
    expect(amountsToJson({ monthlyCentavos: 100n, otBp: {} })).toEqual({ monthlyCentavos: "100" });
    expect(amountsToJson({ monthlyCentavos: 100n, otBp: { restDay: 14000 } })).toEqual({ monthlyCentavos: "100", otBp: { restDay: 14000 } });
  });

  it("show on the statement as the percent that was used", () => {
    const result = calculateLine(input, { ...standard, multipliersBp: withOtOverride(standard.multipliersBp, { regular: 15000 }) });
    const view = payslipView({
      name: "Liza Testreyes",
      periodStart: "2029-01-01",
      periodEnd: "2029-01-15",
      hiredOn: null,
      lines: [{ alias: null, clientName: null, multipliersBp: { regular: 15000 }, input, result }],
      paidOn: null,
      payslipNumber: "PS-TEST0001-ABCD",
      paymentMethods: ["remitly"],
      multipliersBp: standard.multipliersBp,
      signatory: null,
    });
    const rows = view.lines[0].compensation;
    expect(rows.find((r) => r.label === PAY_ITEM_LABELS.extra_regular)?.detail).toContain("at 150%");
    expect(rows.find((r) => r.label === PAY_ITEM_LABELS.extra_rest_day)?.detail).toContain("at 130%");
  });

  it("are typed as percents in the pay line form and refused when they are not", () => {
    const form = { employeeId: "0b1e3b0e-7d1a-4f0e-8a55-3f6f9f2a1c11", hoursPerDay: 8, paymentMethod: "remitly", effectiveFrom: "2029-01-01", monthly: "25,000" };
    expect(createPayLineSchema.parse({ ...form, otRegular: "150", otRestDay: "" })).toMatchObject({ otRegular: 15000, otRestDay: null });
    expect(createPayLineSchema.parse(form)).not.toHaveProperty("otRegular", 1);
    expect(createPayLineSchema.safeParse({ ...form, otRegular: "abc" }).success).toBe(false);
    expect(createPayLineSchema.safeParse({ ...form, otRegular: "0" }).success).toBe(false);
  });
});
