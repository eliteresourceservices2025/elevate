import { describe, expect, it } from "vitest";
import { indexTokens, queryTokens, tokenize } from "./search-tokens";

describe("tokenize", () => {
  it("lower-cases, splits on anything that is not a letter or digit, and drops accents", () => {
    expect(tokenize("Hello, World! Café-au-lait 2026")).toEqual(["hello", "world", "cafe", "au", "lait", "2026"]);
  });
  it("keeps Filipino and other letters, drops one-letter words, caps the count", () => {
    expect(tokenize("Ñoño a b si Juan")).toEqual(["nono", "si", "juan"]);
    expect(tokenize(Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ")).length).toBe(50);
  });
  it("ignores mention tokens' ids and punctuation noise", () => {
    expect(tokenize("hi @[Bea Santos](user:11111111-1111-4111-8111-111111111111) see you")).toEqual(expect.arrayContaining(["hi", "see", "you"]));
  });
});

describe("indexTokens and queryTokens", () => {
  it("a word is stored whole and as prefixes of 3 to 10 letters", () => {
    expect(indexTokens(["schedule"]).sort()).toEqual(["sch", "sche", "sched", "schedu", "schedul", "schedule"].sort());
    expect(indexTokens(["at"])).toEqual(["at"]);
    expect(indexTokens(["internationalization"]).includes("internatio")).toBe(true);
    expect(indexTokens(["internationalization"]).includes("internationa")).toBe(false);
  });
  it("a query word of 3+ letters matches by prefix; a 2-letter word matches whole", () => {
    expect(queryTokens("sched")).toEqual(["sched"]);
    expect(queryTokens("Schedule THURSDAY")).toEqual(["schedule", "thursday"]);
    expect(queryTokens("at")).toEqual(["at"]);
    expect(queryTokens("internationalization")).toEqual(["internatio"]);
    expect(queryTokens("x")).toEqual([]);
  });
});
