import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { RecordEntry } from "./queries";
import { renderRecordPdf } from "./record-pdf";

const entry = (n: number): RecordEntry => ({
  assignmentId: `a${n}`,
  courseTitle: `Course ${n} with a fairly long title that goes on for a while so that it has to wrap`,
  track: "full",
  status: "passed",
  assignedOn: "2026-01-05",
  dueOn: "2026-02-04",
  passedOn: "2026-01-20",
  minutesSpent: 118,
  attempts: 2,
  scorePercent: 90,
  certificate: { assignmentId: `a${n}`, reference: "ERSHC-2026-ABC234", issuedOn: "2026-01-20", endsOn: "2027-01-20", revoked: false },
});

describe("the combined training record PDF", () => {
  it("makes a valid PDF for someone with no training yet", async () => {
    const bytes = await renderRecordPdf({ holderName: "Ana Cruz", generatedOn: "2026-10-15", entries: [] });
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("pages a long record and survives characters the standard font cannot draw", async () => {
    const entries = Array.from({ length: 40 }, (_, i) => entry(i));
    const bytes = await renderRecordPdf({ holderName: "María Núñez 山田", generatedOn: "2026-10-15", entries });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
});
