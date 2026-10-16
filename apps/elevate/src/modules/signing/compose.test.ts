import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderComposedPdf } from "./compose";
import { isPdf } from "./constants";

describe("a document written in ELEVATE", () => {
  const handbook = [
    "# Independent Contractor Handbook",
    "",
    "Welcome to ELITE Resource Services \u2014 we\u2019re glad you\u2019re here.",
    "",
    "## 1. About us",
    "",
    "- **Executive Assistance** \u2013 calendars and email",
    "- Back-office support",
    "",
    ...Array.from({ length: 60 }, (_, i) => `${i + 1}. Policy line ${i + 1} that explains what is expected of every contractor in plain words.`),
  ].join("\n");

  it("becomes a valid multi-page PDF", async () => {
    const pdf = await renderComposedPdf("Contractor Handbook", handbook);
    expect(isPdf(pdf)).toBe(true);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(1);
  });
  it("refuses an empty or oversized document", async () => {
    await expect(renderComposedPdf("T", "short")).rejects.toThrow(/Write the document/);
    await expect(renderComposedPdf("T", "a".repeat(60_001))).rejects.toThrow(/too long/);
  });
});
