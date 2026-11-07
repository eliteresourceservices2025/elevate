import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { calculateLine, HOLIDAY_BP, type LineInput } from "./calculate";
import { payslipView, type PayslipView } from "./payslip";

// The payslip PDF draws, and a signature picture that cannot be drawn never blocks the payslip. Invented person and figures.

vi.mock("server-only", () => ({}));
vi.mock("@react-pdf/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-pdf/renderer")>();
  return {
    ...actual,
    // Stands in for a picture the PDF library cannot draw: the first attempt with a picture fails, as it would for a damaged one.
    renderToBuffer: vi.fn(async (element: { props: { view: PayslipView } }) => {
      if (element.props.view.signature?.imageBase64 === "BROKEN") throw new Error("cannot draw the picture");
      return actual.renderToBuffer(element as never);
    }),
  };
});

const { renderPayslipPdf } = await import("./payslip-pdf");

const view = (imageBase64: string | null): PayslipView => ({
  title: "Contractor Payment Statement",
  number: "PS-TEST0001-ABCD",
  name: "Liza Testreyes",
  period: "2029-01-01 to 2029-01-15",
  paidOn: "2029-01-16",
  paidBy: "Remitly",
  hiredOn: "2027-03-01",
  lines: [
    {
      heading: null,
      client: "Testclinic",
      computation: [{ label: "Monthly rate", detail: "", amount: "22,000.00" }],
      compensation: [{ label: "Base pay for the period", detail: "", amount: "11,000.00" }, { label: "Allowances", detail: "", amount: "-" }],
      totalCompensation: "11,000.00",
      deductions: [{ label: "Absent days", detail: "", amount: "-" }],
      totalDeductions: "0.00",
      leave: [{ label: "PTO days, paid", detail: "", amount: "-" }],
      net: "11,000.00",
    },
  ],
  total: null,
  signature: { name: "Carmen Dela Rosa", title: "Human Resources Director", signedOn: "2029-01-16", imageBase64 },
});

const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";

afterEach(() => vi.restoreAllMocks());

describe("renderPayslipPdf", () => {
  it("fits a busy statement (overtime, holiday pay, named allowances, a reimbursement, a bonus, a loan, leave and a signature) on one A4 page", async () => {
    const settings = { cutoffDivisor: 11, changeWarnBp: 1000, multipliersBp: { regular: 12500, restDay: 13000, restDayOver8: 16900, holiday: HOLIDAY_BP } };
    const input: LineInput = {
      monthlyCentavos: 2_200_000n,
      hoursPerDay: 8,
      partial: null,
      absenceDayHundredths: 100,
      sickLeaveDayHundredths: 50,
      bereavementDayHundredths: 200,
      ptoDayHundredths: 100,
      lateMinutes: 30,
      extra: { regular: 90, restDay: 60, restDayOver8: 30, holiday: 480 },
      allowances: [
        { label: "Health allowance", amount: 100_000n },
        { label: "Internet allowance", amount: 50_000n },
      ],
      reimbursements: [{ label: "Supplies", amount: 12_000n }],
      bonuses: [{ label: "Performance bonus", amount: 200_000n }],
      adjustments: [{ label: "Correction", amount: 7_500n }],
      loan: 50_000n,
      otherDeductions: 10_000n,
    };
    const busy = payslipView({
      name: "Liza Testreyes",
      periodStart: "2029-01-01",
      periodEnd: "2029-01-15",
      hiredOn: "2027-03-01",
      lines: [{ alias: null, clientName: "Testclinic", input, result: calculateLine(input, settings) }],
      paidOn: "2029-01-16",
      payslipNumber: "PS-TEST0001-ABCD",
      paymentMethods: ["remitly"],
      multipliersBp: settings.multipliersBp,
      signatory: { name: "Carmen Dela Rosa", title: "Human Resources Director", signedOn: "2029-01-16", signatureBase64: null },
    });
    const bytes = await renderPayslipPdf(busy);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    // Everything HR asked for is on the page: the certification, the signature lines, the disclaimer, and the no-tax note.
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
    for (const needle of ["CERTIFICATION", "Contractor signature (optional)", "DISCLAIMER", "Independent Contractor", "No tax, SSS", "PS-TEST0001-ABCD"]) {
      expect(text.toUpperCase(), text.slice(-700)).toContain(needle.toUpperCase());
    }
  });

  it("draws a payslip with a signature, and one that was not signed", async () => {
    expect(isPdf(await renderPayslipPdf(view(null)))).toBe(true);
    expect(isPdf(await renderPayslipPdf({ ...view(null), signature: null }))).toBe(true);
  });

  it("still draws the payslip when the signature picture cannot be drawn, and logs only the kind of error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const pdf = await renderPayslipPdf(view("BROKEN"));
    expect(isPdf(pdf)).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls[0])).not.toContain("BROKEN");
    expect(JSON.stringify(log.mock.calls[0])).toContain("Error");
  });
});
