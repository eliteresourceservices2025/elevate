import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CATEGORY_LABELS, KNOWN_TYPE_SLUGS, typeStyle } from "./type-style";

describe("how a document type looks", () => {
  it("puts the seeded types in a category, with a different colour for each category", () => {
    expect(typeStyle("nbi_clearance").category).toBe("identity");
    expect(typeStyle("government_id").category).toBe("identity");
    expect(typeStyle("hipaa_training").category).toBe("training");
    expect(typeStyle("training_certificate").category).toBe("training");
    expect(typeStyle("contract").category).toBe("agreements");
    expect(typeStyle("signed_document").category).toBe("agreements");
    expect(typeStyle("company_policy").category).toBe("company");
    const colours = new Set((["nbi_clearance", "hipaa_training", "contract", "company_policy", "resume"] as const).map((s) => typeStyle(s).className));
    expect(colours.size).toBe(5);
  });
  it("gives a type nobody planned for a neutral style, never an error (also for names that look like object keys)", () => {
    for (const slug of ["something_new", "constructor", "__proto__", "toString"]) {
      const s = typeStyle(slug);
      expect(s.category).toBe("other");
      expect(s.className).toBeTruthy();
    }
  });
  it("has a style for every document type the database is seeded with", () => {
    const seed = readFileSync(path.join(process.cwd(), "drizzle", "0009_document_types_seed.sql"), "utf8");
    const slugs = [...seed.matchAll(/^\s*\('([a-z_]+)',/gm)].map((m) => m[1]);
    expect(slugs.length).toBeGreaterThanOrEqual(10);
    expect(slugs.filter((slug) => !KNOWN_TYPE_SLUGS.includes(slug))).toEqual([]);
  });

  it("labels every category", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual(["agreements", "company", "identity", "other", "training"]);
  });
});
