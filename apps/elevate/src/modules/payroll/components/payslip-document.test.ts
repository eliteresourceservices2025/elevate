import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateLine, type LineInput, type SettingsSnapshot } from "../calculate";
import { formatPesos } from "../money";
import { payslipView, type PayslipInput } from "../payslip";
import { PayslipDocument } from "./payslip-document";

// The payslip page draws from the same view as the PDF. Invented person and figures.
const settings: SettingsSnapshot = { cutoffDivisor: 11, changeWarnBp: 1000, multipliersBp: { regular: 12500, holiday: null, restDay: null, restDayOver8: null, holidayPay: null } };
const input: LineInput = {
  monthlyCentavos: 2_200_000n,
  hoursPerDay: 8,
  partial: null,
  absenceDayHundredths: 0,
  lateMinutes: 0,
  extra: { regular: 120, holiday: 0, restDay: 0, restDayOver8: 0, holidayPay: 0 },
  pesoAllowance: 0n,
  dollarAllowanceCents: 0n,
  adjustment: 0n,
  loan: 0n,
  otherDeductions: 0n,
};
const result = calculateLine(input, settings, 585_000);
const slip = (over: Partial<PayslipInput> = {}): PayslipInput => ({
  name: "Liza Testreyes",
  periodStart: "2029-01-01",
  periodEnd: "2029-01-15",
  usdRateE4: 585_000,
  lines: [{ alias: null, input, result }],
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
    for (const text of ["Liza Testreyes", "2029-01-01 to 2029-01-15", "2029-01-16", "Remitly", "PS-TEST0001-ABCD", "Gross pay", "Net pay", "2 h at 125%"]) expect(out).toContain(text);
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
    const out = html({ lines: [{ alias: "Front desk", input, result }, { alias: "Billing", input, result }] });
    expect(out).toContain("Line: Front desk");
    expect(out).toContain("Line: Billing");
    expect(out).toContain("Total net pay");
  });
});
