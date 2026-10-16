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
