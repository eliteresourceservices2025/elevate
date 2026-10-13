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
  modules: [
    { title: "Foundations", completedOn: "2026-10-01" },
    { title: "Protected health information", completedOn: "2026-10-02" },
    { title: "A module with a rather long title that has to shrink to fit the line", completedOn: null },
  ],
  scorePercent: 93.3,
  takenOn: "2026-10-13",
  ipAddress: "203.0.113.24",
};

describe("certificate PDF", () => {
  it("makes a certificate page and a transcript page", async () => {
    const bytes = await renderCertificatePdf(input);
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
  });

  it("copes with long names, titles and characters the standard fonts cannot draw", async () => {
    const bytes = await renderCertificatePdf({ ...input, holderName: "Ñandú ".repeat(12) + "李小龍", courseTitle: "A very long course title ".repeat(8) });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
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

  it("has the same logo file as ELEVATE Learn", () => {
    const here = readFileSync(resolve(__dirname, "certificate-logo.ts"), "utf8").replace(/\r\n/g, "\n");
    const there = readFileSync(resolve(__dirname, "../../../../learn/src/lib/certificate-logo.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(here).toBe(there);
  });

  it("still works with no transcript details", async () => {
    const { modules: _m, scorePercent: _s, takenOn: _t, ipAddress: _i, ...bare } = input;
    expect((await PDFDocument.load(await renderCertificatePdf(bare))).getPageCount()).toBe(2);
  });
});
