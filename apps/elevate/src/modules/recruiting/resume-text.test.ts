import { describe, expect, it } from "vitest";
import { sniffFileKind } from "@/modules/documents/files";
import { makeDocx, makePdf } from "../../../tests/helpers/resume-files";
import { scoreResume } from "./keywords";
import { extractResumeText } from "./resume-text";

describe("extractResumeText", () => {
  it("reads the text of a PDF", async () => {
    const text = await extractResumeText(await makePdf(["Medical billing specialist", "Skills: Excel, HIPAA"]), "pdf");
    expect(text).toContain("Medical billing specialist");
    expect(scoreResume(text!, { required: ["medical billing", "excel"], nice: ["hipaa"] }).score).toBe(100);
  });

  it("reads the text of a Word document, and the helper really makes a file the app accepts as DOCX", async () => {
    const bytes = makeDocx(["Virtual assistant", "Fluent in Spanish & English"]);
    expect(sniffFileKind(bytes)).toBe("docx");
    const text = await extractResumeText(bytes, "docx");
    expect(text).toContain("Virtual assistant");
    expect(text).toContain("Spanish & English");
  });

  it("returns null for a PDF with no text (a scan), for damaged files and for an unknown kind, and never throws", async () => {
    expect(await extractResumeText(await makePdf([]), "pdf")).toBeNull();
    expect(await extractResumeText(new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]), "pdf")).toBeNull();
    expect(await extractResumeText(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]), "docx")).toBeNull();
    expect(await extractResumeText(new Uint8Array([1, 2, 3]), "exe")).toBeNull();
    expect(await extractResumeText(new Uint8Array(), null)).toBeNull();
  });
});
