import { describe, expect, it } from "vitest";
import { blockSchema } from "../../../../learn/src/content/schema";
import { formatBranch, formatBuild, formatCards, formatFlip, formatGame, formatSpot, parseBranch, parseBuild, parseCards, parseFlip, parseGame, parseSpot } from "./studio-block-text";

const opt = (correct: boolean, n: number) => ({ text: `Option ${n}`, correct, feedback: `Because ${n}.` });

describe("interactive blocks as editable text", () => {
  it("round-trips cards, spot and flip", () => {
    const cards = { type: "cards" as const, title: "T", prompt: "P", groups: ["Yes", "No"], cards: [{ text: "A", group: 0, feedback: "a" }, { text: "B", group: 1, feedback: "b" }, { text: "C", group: 0, feedback: "c" }] };
    expect(parseCards(formatCards(cards))).toEqual(cards.cards);
    const spot = { type: "spot" as const, title: "T", prompt: "P", explanation: "E", lines: [{ speaker: "Caller", text: "Hi" }, { speaker: "Rep", text: "Not my fault", wrong: true }, { speaker: "Caller", text: "Ok" }] };
    expect(parseSpot(formatSpot(spot))).toEqual(spot.lines);
    const flip = { type: "flip" as const, cards: [{ front: "Empathy", back: "Understanding feelings" }, { front: "Sympathy", back: "Feeling sorry" }] };
    expect(parseFlip(formatFlip(flip))).toEqual(flip.cards);
  });

  it("round-trips build, game and branch, and the result still passes the schema", () => {
    const build = { type: "build" as const, title: "T", prompt: "P", slots: [{ label: "When", options: [opt(true, 1), opt(false, 2)] }, { label: "What", options: [opt(false, 3), opt(true, 4)] }] };
    expect(parseBuild(formatBuild(build))).toEqual(build.slots);
    const game = { type: "game" as const, title: "T", rounds: [1, 2, 3].map((n) => ({ question: `Q${n}?`, options: [opt(true, n), opt(false, n + 10)] })) };
    expect(parseGame(formatGame(game))).toEqual(game.rounds);
    const branch = { type: "branch" as const, title: "T", intro: "I", turns: [1, 2].map((n) => ({ caller: `Caller ${n}`, choices: [{ text: "Kind", mood: 15, reply: "Thanks" }, { text: "Cold", mood: -20, reply: "Hmm" }] })) };
    expect(parseBranch(formatBranch(branch))).toEqual(branch.turns);
    for (const b of [build, game, branch]) expect(blockSchema.safeParse(b).success).toBe(true);
  });

  it("keeps a pipe inside the last cell, and treats a missing mood as zero", () => {
    expect(parseFlip("Term | one | two")).toEqual([{ front: "Term", back: "one | two" }]);
    expect(parseBranch("Caller\nReply |  | ok\nOther | 5 | fine")[0].choices.map((c) => c.mood)).toEqual([0, 5]);
  });
});
