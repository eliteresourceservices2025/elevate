import { afterEach, describe, expect, it, vi } from "vitest";
import type { PayslipView } from "./payslip";

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
  lines: [{ heading: null, earnings: [{ label: "Base pay for the period", detail: "", amount: "11,000.00" }], leave: [], gross: "11,000.00", reimbursements: [], bonuses: [], adjustments: [], deductions: [], net: "11,000.00" }],
  total: null,
  signature: { name: "Carmen Dela Rosa", title: "Human Resources Director", signedOn: "2029-01-16", imageBase64 },
});

const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-";

afterEach(() => vi.restoreAllMocks());

describe("renderPayslipPdf", () => {
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
