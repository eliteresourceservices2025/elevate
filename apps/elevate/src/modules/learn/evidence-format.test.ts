import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { evidenceCsv, evidencePdf, statusOn, summarize, type CourseStatus, type EvidenceReport } from "./evidence-format";

const cert = (reference: string, issuedOn: string, endsOn: string, revoked = false) => ({ reference, issuedOn, endsOn, revoked });
const none: CourseStatus = { status: "none", reference: null, issuedOn: null, validUntil: null };

describe("statusOn", () => {
  it("is valid inside the certificate's dates, and picks the one that ends last", () => {
    const certs = [cert("A", "2025-01-10", "2026-01-10"), cert("B", "2026-01-05", "2028-01-05")];
    expect(statusOn(certs, "2026-06-01")).toMatchObject({ status: "valid", reference: "B", validUntil: "2028-01-05" });
    expect(statusOn(certs, "2025-06-01")).toMatchObject({ status: "valid", reference: "A" });
  });
  it("is expired after the end date, none with nothing, and later when the certificate came after the date", () => {
    expect(statusOn([cert("A", "2024-01-10", "2025-01-10")], "2026-06-01")).toMatchObject({ status: "expired", reference: "A", validUntil: "2025-01-10" });
    expect(statusOn([], "2026-06-01")).toEqual(none);
    expect(statusOn([cert("A", "2026-09-01", "2028-09-01")], "2026-06-01")).toMatchObject({ status: "later", issuedOn: "2026-09-01" });
  });
  it("never counts a revoked certificate as valid", () => {
    expect(statusOn([cert("A", "2026-01-01", "2028-01-01", true)], "2026-06-01")).toMatchObject({ status: "revoked", reference: "A" });
    // a valid second certificate still wins over a revoked first one
    expect(statusOn([cert("A", "2025-01-01", "2027-01-01", true), cert("B", "2026-02-01", "2028-02-01")], "2026-06-01")).toMatchObject({ status: "valid", reference: "B" });
  });
  it("treats the end date itself as still valid", () => {
    expect(statusOn([cert("A", "2025-01-10", "2026-06-01")], "2026-06-01").status).toBe("valid");
  });
});

const report = (n = 2): EvidenceReport => ({
  clientName: "Acme Health",
  asOf: "2026-06-01",
  generatedAt: "2026-10-13T10:00:00.000Z",
  rows: Array.from({ length: n }, (_, i) => ({
    name: i === 0 ? "=SUM(A1) Maria Santos" : `Person ${i}`,
    position: "Virtual Assistant",
    assignedSince: "2026-01-05",
    hipaa: i % 2 === 0 ? { status: "valid" as const, reference: `ERSHC-2026-AAAA${i}`, issuedOn: "2026-02-01", validUntil: "2028-02-01" } : none,
    cybersecurity: none,
  })),
});

describe("the evidence files", () => {
  it("summarizes who is trained", () => {
    expect(summarize(report(4))).toEqual({ people: 4, hipaaValid: 2, hipaaNot: 2, cyberValid: 0 });
  });
  it("writes a CSV that cannot run as a formula and carries no scores", () => {
    const csv = evidenceCsv(report(2));
    expect(csv.split("\r\n")[0]).toContain("HIPAA status");
    expect(csv).toContain("'=SUM(A1) Maria Santos");
    expect(csv).toContain("Trained (certificate valid)");
    expect(csv).toContain("No certificate");
    // the columns and the people rows carry no scores or addresses (the closing note says scores are left out)
    expect(csv.split("
").slice(0, 3).join("
")).not.toMatch(/score|attempt|address/i);
  });
  it("makes a PDF, and moves to another page for a long list", async () => {
    const small = await PDFDocument.load(await evidencePdf(report(3)));
    expect(small.getPageCount()).toBe(1);
    const long = await PDFDocument.load(await evidencePdf(report(120)));
    expect(long.getPageCount()).toBeGreaterThan(1);
    // an empty client and a name with characters the standard font cannot draw still work
    const empty = await evidencePdf({ ...report(0) });
    expect(Buffer.from(empty).subarray(0, 5).toString()).toBe("%PDF-");
    const odd = await evidencePdf({ ...report(1), clientName: "Clínica 日本" });
    expect((await PDFDocument.load(odd)).getPageCount()).toBe(1);
  });
});
