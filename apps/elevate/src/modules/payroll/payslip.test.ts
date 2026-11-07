import { describe, expect, it } from "vitest";
import { calculateLine, EXTRA_KEYS, HOLIDAY_BP, type LineInput, type SettingsSnapshot } from "./calculate";
import { PAY_ITEM_LABELS } from "./constants";
import { formatPesos } from "./money";
import { payslipView, type PayslipInput } from "./payslip";

// Invented person and figures. Money is bigint centavos. The statement is the Contractor Payment Statement.
const settings: SettingsSnapshot = {
  cutoffDivisor: 11,
  changeWarnBp: 1000,
  multipliersBp: { regular: 12500, restDay: 13000, restDayOver8: 16900, holiday: HOLIDAY_BP },
};
const noExtra = { regular: 0, restDay: 0, restDayOver8: 0, holiday: 0 };
const baseInput: LineInput = {
  monthlyCentavos: 2_200_000n,
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
};
const lineOf = (alias: string | null, over: Partial<LineInput> = {}) => {
  const input = { ...baseInput, ...over };
  return { alias, input, result: calculateLine(input, settings) };
};
const slip = (lines: PayslipInput["lines"], over: Partial<PayslipInput> = {}): PayslipInput => ({
  name: "Liza Testreyes",
  periodStart: "2029-01-01",
  periodEnd: "2029-01-15",
  lines,
  paidOn: "2029-01-16",
  payslipNumber: "PS-TEST0001-ABCD",
  paymentMethods: ["remitly"],
  multipliersBp: settings.multipliersBp,
  signatory: null,
  ...over,
});
const everything = (view: ReturnType<typeof payslipView>) => JSON.stringify(view);
const allRows = (l: ReturnType<typeof payslipView>["lines"][number]) => [...l.earnings, ...l.leave, ...l.reimbursements, ...l.bonuses, ...l.adjustments, ...l.deductions];

