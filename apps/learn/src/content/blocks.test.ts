import { describe, expect, it } from "vitest";
import { blockSchema } from "./schema";

// The block types added for the deeper courses: table, layers, timeline, glossary and a worked case. All plain data.

describe("richer lesson blocks", () => {
  it("accepts a table whose rows match its columns", () => {
    const ok = blockSchema.safeParse({ type: "table", caption: "What the agreement holds", columns: ["Item", "Why"], rows: [["Permitted uses", "Limits what the vendor may do"], ["Safeguards", "Keeps the data protected"]] });
    expect(ok.success).toBe(true);
  });

  it("refuses a table row with the wrong number of cells, and a table with one column", () => {
    expect(blockSchema.safeParse({ type: "table", columns: ["A", "B"], rows: [["only one", "two", "three"]] }).success).toBe(false);
    expect(blockSchema.safeParse({ type: "table", columns: ["A"], rows: [["x"]] }).success).toBe(false);
  });

  it("accepts layers and a timeline, and enforces their sizes", () => {
    expect(blockSchema.safeParse({ type: "layers", items: [{ label: "Administrative", text: "Policies and training" }, { label: "Physical", text: "Doors and screens" }] }).success).toBe(true);
    expect(blockSchema.safeParse({ type: "layers", items: [{ label: "Only one", text: "x" }] }).success).toBe(false);
    expect(blockSchema.safeParse({ type: "timeline", items: [{ when: "Day 0", text: "Found" }, { when: "Day 60", text: "Notice due" }] }).success).toBe(true);
    expect(blockSchema.safeParse({ type: "timeline", items: [{ when: "Day 0", text: "Found" }] }).success).toBe(false);
  });

  it("accepts a glossary and a worked case, and rejects a case with no answer", () => {
    expect(blockSchema.safeParse({ type: "glossary", terms: [{ term: "PHI", meaning: "Health information that identifies a person" }, { term: "ePHI", meaning: "PHI held or sent electronically" }] }).success).toBe(true);
    expect(blockSchema.safeParse({ type: "case", title: "A call from a clinic", scenario: "A caller asks for a schedule.", question: "What do you do?", answer: "Verify first, then share only the minimum." }).success).toBe(true);
    expect(blockSchema.safeParse({ type: "case", title: "No answer", scenario: "A caller asks.", question: "What do you do?", answer: "" }).success).toBe(false);
  });
});
