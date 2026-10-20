import { describe, expect, it } from "vitest";
import { CATEGORY_LABELS, typeStyle } from "./type-style";

describe("how a document type looks", () => {
  it("puts the seeded types in a category, with a different colour for each category", () => {
    expect(typeStyle("nbi_clearance").category).toBe("identity");
    expect(typeStyle("government_id").category).toBe("identity");
    expect(typeStyle("hipaa_training").category).toBe("training");
    expect(typeStyle("training_certificate").category).toBe("training");
    expect(typeStyle("contract").category).toBe("agreements");
    expect(typeStyle("signed_document").category).toBe("agreements");
    expect(typeStyle("policy").category).toBe("company");
    const colours = new Set((["nbi_clearance", "hipaa_training", "contract", "policy", "resume"] as const).map((s) => typeStyle(s).className));
    expect(colours.size).toBe(5);
  });
  it("gives a type nobody planned for a neutral style, never an error (also for names that look like object keys)", () => {
    for (const slug of ["something_new", "constructor", "__proto__", "toString"]) {
      const s = typeStyle(slug);
      expect(s.category).toBe("other");
      expect(s.className).toBeTruthy();
    }
  });
  it("labels every category", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual(["agreements", "company", "identity", "other", "training"]);
  });
});