describe("payslipView", () => {
  it("shows the person's figures, the period, the paid date and how they were paid", () => {
    const line = lineOf(null, {
      absenceDayHundredths: 100,
      sickLeaveDayHundredths: 50,
      lateMinutes: 30,
      extra: { ...noExtra, regular: 90 },
      allowances: [{ label: "Health allowance", amount: 100_000n }],
      reimbursements: [{ label: "Supplies", amount: 12_000n }],
      bonuses: [{ label: "Performance bonus", amount: 200_000n }],
      adjustments: [{ label: "Correction", amount: 25_000n }],
      loan: 50_000n,
      otherDeductions: 10_000n,
    });
    const view = payslipView(slip([line]));
    expect(view.title).toBe("Contractor Payment Statement");
    expect(view.name).toBe("Liza Testreyes");
    expect(view.period).toBe("2029-01-01 to 2029-01-15");
    expect(view.number).toBe("PS-TEST0001-ABCD");
    expect(view.paidOn).toBe("2029-01-16");
    expect(view.paidBy).toBe("Remitly");

    const [one] = view.lines;
    expect(one.heading).toBeNull();
    expect(one.net).toBe(formatPesos(line.result.net));
    expect(one.gross).toBe(formatPesos(line.result.gross));
    const labels = allRows(one).map((r) => r.label);
    for (const t of ["absence_days", "sick_leave_days", "late_minutes", "extra_regular", "loan", "other_deduction"] as const) {
      expect(labels).toContain(PAY_ITEM_LABELS[t]);
    }
    for (const named of ["Health allowance", "Supplies", "Performance bonus", "Correction"]) expect(labels).toContain(named);
    expect(one.earnings[0].amount).toBe(formatPesos(line.result.base));
  });

  it("puts each itemized line in its own section under the name it was given", () => {
    const line = lineOf(null, {
      allowances: [
        { label: "Health allowance", amount: 100_000n },
        { label: "Internet", amount: 50_000n },
      ],
      reimbursements: [{ label: "Supplies", amount: 12_000n }],
      bonuses: [{ label: "Performance bonus", amount: 200_000n }],
      adjustments: [{ label: "Correction", amount: 25_000n }],
    });
    const [one] = payslipView(slip([line])).lines;
    expect(one.earnings.map((r) => r.label)).toEqual(expect.arrayContaining(["Health allowance", "Internet"]));
    expect(one.reimbursements).toEqual([{ label: "Supplies", detail: "", amount: "120.00" }]);
    expect(one.bonuses).toEqual([{ label: "Performance bonus", detail: "", amount: "2,000.00" }]);
    expect(one.adjustments).toEqual([{ label: "Correction", detail: "", amount: "250.00" }]);
  });

  it("explains each overtime line with the hours and the rate it was made with, and holiday pay at 100%", () => {
    const line = lineOf(null, { extra: { ...noExtra, regular: 90, holiday: 480 } });
    const rows = payslipView(slip([line])).lines[0].earnings;
    const ot = rows.find((r) => r.label === PAY_ITEM_LABELS.extra_regular);
    expect(ot?.detail).toBe("1 h 30 min at 125%");
    expect(ot?.amount).toBe(formatPesos(line.result.extra.regular));
    expect(rows.find((r) => r.label === PAY_ITEM_LABELS.holiday)?.detail).toBe("8 h at 100%");
    // The overtime rate is left out when the run does not say which it was; holiday pay is always one to one.
    const unknown = payslipView(slip([line], { multipliersBp: null })).lines[0].earnings;
    expect(unknown.find((r) => r.label === PAY_ITEM_LABELS.extra_regular)?.detail).toBe("1 h 30 min");
    expect(unknown.find((r) => r.label === PAY_ITEM_LABELS.holiday)?.detail).toBe("8 h at 100%");
  });

  it("shows paid bereavement and PTO days without a deduction, and unpaid sick leave as one", () => {
    const line = lineOf(null, { bereavementDayHundredths: 300, ptoDayHundredths: 100, sickLeaveDayHundredths: 100 });
    const [one] = payslipView(slip([line])).lines;
    expect(one.leave).toEqual([
      { label: PAY_ITEM_LABELS.bereavement_days, detail: "3 days", amount: "" },
      { label: PAY_ITEM_LABELS.pto_days, detail: "1 day", amount: "" },
    ]);
    expect(one.earnings.find((r) => r.label === PAY_ITEM_LABELS.sick_leave_days)?.amount).toBe(`-${formatPesos(line.result.sickLeave)}`);
  });

  it("adds up: gross plus reimbursements, bonuses and adjustments minus deductions is the total payable", () => {
    const line = lineOf(null, {
      reimbursements: [{ label: "Supplies", amount: 12_000n }],
      bonuses: [{ label: "Bonus", amount: 100_000n }],
      adjustments: [{ label: "Adjustment", amount: 25_000n }],
      loan: 50_000n,
      otherDeductions: 10_000n,
    });
    const { gross, net } = payslipView(slip([line])).lines[0];
    const expected = line.result.gross + 12_000n + 100_000n + 25_000n - 50_000n - 10_000n;
    expect(formatPesos(expected)).toBe(net);
    expect(gross).toBe(formatPesos(line.result.gross));
  });

  it("leaves out items that are zero, and has no dollar wording", () => {
    const view = payslipView(slip([lineOf(null)]));
    const labels = allRows(view.lines[0]).map((r) => r.label);
    expect(labels).not.toContain(PAY_ITEM_LABELS.absence_days);
    expect(labels).not.toContain(PAY_ITEM_LABELS.loan);
    expect(view.lines[0].reimbursements).toEqual([]);
    expect(view.lines[0].bonuses).toEqual([]);
    expect(view.lines[0].adjustments).toEqual([]);
    expect(view.lines[0].deductions).toEqual([]);
    expect(everything(view)).not.toMatch(/dollar|usd|payslip/i);
    const all = payslipView(slip([lineOf("A", { extra: Object.fromEntries(EXTRA_KEYS.map((k) => [k, 60])) as LineInput["extra"] })]));
    expect(everything(all)).toContain("Overtime (OT)");
  });

  it("gives a two-line person one statement with a heading for each line and a total", () => {
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

  it("flattens control characters and line breaks in the name, the alias and the itemized names", () => {
    const view = payslipView(slip([lineOf("Front\ndesk\t one", { allowances: [{ label: "Health\nallowance", amount: 1_000n }] })], { name: "Liza\r\n  Testreyes\u0000" }));
    expect(view.name).toBe("Liza Testreyes");
    expect(view.lines[0].heading).toBe("Line: Front desk one");
    expect(view.lines[0].earnings.map((r) => r.label)).toContain("Health allowance");
  });

  it("shows deductions with a minus", () => {
    const view = payslipView(slip([lineOf(null, { loan: 1_000n })]));
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
