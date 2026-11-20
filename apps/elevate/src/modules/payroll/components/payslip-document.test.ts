import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateLine, HOLIDAY_BP, type LineInput, type SettingsSnapshot } from "../calculate";
import { formatPesos } from "../money";
import { payslipView, type PayslipInput } from "../payslip";
import { PayslipDocument } from "./payslip-document";

// The Contractor Payment Statement page draws from the same view as the PDF. Invented person and figures.
const settings: SettingsSnapshot = { cutoffDivisor: 11, changeWarnBp: 1000, multipliersBp: { regular: 12500, restDay: null, restDayOver8: null, holiday: HOLIDAY_BP } };
const input: LineInput = {
  monthlyCentavos: 2_200_000n,
  hoursPerDay: 8,
  partial: null,
  absenceDayHundredths: 0,
  sickLeaveDayHundredths: 0,
  bereavementDayHundredths: 0,
  ptoDayHundredths: 0,
  lateMinutes: 0,
  extra: { regular: 120, restDay: 0, restDayOver8: 0, holiday: 0 },
  allowances: [],
  reimbursements: [],
  bonuses: [],
  adjustments: [],
  loan: 0n,
  otherDeductions: 0n,
};
const result = calculateLine(input, settings);
const slip = (over: Partial<PayslipInput> = {}): PayslipInput => ({
  name: "Liza Testreyes",
  periodStart: "2029-01-01",
  periodEnd: "2029-01-15",
  hiredOn: "2027-03-01",
  lines: [{ alias: null, clientName: null, input, result }],
  paidOn: "2029-01-16",
  payslipNumber: "PS-TEST0001-ABCD",
  paymentMethods: ["remitly"],
  multipliersBp: settings.multipliersBp,
  signatory: null,
  ...over,
});
const html = (over: Partial<PayslipInput> = {}) => renderToStaticMarkup(createElement(PayslipDocument, { view: payslipView(slip(over)) }));

describe("PayslipDocument", () => {
  it("shows the person, the period, the paid date, the figures and the net pay", () => {
    const out = html();
    for (const text of ["Liza Testreyes", "2029-01-01 to 2029-01-15", "2029-01-16", "Remitly", "PS-TEST0001-ABCD", "Total compensation", "Total deductions", "Compensation", "Deductions", "Monthly rate", "Total payable compensation", "2 h at 125%"]) expect(out).toContain(text);
    expect(out).toContain(formatPesos(result.net));
  });

  it("says Not signed when no signatory was kept with the run, and shows who signed when one was", () => {
    expect(html()).toContain("Not signed");
    const signed = html({ signatory: { name: "Carmen Dela Rosa", title: "Human Resources Director", signedOn: "2029-01-16", signatureBase64: "QUJD" } });
    expect(signed).toContain("Carmen Dela Rosa");
    expect(signed).toContain("Human Resources Director");
    expect(signed).toContain("Signed on 2029-01-16");
    expect(signed).toContain("data:image/jpeg;base64,QUJD");
    expect(signed).not.toContain("Not signed");
    // A signatory without a picture still shows the name and title, and no empty image.
    const bare = html({ signatory: { name: "Carmen Dela Rosa", title: "Director", signedOn: "2029-01-16", signatureBase64: null } });
    expect(bare).toContain("Carmen Dela Rosa");
    expect(bare).not.toContain("data:image");
  });

  it("escapes a name that looks like markup", () => {
    const out = html({ name: "<script>alert(1)</script>" });
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("shows a heading and a total for a person with two lines", () => {
    const out = html({ lines: [{ alias: "Front desk", clientName: null, input, result }, { alias: "Billing", clientName: null, input, result }] });
    expect(out).toContain("Line: Front desk");
    expect(out).toContain("Line: Billing");
    expect(out).toContain("Total payable compensation, all lines");
  });
});
