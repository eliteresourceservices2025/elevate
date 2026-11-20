import { describe, expect, it } from "vitest";
import { applyMention, findMentionQuery, suggestMentions } from "./mention-suggest";

const people = [
  { userId: "1", name: "Ana Reyes" },
  { userId: "2", name: "Bea Santos" },
  { userId: "3", name: "Carlo Anastacio" },
  { userId: "4", name: "Dana Cruz" },
];

describe("findMentionQuery", () => {
  it("finds an @ at the start, after a space and after a line break, with what follows up to the caret", () => {
    expect(findMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(findMentionQuery("hi @an", 6)).toEqual({ start: 3, query: "an" });
    expect(findMentionQuery("line\n@b", 7)).toEqual({ start: 5, query: "b" });
  });
  it("uses the caret, not the end of the text", () => {
    expect(findMentionQuery("hi @an and more", 6)).toEqual({ start: 3, query: "an" });
    expect(findMentionQuery("hi @an and more", 12)).toBeNull();
  });
  it("ignores emails, @ inside words, finished mentions and long runs", () => {
    for (const [text, caret] of [["mail ana@example.com", 20], ["a@b", 3], ["@[Ana](user:x)", 14], ["@" + "x".repeat(40), 41], ["no at here", 10]] as const) expect(findMentionQuery(text, caret)).toBeNull();
  });
});

describe("suggestMentions", () => {
  it("shows everyone and the people when only @ is typed, with everyone first", () => {
    const options = suggestMentions(people, "");
    expect(options[0]).toEqual({ kind: "everyone" });
    expect(options).toHaveLength(5);
  });
  it("ranks names that start with the text first, then words that start with it, then the rest", () => {
    const names = suggestMentions(people, "an")
      .filter((o) => o.kind === "person")
      .map((o) => (o as { name: string }).name);
    // Ana starts with "an"; Carlo's word "Anastacio" starts with it; Bea (Santos) and Dana only contain it.
    expect(names).toEqual(["Ana Reyes", "Carlo Anastacio", "Bea Santos", "Dana Cruz"]);
  });
  it("offers everyone for e, ev, al, all but not for unrelated text, and never in a one-person chat", () => {
    expect(suggestMentions(people, "ev")[0]).toEqual({ kind: "everyone" });
    expect(suggestMentions(people, "al").some((o) => o.kind === "everyone")).toBe(true);
    expect(suggestMentions(people, "bea").some((o) => o.kind === "everyone")).toBe(false);
    expect(suggestMentions([people[0]], "").some((o) => o.kind === "everyone")).toBe(false);
  });
  it("limits the list", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ userId: String(i), name: `Person ${i}` }));
    expect(suggestMentions(many, "")).toHaveLength(8);
  });
});

describe("applyMention", () => {
  it("replaces the typed @text with the mention and puts the caret after it", () => {
    expect(applyMention("hi @an and more", { start: 3, query: "an" }, "@[Ana](user:1)")).toEqual({ text: "hi @[Ana](user:1)  and more", caret: 3 + "@[Ana](user:1)".length + 1 });
    expect(applyMention("@", { start: 0, query: "" }, "@everyone")).toEqual({ text: "@everyone ", caret: 10 });
  });
});
