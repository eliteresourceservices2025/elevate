import { describe, expect, it } from "vitest";
import { MAX_KEYWORDS, bandOf, keywordSetKey, normalizeText, parseKeywordList, scoreResume } from "./keywords";

describe("parseKeywordList", () => {
  it("splits on commas, semicolons and lines, trims, drops blanks and repeats (ignoring case and accents)", () => {
    expect(parseKeywordList("Excel, excel ;  Résumé\nresume\n\n  Medical billing  ,")).toEqual(["Excel", "Résumé", "Medical billing"]);
  });
  it("caps the count and the length of each keyword", () => {
    expect(parseKeywordList(Array.from({ length: 50 }, (_, i) => `skill${i}`).join(","))).toHaveLength(MAX_KEYWORDS);
    expect(parseKeywordList("x".repeat(100))[0]).toHaveLength(40);
  });
});

describe("normalizeText", () => {
  it("removes accents, lower-cases and collapses spaces", () => {
    expect(normalizeText("  Résumé   CAFÉ ")).toBe("resume cafe");
  });
});

describe("scoreResume", () => {
  const sets = { required: ["Excel", "medical billing", "C++"], nice: ["Spanish", "HIPAA"] };

  it("matches whole words and phrases only, ignoring case and accents", () => {
    const r = scoreResume("Experienced in EXCEL and Medical   Billing. Wrote C++ tools. Hablo español y HIPAA-trained.", sets);
    expect(r.matched).toEqual(["Excel", "medical billing", "C++", "HIPAA"]);
    expect(r.missed).toEqual(["Spanish"]);
  });

  it("does not count part of a longer word", () => {
    const r = scoreResume("An excellent communicator with Excelsior training.", { required: ["Excel"], nice: [] });
    expect(r).toEqual({ score: 0, matched: [], missed: ["Excel"] });
  });

  it("weights required 70 and nice-to-have 30", () => {
    expect(scoreResume("excel medical billing c++ spanish hipaa", sets).score).toBe(100);
    expect(scoreResume("excel medical billing c++", sets).score).toBe(70);
    expect(scoreResume("excel spanish hipaa", sets).score).toBe(53); // 1/3 of 70 + all of 30
    expect(scoreResume("spanish hipaa", sets).score).toBe(30);
  });

  it("lets one kind of keyword carry the whole score", () => {
    expect(scoreResume("excel", { required: ["excel", "word"], nice: [] }).score).toBe(50);
    expect(scoreResume("word", { required: [], nice: ["word", "excel"] }).score).toBe(50);
  });

  it("gives no score when there are no keywords or no text (for example a scanned resume)", () => {
    expect(scoreResume("excel", { required: [], nice: [] }).score).toBeNull();
    expect(scoreResume("   ", sets).score).toBeNull();
  });

  it("is not fooled by regex characters in a keyword", () => {
    expect(scoreResume("uses node.js daily", { required: ["node.js"], nice: [] }).score).toBe(100);
    expect(scoreResume("uses nodexjs daily", { required: ["node.js"], nice: [] }).score).toBe(0);
    expect(() => scoreResume("anything", { required: ["(", "[a-", "a|b", "\\"], nice: [] })).not.toThrow();
  });
});

describe("keywordSetKey and bands", () => {
  it("is the same for the same words in any order or case, and different when they change", () => {
    expect(keywordSetKey({ required: ["Excel", "Word"], nice: [] })).toBe(keywordSetKey({ required: ["word", "EXCEL"], nice: [] }));
    expect(keywordSetKey({ required: ["Excel"], nice: [] })).not.toBe(keywordSetKey({ required: ["Excel"], nice: ["Word"] }));
  });
  it("names the bands", () => {
    expect([bandOf(100), bandOf(75), bandOf(74), bandOf(50), bandOf(49), bandOf(0)]).toEqual(["Strong", "Strong", "Fair", "Fair", "Weak", "Weak"]);
  });
});
