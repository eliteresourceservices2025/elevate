import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { BUILTIN_TEMPLATES } from "./builtin-templates";
import { renderComposedPdf } from "./compose";
import { isPdf } from "./constants";

describe("ready-made documents", () => {
  it("have unique ids, a title, a signer role and text that is not truncated or full of stray marks", () => {
    expect(new Set(BUILTIN_TEMPLATES.map((t) => t.id)).size).toBe(BUILTIN_TEMPLATES.length);
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.roles.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(200);
      expect(t.body).not.toMatch(/\?\?|\uFFFD/);
    }
  });
  for (const t of BUILTIN_TEMPLATES) {
    it(`${t.name} renders as a PDF`, async () => {
      const pdf = await renderComposedPdf(t.title, t.body);
      expect(isPdf(pdf)).toBe(true);
      expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("the contract documents", () => {
  it("use only known fields, and the NDA asks HR for the Company address before it can be sent", async () => {
    const { mergeProblem, unfilledPlaceholders } = await import("./merge");
    for (const t of BUILTIN_TEMPLATES) expect(mergeProblem(t.body)).toBeNull();
    const nda = BUILTIN_TEMPLATES.find((t) => t.id === "nda");
    expect(nda?.countersignerRole).toBe("Head of People Operations");
    expect(unfilledPlaceholders(nda?.body ?? "")).toEqual(["Company business address"]);
    expect(nda?.body).toContain("{{contractor_name}}");
    expect(nda?.body).toContain("{{contractor_address}}");
    // Nothing else is left to fill in by hand, and no signature or date lines (the signature page covers them)
    for (const t of BUILTIN_TEMPLATES) if (t.id !== "nda") expect(unfilledPlaceholders(t.body)).toEqual([]);
    for (const t of BUILTIN_TEMPLATES) expect(t.body).not.toMatch(/_{5,}/);
  });
  it("renders the handbook as several pages", async () => {
    const hb = BUILTIN_TEMPLATES.find((t) => t.id === "contractor-handbook");
    const pdf = await renderComposedPdf(hb?.title ?? "", hb?.body ?? "");
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(4);
  });
});
