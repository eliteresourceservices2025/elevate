import { describe, expect, it } from "vitest";
import { calculateLine, EXTRA_KEYS, HOLIDAY_BP, type LineInput, type SettingsSnapshot } from "./calculate";
import { PAY_ITEM_LABELS } from "./constants";
import { formatPesos } from "./money";
import { payslipView, type PayslipInput } from "./payslip";

// Invented person and figures. Money is bigint centavos. The statement is the Contractor Payment Statement: compensation and deductions,
// every row always listed, a dash when there is nothing.
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
const lineOf = (alias: string | null, over: Partial<LineInput> = {}, clientName: string | null = null) => {
  const input = { ...baseInput, ...over };
  return { alias, clientName, input, result: calculateLine(input, settings) };
};
const slip = (lines: PayslipInput["lines"], over: Partial<PayslipInput> = {}): PayslipInput => ({
  name: "Liza Testreyes",
  periodStart: "2029-01-01",
  periodEnd: "2029-01-15",
  hiredOn: "2027-03-01",
  lines,
  paidOn: "2029-01-16",
  payslipNumber: "PS-TEST0001-ABCD",
  paymentMethods: ["remitly"],
  multipliersBp: settings.multipliersBp,
  signatory: null,
  ...over,
});
const everything = (view: ReturnType<typeof payslipView>) => JSON.stringify(view);
type LineView = ReturnType<typeof payslipView>["lines"][number];
const row = (rows: LineView["compensation"], label: string) => rows.find((r) => r.label === label);

