import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import type { InvoiceView } from "./service";

vi.mock("server-only", () => ({}));

const { renderInvoicePdf } = await import("./invoice-pdf");
const { invoiceText } = await import("./invoice-text");

const view = (over: Partial<InvoiceView> = {}): InvoiceView => ({
  id: "11111111-1111-4111-8111-111111111111",
  number: "INV-2031-0001",
  runId: "22222222-2222-4222-8222-222222222222",
  clientId: "33333333-3333-4333-8333-333333333333",
  runStatus: "approved",
  isTest: false,
  issuedOn: "2031-02-03",
  createdAt: new Date(),
  clientName: "Testclinic Family Care",
  periodStart: "2031-01-01",
  periodEnd: "2031-01-15",
  rateCents: 1235n,
  lines: [
    { name: "Ana Testcruz", alias: "Front desk", hoursHundredths: 8650n, amountCents: 106828n },
    { name: "Ben Testreyes", alias: null, hoursHundredths: 3333n, amountCents: 41163n },
  ],
  totalHoursHundredths: 11983n,
  totalCents: 147991n,
  unconfirmedLines: 0,
  ...over,
});

const textOf = async (bytes: Uint8Array) => {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
};

describe("invoice PDF", () => {
  it("draws one A4 page with the figures and no undefined or NaN", async () => {
    const bytes = await renderInvoicePdf(invoiceText(view()));
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
    const text = await textOf(bytes);
    for (const s of ["INV-2031-0001", "Testclinic Family Care", "1,479.91", "119.83", "Ana Testcruz (Front desk)", "USD"]) expect(text).toContain(s);
    expect(text).not.toMatch(/undefined|NaN|null/);
    expect(text).not.toContain("DRAFT");
  });

  it("stamps TEST on an invoice made from a test run, and nothing on a real one", async () => {
    const test = await textOf(await renderInvoicePdf(invoiceText(view({ isTest: true, number: "TEST-2031-0001" }))));
    expect(test).toContain("TEST-2031-0001");
    expect(test).toContain("not a real invoice");
    const real = await textOf(await renderInvoicePdf(invoiceText(view())));
    expect(real).not.toContain("not a real invoice");
  });

  it("says DRAFT for a draft run and shows the unconfirmed note", async () => {
    const text = await textOf(await renderInvoicePdf(invoiceText(view({ runStatus: "draft", unconfirmedLines: 2 }))));
    expect(text).toContain("DRAFT");
    expect(text).toContain("2 lines use suggested hours that are not confirmed yet.");
  });

  it("does not fail on characters the font cannot draw", async () => {
    const bytes = await renderInvoicePdf(invoiceText(view({ clientName: "Klinik 北京" })));
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
