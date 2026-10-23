import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Block } from "@/content/schema";
import { blockSchema } from "@/content/schema";
import { ContentBlocks } from "./content-blocks";
import { shuffledIndexes } from "./interactive-blocks";

const opt = (correct: boolean, n: number) => ({ text: `Option ${n}`, correct, feedback: `Because ${n}.` });

const blocks: Block[] = [
  { type: "sort", title: "Order the steps", prompt: "Put them in order.", items: ["Listen", "Clarify", "Confirm", "Respond"], explanation: "Understand first." },
  { type: "cards", title: "Empathy or not", prompt: "Sort the cards.", groups: ["Empathy", "Not empathy"], cards: [0, 1, 0].map((group, i) => ({ text: `Card ${i}`, group, feedback: "Why." })) },
  { type: "spot", title: "Find the mistake", prompt: "Tap it.", lines: [{ speaker: "Caller", text: "Hello" }, { speaker: "Rep", text: "Not my fault", wrong: true }, { speaker: "Caller", text: "Right" }], explanation: "Defensive." },
  { type: "flip", title: "Terms", cards: [{ front: "Empathy", back: "Understanding feelings" }, { front: "Sympathy", back: "Feeling sorry" }] },
  { type: "build", title: "Build the note", prompt: "Pick each part.", slots: [{ label: "Date and time", options: [opt(true, 1), opt(false, 2)] }, { label: "Concern", options: [opt(false, 3), opt(true, 4)] }] },
  { type: "branch", title: "A call", intro: "A caller is upset.", turns: [1, 2].map((n) => ({ caller: `Caller line ${n}`, choices: [{ text: "Kind reply", mood: 15, reply: "Thanks" }, { text: "Cold reply", mood: -20, reply: "Hmm" }] })) },
  { type: "game", title: "Quick round", seconds: 20, rounds: [1, 2, 3].map((n) => ({ question: `Question ${n}?`, options: [opt(true, n), opt(false, n + 10)] })) },
];

describe("interactive blocks", () => {
  it("are valid content and render their starting state without any HTML injection", () => {
    for (const b of blocks) expect(blockSchema.safeParse(b).success, b.type).toBe(true);
    const html = renderToStaticMarkup(createElement(ContentBlocks, { blocks }));
    for (const text of ["Order the steps", "Empathy or not", "Find the mistake", "Tap to turn over", "Build the note", "Caller mood", "Quick round"]) expect(html).toContain(text);
    // answers are not shown before the learner acts
    expect(html).not.toContain("Understand first.");
    expect(html).not.toContain("Defensive.");
    expect(html).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("shows the sort steps shuffled, and the shuffle never equals the correct order", () => {
    for (let n = 2; n <= 7; n++) for (let seed = 1; seed < 40; seed++) expect(shuffledIndexes(n, seed).every((v, i) => v === i), `${n}/${seed}`).toBe(false);
    expect(shuffledIndexes(5, 3)).toEqual(shuffledIndexes(5, 3));
  });
});