describe("payslipView", () => {
  it("shows the person, the period, the date of hire, the paid date and how they were paid", () => {
    const view = payslipView(slip([lineOf(null, {}, "Testclinic")]));
    expect(view.title).toBe("Contractor Payment Statement");
    expect(view.name).toBe("Liza Testreyes");
    expect(view.period).toBe("2029-01-01 to 2029-01-15");
    expect(view.number).toBe("PS-TEST0001-ABCD");
    expect(view.hiredOn).toBe("2027-03-01");
    expect(view.paidOn).toBe("2029-01-16");
    expect(view.paidBy).toBe("Remitly");
    expect(view.lines[0].client).toBe("Testclinic");
    expect(payslipView(slip([lineOf(null)], { hiredOn: null })).hiredOn).toBeNull();
    expect(payslipView(slip([lineOf(null)])).lines[0].client).toBeNull();
  });

  it("lists every kind of compensation, deduction and leave even when there is nothing, with a dash", () => {
    const [one] = payslipView(slip([lineOf(null)])).lines;
    expect(one.compensation.map((r) => r.label)).toEqual([
      "Base pay for the period",
      PAY_ITEM_LABELS.extra_regular,
      PAY_ITEM_LABELS.extra_rest_day,
      PAY_ITEM_LABELS.extra_rest_day_over_8,
      PAY_ITEM_LABELS.holiday,
      "Allowances",
      "Reimbursements",
      "Bonuses",
      "Adjustments",
    ]);
    expect(one.compensation.slice(1).every((r) => r.amount === "-")).toBe(true);
    expect(one.deductions.map((r) => r.label)).toEqual([
      PAY_ITEM_LABELS.absence_days,
      PAY_ITEM_LABELS.sick_leave_days,
      PAY_ITEM_LABELS.late_minutes,
      PAY_ITEM_LABELS.loan,
      PAY_ITEM_LABELS.other_deduction,
    ]);
    expect(one.deductions.every((r) => r.amount === "-")).toBe(true);
    expect(one.leave.map((r) => r.label)).toEqual([PAY_ITEM_LABELS.bereavement_days, PAY_ITEM_LABELS.pto_days, PAY_ITEM_LABELS.sick_leave_days]);
    expect(one.leave.every((r) => r.amount === "-")).toBe(true);
    expect(one.totalDeductions).toBe("0.00");
    expect(one.totalCompensation).toBe(one.net);
  });

  it("shows how the pay was worked out: the monthly, daily and hourly rates and the hours per day", () => {
    const [one] = payslipView(slip([lineOf(null)])).lines;
    expect(one.computation).toEqual([
      { label: "Monthly rate", detail: "", amount: "22,000.00" },
      { label: "Daily rate", detail: "", amount: "1,000.00" },
      { label: "Hourly rate", detail: "", amount: "125.00" },
      { label: "Hours per day", detail: "", amount: "8" },
    ]);
  });

  it("puts each itemized line under the name it was given, with its kind", () => {
    const line = lineOf(null, {
      allowances: [
        { label: "Health allowance", amount: 100_000n },
        { label: "Internet", amount: 50_000n },
      ],
      reimbursements: [{ label: "Supplies", amount: 12_000n }],
      bonuses: [{ label: "Performance bonus", amount: 200_000n }],
      adjustments: [{ label: "Correction", amount: 25_000n }],
    });
    const { compensation } = payslipView(slip([line])).lines[0];
    expect(row(compensation, "Health allowance")).toEqual({ label: "Health allowance", detail: "Allowance", amount: "1,000.00" });
    expect(row(compensation, "Internet")?.amount).toBe("500.00");
    expect(row(compensation, "Supplies")).toEqual({ label: "Supplies", detail: "Reimbursement", amount: "120.00" });
    expect(row(compensation, "Performance bonus")).toEqual({ label: "Performance bonus", detail: "Bonus", amount: "2,000.00" });
    expect(row(compensation, "Correction")).toEqual({ label: "Correction", detail: "Adjustment", amount: "250.00" });
    // A kind that has named lines no longer shows its dash row.
    expect(row(compensation, "Allowances")).toBeUndefined();
    expect(row(compensation, "Bonuses")).toBeUndefined();
  });

  it("explains each overtime line with the hours and the rate it was made with, and holiday pay at 100%", () => {
    const line = lineOf(null, { extra: { ...noExtra, regular: 90, holiday: 480 } });
    const { compensation } = payslipView(slip([line])).lines[0];
    const ot = row(compensation, PAY_ITEM_LABELS.extra_regular);
    expect(ot?.detail).toBe("1 h 30 min at 125%");
    expect(ot?.amount).toBe(formatPesos(line.result.extra.regular));
    expect(row(compensation, PAY_ITEM_LABELS.holiday)?.detail).toBe("8 h at 100%");
    const unknown = payslipView(slip([line], { multipliersBp: null })).lines[0].compensation;
    expect(row(unknown, PAY_ITEM_LABELS.extra_regular)?.detail).toBe("1 h 30 min");
    expect(row(unknown, PAY_ITEM_LABELS.holiday)?.detail).toBe("8 h at 100%");
  });

  it("shows a part cutoff with the days and hours worked", () => {
    const line = lineOf(null, { partial: { dayHundredths: 300, minutes: 120 } });
    const base = payslipView(slip([line])).lines[0].compensation[0];
    expect(base.detail).toBe("3 days 2 h worked");
    expect(base.amount).toBe(formatPesos(line.result.base));
  });

  it("shows paid bereavement and PTO days, and unpaid sick leave as a deduction", () => {
    const line = lineOf(null, { bereavementDayHundredths: 300, ptoDayHundredths: 100, sickLeaveDayHundredths: 100 });
    const [one] = payslipView(slip([line])).lines;
    expect(one.leave.map((r) => r.amount)).toEqual(["3 days", "1 day", "1 day"]);
    expect(row(one.deductions, PAY_ITEM_LABELS.sick_leave_days)).toEqual({ label: PAY_ITEM_LABELS.sick_leave_days, detail: "1 day", amount: formatPesos(line.result.sickLeave) });
  });

  it("adds up: total compensation minus total deductions is the total payable", () => {
    const line = lineOf(null, {
      absenceDayHundredths: 100,
      lateMinutes: 30,
      extra: { ...noExtra, regular: 90 },
      allowances: [{ label: "Health allowance", amount: 100_000n }],
      reimbursements: [{ label: "Supplies", amount: 12_000n }],
      bonuses: [{ label: "Bonus", amount: 100_000n }],
      adjustments: [{ label: "Adjustment", amount: 25_000n }],
      loan: 50_000n,
      otherDeductions: 10_000n,
    });
    const { totalCompensation, totalDeductions, net } = payslipView(slip([line])).lines[0];
    const r = line.result;
    const comp = r.base + EXTRA_KEYS.reduce((sum, k) => sum + r.extra[k], 0n) + 100_000n + 12_000n + 100_000n + 25_000n;
    const ded = r.absences + r.late + 50_000n + 10_000n;
    expect(totalCompensation).toBe(formatPesos(comp));
    expect(totalDeductions).toBe(formatPesos(ded));
    expect(net).toBe(formatPesos(comp - ded));
    expect(net).toBe(formatPesos(r.net));
  });

  it("has no dollar wording and no tax or contribution line", () => {
    const view = payslipView(slip([lineOf(null)]));
    expect(everything(view)).not.toMatch(/dollar|usd|payslip|tax|sss|philhealth|hdmf/i);
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

  it("flattens control characters and line breaks in the name, the alias, the client and the itemized names", () => {
    const view = payslipView(slip([lineOf("Front\ndesk\t one", { allowances: [{ label: "Health\nallowance", amount: 1_000n }] }, "Test\nclinic")], { name: "Liza\r\n  Testreyes\u0000" }));
    expect(view.name).toBe("Liza Testreyes");
    expect(view.lines[0].heading).toBe("Line: Front desk one");
    expect(view.lines[0].client).toBe("Test clinic");
    expect(view.lines[0].compensation.map((r) => r.label)).toContain("Health allowance");
  });

  it("shows deductions as positive amounts in the deductions column", () => {
    const view = payslipView(slip([lineOf(null, { loan: 1_000n })]));
    expect(row(view.lines[0].deductions, PAY_ITEM_LABELS.loan)?.amount).toBe("10.00");
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
