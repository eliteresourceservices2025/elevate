import { describe, expect, it } from "vitest";
import { calculateLine, EXTRA_KEYS, type LineInput, type SettingsSnapshot } from "./calculate";
import { PAY_ITEM_LABELS } from "./constants";
import { formatPesos } from "./money";
import { payslipView, type PayslipInput } from "./payslip";

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
  paidOn: "2029-01-16",
  payslipNumber: "PS-TEST0001-ABCD",
  paymentMethods: ["remitly"],
  multipliersBp: settings.multipliersBp,
  signatory: null,
  ...over,
});
const everything = (view: ReturnType<typeof payslipView>) => JSON.stringify(view);

describe("payslipView", () => {
  it("shows the person's figures, the period, the paid date and how they were paid", () => {
    const line = lineOf(null, {
      absenceDayHundredths: 100,
      lateMinutes: 30,
      extra: { regular: 90, holiday: 0, restDay: 0, restDayOver8: 0, holidayPay: 0 },
      pesoAllowance: 100_000n,
      dollarAllowanceCents: 2_000n,
      adjustment: 25_000n,
      loan: 50_000n,
      otherDeductions: 10_000n,
    });
    const view = payslipView(slip([line]));
    expect(view.name).toBe("Liza Testreyes");
    expect(view.period).toBe("2029-01-01 to 2029-01-15");
    expect(view.number).toBe("PS-TEST0001-ABCD");
    expect(view.paidOn).toBe("2029-01-16");
    expect(view.paidBy).toBe("Remitly");

    const [one] = view.lines;
    expect(one.heading).toBeNull();
    expect(one.net).toBe(formatPesos(line.result.net));
    expect(one.gross).toBe(formatPesos(line.result.gross));
    const labels = [...one.earnings, ...one.additions, ...one.deductions].map((r) => r.label);
    for (const t of ["absence_days", "late_minutes", "extra_regular", "peso_allowance", "dollar_allowance", "adjustment", "loan", "other_deduction"] as const) {
      expect(labels).toContain(PAY_ITEM_LABELS[t]);
    }
    expect(one.earnings[0].amount).toBe(formatPesos(line.result.base));
  });

  it("explains each extra-hours line with the hours and the rate it was made with", () => {
    const line = lineOf(null, { extra: { regular: 90, holiday: 0, restDay: 0, restDayOver8: 0, holidayPay: 0 } });
    const extra = payslipView(slip([line])).lines[0].earnings.find((r) => r.label === PAY_ITEM_LABELS.extra_regular);
    expect(extra?.detail).toBe("1 h 30 min at 125%");
    expect(extra?.amount).toBe(formatPesos(line.result.extra.regular));
    // The rate is left out when the run does not say which it was.
    const unknown = payslipView(slip([line], { multipliersBp: null })).lines[0].earnings.find((r) => r.label === PAY_ITEM_LABELS.extra_regular);
    expect(unknown?.detail).toBe("1 h 30 min");
  });

  it("shows the dollar allowance in pesos with the dollars and the rate", () => {
    const line = lineOf(null, { dollarAllowanceCents: 2_000n });
    const row = payslipView(slip([line])).lines[0].additions.find((r) => r.label === PAY_ITEM_LABELS.dollar_allowance);
    expect(row?.detail).toBe("USD 20.00 at 58.50 pesos per dollar");
    expect(row?.amount).toBe(formatPesos(line.result.dollarAllowancePesos));
  });

  it("adds up: gross plus additions minus deductions is the net pay", () => {
    const line = lineOf(null, { adjustment: 25_000n, loan: 50_000n, otherDeductions: 10_000n, dollarAllowanceCents: 2_000n });
    const { gross, net } = payslipView(slip([line])).lines[0];
    const expected = line.result.gross + line.result.dollarAllowancePesos + 25_000n - 50_000n - 10_000n;
    expect(formatPesos(expected)).toBe(net);
    expect(gross).toBe(formatPesos(line.result.gross));
  });

  it("leaves out items that are zero, and never says overtime or PTO", () => {
    const view = payslipView(slip([lineOf(null)]));
    const labels = [...view.lines[0].earnings, ...view.lines[0].additions, ...view.lines[0].deductions].map((r) => r.label);
    expect(labels).not.toContain(PAY_ITEM_LABELS.absence_days);
    expect(labels).not.toContain(PAY_ITEM_LABELS.loan);
    expect(view.lines[0].additions).toEqual([]);
    expect(view.lines[0].deductions).toEqual([]);
    expect(everything(view)).not.toMatch(/overtime|pto\b/i);
    const all = payslipView(slip([lineOf("A", { extra: Object.fromEntries(EXTRA_KEYS.map((k) => [k, 60])) as LineInput["extra"] })]));
    expect(everything(all)).not.toMatch(/overtime|pto\b/i);
    expect(everything(all)).toContain("Extra hours");
  });

  it("gives a two-line person one payslip with a heading for each line and a total", () => {
    const a = lineOf("Front desk");
    const b = lineOf("Billing", { monthlyCentavos: 1_000_000n });
    const view = payslipView(slip([a, b]));
    expect(view.lines.map((l) => l.heading)).toEqual(["Line: Front desk", "Line: Billing"]);
    expect(view.total).toBe("16,000.00"); // 11,000.00 + 5,000.00
    expect(payslipView(slip([lineOf(null), lineOf(null)])).lines.map((l) => l.heading)).toEqual(["Line: 1", "Line: 2"]);
  });

  it("shows an alias as the heading of a single line, and nothing when there is none", () => {
    expect(payslipView(slip([lineOf("Front desk")])).lines[0].heading).toBe("Line: Front desk");
    expect(payslipView(slip([lineOf(null)])).lines[0].heading).toBeNull();
    expect(payslipView(slip([lineOf(null)])).total).toBeNull();
  });

  it("flattens control characters and line breaks in the name and the alias", () => {
    const view = payslipView(slip([lineOf("Front\ndesk\t one")], { name: "Liza\r\n  Testreyes\u0000" }));
    expect(view.name).toBe("Liza Testreyes");
    expect(view.lines[0].heading).toBe("Line: Front desk one");
  });

  it("shows a negative adjustment as negative, and deductions with a minus", () => {
    const view = payslipView(slip([lineOf(null, { adjustment: -25_000n, loan: 1_000n })]));
    expect(view.lines[0].additions.find((r) => r.label === PAY_ITEM_LABELS.adjustment)?.amount).toBe("-250.00");
    expect(view.lines[0].deductions[0].amount).toBe("-10.00");
  });

  it("does not show a bank detail, a reason or a staff name", () => {
    const view = payslipView(slip([lineOf(null, { loan: 1_000n })]));
    expect(everything(view)).not.toMatch(/bank|account number|reason|prepared by|approved by|reference/i);
  });

  it("names who signed, with the date and the picture, or says nothing was signed", () => {
    const signed = payslipView(slip([lineOf(null)], { signatory: { name: "Carmen Dela Rosa", title: "Human Resources Director", signedOn: "2029-01-16", signatureBase64: "QUJD" } }));
    expect(signed.signature).toEqual({ name: "Carmen Dela Rosa", title: "Human Resources Director", signedOn: "2029-01-16", imageBase64: "QUJD" });
    expect(payslipView(slip([lineOf(null)])).signature).toBeNull();
    const noPicture = payslipView(slip([lineOf(null)], { signatory: { name: "Carmen", title: "Director", signedOn: "2029-01-16", signatureBase64: null } }));
    expect(noPicture.signature?.imageBase64).toBeNull();
  });

  it("lists each payment method once, and leaves it out when there is none", () => {
    expect(payslipView(slip([lineOf("A"), lineOf("B")], { paymentMethods: ["remitly", "remitly"] })).paidBy).toBe("Remitly");
    expect(payslipView(slip([lineOf(null)], { paymentMethods: [] })).paidBy).toBeNull();
    expect(payslipView(slip([lineOf(null)], { paidOn: null })).paidOn).toBeNull();
  });
});
