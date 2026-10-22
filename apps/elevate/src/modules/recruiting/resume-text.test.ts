import { describe, expect, it } from "vitest";
import { sniffFileKind } from "@/modules/documents/files";
import { makeDocx, makePdf } from "../../../tests/helpers/resume-files";
import { scoreResume } from "./keywords";
import { extractResumeText, MAX_DOCX_UNPACKED_BYTES, zipDeclaredSize } from "./resume-text";

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

  it("reads what a Word file declares about its size, and refuses one that declares far too much without opening it", async () => {
    const docx = makeDocx(["Virtual assistant"]);
    const declared = zipDeclaredSize(docx);
    expect(declared?.parts).toBe(3);
    expect(declared!.unpacked).toBeGreaterThan(100);
    expect(declared!.unpacked).toBeLessThan(5000);
    // the same file with one part claiming 1 GB unpacked (the size field of the first central-directory entry)
    const bomb = new Uint8Array(docx);
    const view = new DataView(bomb.buffer);
    for (let i = 0; i < bomb.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 1024 * 1024 * 1024, true);
        break;
      }
    }
    expect(zipDeclaredSize(bomb)!.unpacked).toBeGreaterThan(MAX_DOCX_UNPACKED_BYTES);
    expect(await extractResumeText(bomb, "docx")).toBeNull();
    expect(zipDeclaredSize(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
});
