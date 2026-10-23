import type { Block } from "../../../../learn/src/content/schema";

// The studio edits the interactive blocks as plain text, one idea per line, so an author never has to build a form by hand.
// These functions turn a block's list-like part into text and back. Pure (no database); the server still validates the result
// with the same schema as everything else, so a mis-typed line is refused with a message instead of being saved.

type Of<T extends Block["type"]> = Extract<Block, { type: T }>;

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const cells = (l: string) => l.split("|").map((c) => c.trim());
/** Groups of lines separated by a blank line. */
const groups = (s: string) => s.split(/\n\s*\n/).map(lines).filter((g) => g.length > 0);

// ---- cards: "card text | group number | why" -------------------------------------------------------------------------------------
export const formatCards = (b: Of<"cards">) => b.cards.map((c) => `${c.text} | ${c.group + 1} | ${c.feedback}`).join("\n");
export function parseCards(s: string): Of<"cards">["cards"] {
  return lines(s).map((l) => {
    const [text, group, ...rest] = cells(l);
    return { text, group: Math.max(0, (Number.parseInt(group ?? "1", 10) || 1) - 1), feedback: rest.join(" | ") };
  });
}

// ---- spot: "Speaker | line" and "Speaker | line | wrong" for the mistake --------------------------------------------------------
export const formatSpot = (b: Of<"spot">) => b.lines.map((l) => `${l.speaker} | ${l.text}${l.wrong ? " | wrong" : ""}`).join("\n");
export function parseSpot(s: string): Of<"spot">["lines"] {
  return lines(s).map((l) => {
    const parts = cells(l);
    const wrong = parts.length >= 3 && parts[parts.length - 1].toLowerCase() === "wrong";
    const body = wrong ? parts.slice(1, -1) : parts.slice(1);
    return { speaker: parts[0], text: body.join(" | "), ...(wrong ? { wrong: true } : {}) };
  });
}

// ---- flip: "front | back" --------------------------------------------------------------------------------------------------------
export const formatFlip = (b: Of<"flip">) => b.cards.map((c) => `${c.front} | ${c.back}`).join("\n");
export function parseFlip(s: string): Of<"flip">["cards"] {
  return lines(s).map((l) => {
    const [front, ...rest] = cells(l);
    return { front, back: rest.join(" | ") };
  });
}

// ---- options: "+ text | why" is the right one, "- text | why" a wrong one ---------------------------------------------------------
type Opt = { text: string; correct: boolean; feedback: string };
const formatOptions = (os: Opt[]) => os.map((o) => `${o.correct ? "+" : "-"} ${o.text} | ${o.feedback}`);
function parseOptions(ls: string[]): Opt[] {
  return ls.map((l) => {
    const correct = l.startsWith("+");
    const [text, ...rest] = cells(l.replace(/^[+-]\s*/, ""));
    return { text, correct, feedback: rest.join(" | ") };
  });
}

// ---- build: a label line, then its options; a blank line between slots ----------------------------------------------------------
export const formatBuild = (b: Of<"build">) => b.slots.map((s) => [s.label, ...formatOptions(s.options)].join("\n")).join("\n\n");
export function parseBuild(s: string): Of<"build">["slots"] {
  return groups(s).map(([label, ...opts]) => ({ label, options: parseOptions(opts) }));
}

// ---- game: a question line, then its options; a blank line between rounds -------------------------------------------------------
export const formatGame = (b: Of<"game">) => b.rounds.map((r) => [r.question, ...formatOptions(r.options)].join("\n")).join("\n\n");
export function parseGame(s: string): Of<"game">["rounds"] {
  return groups(s).map(([question, ...opts]) => ({ question, options: parseOptions(opts) }));
}

// ---- branch: the caller's line, then "your reply | mood change | caller answers"; a blank line between turns -------------------
export const formatBranch = (b: Of<"branch">) =>
  b.turns.map((t) => [t.caller, ...t.choices.map((c) => `${c.text} | ${c.mood > 0 ? "+" : ""}${c.mood} | ${c.reply}`)].join("\n")).join("\n\n");
export function parseBranch(s: string): Of<"branch">["turns"] {
  return groups(s).map(([caller, ...choices]) => ({
    caller,
    choices: choices.map((l) => {
      const [text, mood, ...rest] = cells(l);
      return { text, mood: Number.parseInt(mood ?? "0", 10) || 0, reply: rest.join(" | ") };
    }),
  }));
}
