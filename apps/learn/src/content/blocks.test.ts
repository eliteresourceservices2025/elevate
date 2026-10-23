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

describe("interactive lesson blocks", () => {
  const opt = (correct: boolean) => ({ text: correct ? "Right" : "Wrong", correct, feedback: "Because." });

  it("accepts a sort block and enforces its size", () => {
    expect(blockSchema.safeParse({ type: "sort", title: "Order", prompt: "Put these in order.", items: ["Listen", "Clarify", "Confirm"], explanation: "Understand first." }).success).toBe(true);
    expect(blockSchema.safeParse({ type: "sort", title: "Order", prompt: "p", items: ["Only one"], explanation: "e" }).success).toBe(false);
  });

  it("accepts cards only when every card points at a real group", () => {
    const base = { type: "cards", title: "Empathy?", prompt: "Sort", groups: ["Empathy", "Not empathy"] };
    const cards = [0, 1, 0].map((group, i) => ({ text: `Card ${i}`, group, feedback: "Why." }));
    expect(blockSchema.safeParse({ ...base, cards }).success).toBe(true);
    expect(blockSchema.safeParse({ ...base, cards: [...cards.slice(0, 2), { text: "Bad", group: 2, feedback: "Why." }] }).success).toBe(false);
  });

  it("needs a marked mistake in a spot block", () => {
    const lines = (wrong: boolean) => [{ speaker: "Caller", text: "Hello" }, { speaker: "Rep", text: "That is not my fault", wrong }, { speaker: "Caller", text: "Right" }];
    expect(blockSchema.safeParse({ type: "spot", title: "Find it", prompt: "Tap the mistake.", lines: lines(true), explanation: "Defensive reply." }).success).toBe(true);
    expect(blockSchema.safeParse({ type: "spot", title: "Find it", prompt: "Tap the mistake.", lines: lines(false), explanation: "None." }).success).toBe(false);
  });

  it("needs exactly one correct option in each build slot and game round", () => {
    const slot = (n: number) => ({ label: "Date and time", options: [opt(n > 0), opt(n > 1)] });
    expect(blockSchema.safeParse({ type: "build", title: "Note", prompt: "Build it.", slots: [slot(1), slot(1)] }).success).toBe(true);
    expect(blockSchema.safeParse({ type: "build", title: "Note", prompt: "Build it.", slots: [slot(1), slot(2)] }).success).toBe(false);
    const round = (n: number) => ({ question: "Q?", options: [opt(n > 0), opt(n > 1)] });
    expect(blockSchema.safeParse({ type: "game", title: "Round", seconds: 20, rounds: [round(1), round(1), round(1)] }).success).toBe(true);
    expect(blockSchema.safeParse({ type: "game", title: "Round", rounds: [round(1), round(1), round(0)] }).success).toBe(false);
  });

  it("accepts flip cards and a call with a mood meter, and keeps mood changes small", () => {
    expect(blockSchema.safeParse({ type: "flip", cards: [{ front: "Empathy", back: "Understanding feelings" }, { front: "Sympathy", back: "Feeling sorry" }] }).success).toBe(true);
    const turn = (mood: number) => ({ caller: "I called twice.", choices: [{ text: "I am sorry. Let me check.", mood, reply: "Thank you." }, { text: "Calm down.", mood: -20, reply: "Do not tell me that." }] });
    expect(blockSchema.safeParse({ type: "branch", title: "A call", intro: "A caller is upset.", turns: [turn(15), turn(10)] }).success).toBe(true);
    expect(blockSchema.safeParse({ type: "branch", title: "A call", intro: "A caller is upset.", turns: [turn(99), turn(10)] }).success).toBe(false);
  });
});
