import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { longDate, renderCertificatePdf } from "./certificate-pdf";

const input = {
  holderName: "Maria Santos",
  courseTitle: "HIPAA training",
  issuedOn: "2026-10-13",
  endsOn: "2027-10-13",
  reference: "ERSHC-2026-ABCDEF",
  verifyUrl: "https://learn.example.test/verify",
};

describe("certificate PDF", () => {
  it("makes a one-page PDF", async () => {
    const bytes = await renderCertificatePdf(input);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("copes with long names, titles and characters the standard fonts cannot draw", async () => {
    const bytes = await renderCertificatePdf({ ...input, holderName: "Ñandú ".repeat(12) + "李小龍", courseTitle: "A very long course title ".repeat(8) });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("writes dates in words and leaves other text alone", () => {
    expect(longDate("2026-10-13")).toBe("13 October 2026");
    expect(longDate("2027-01-05")).toBe("5 January 2027");
    expect(longDate("soon")).toBe("soon");
  });

  it("is the same file as the one in ELEVATE Learn (change both together)", () => {
    const here = readFileSync(resolve(__dirname, "certificate-pdf.ts"), "utf8").replace(/\r\n/g, "\n");
    const there = readFileSync(resolve(__dirname, "../../../../learn/src/lib/certificate-pdf.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(here).toBe(there);
  });
});
