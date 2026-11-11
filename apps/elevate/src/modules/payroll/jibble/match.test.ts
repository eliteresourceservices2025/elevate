import { describe, expect, it } from "vitest";
import { matchAll, matchMember, nameTokens, sameName, type MatchLine } from "./match";

// Invented people only.
const line = (runLineId: string, lineKey: string, ...names: string[]): MatchLine => ({ runLineId, lineKey, names });
const lines = [
  line("L1", "K1", "Ana Testcruz", "Anne Testcruz"),
  line("L2", "K2", "Ben Dela Testpaz"),
  line("L3", "K3", "Carla Mock"), // Carla has two clients: two lines, two Jibble members
  line("L4", "K4", "Carla Mock"),
  line("L5", "K5", "Jonalyn Lituaña"),
];

describe("names", () => {
  it("ignores case, accents, punctuation and a nickname in brackets", () => {
    expect(nameTokens("Jonalyn Lituaña")).toEqual(["jonalyn", "lituana"]);
    expect(nameTokens("Alexander Lapugot (Ezekiel Jimenez)")).toEqual(["alexander", "lapugot"]);
    expect(nameTokens("  Mary-Jean   O'Neil ")).toEqual(["mary", "jean", "o", "neil"]);
  });

  it("matches the same words in any order, or a shorter name inside a longer one of at least two words", () => {
    expect(sameName("Jonalyn Lituana", "Jonalyn Lituaña")).toBe(true);
    expect(sameName("Testcruz Ana", "Ana Testcruz")).toBe(true);
    expect(sameName("Ana Marie Testcruz", "Ana Testcruz")).toBe(true);
    expect(sameName("Ana", "Ana Testcruz")).toBe(false); // one word is not enough
    expect(sameName("Ana Testcruz", "Ana Testpaz")).toBe(false);
    expect(sameName("", "Ana Testcruz")).toBe(false);
  });
});

describe("matchMember", () => {
  it("matches by name when exactly one line fits, including a preferred name", () => {
    expect(matchMember({ code: "ATC-1", name: "Ana Testcruz" }, lines, new Map())).toEqual({ runLineId: "L1", candidates: ["L1"], by: "name" });
    expect(matchMember({ code: "ATC-1", name: "Anne Testcruz" }, lines, new Map()).runLineId).toBe("L1");
    expect(matchMember({ code: "JL-1", name: "Jonalyn Lituana" }, lines, new Map()).runLineId).toBe("L5");
  });

  it("leaves a member that fits two lines or none for the Preparer, listing the lines that fit", () => {
    expect(matchMember({ code: "CM-1", name: "Carla Mock" }, lines, new Map())).toEqual({ runLineId: null, candidates: ["L3", "L4"], by: null });
    expect(matchMember({ code: "ZZ-1", name: "Nobody Known" }, lines, new Map())).toEqual({ runLineId: null, candidates: [], by: null });
  });

  it("uses a remembered match by member code before the name, and ignores one whose line is not on this run", () => {
    const remembered = new Map([["CM-2", "K4"], ["GONE-1", "K99"]]);
    expect(matchMember({ code: "CM-2", name: "Carla Mock TLF" }, lines, remembered)).toEqual({ runLineId: "L4", candidates: ["L4"], by: "remembered" });
    // Remembered code, different spelling of the name: the code wins.
    expect(matchMember({ code: "CM-2", name: "C. Mock" }, lines, remembered).runLineId).toBe("L4");
    expect(matchMember({ code: "GONE-1", name: "Ben Dela Testpaz" }, lines, remembered)).toMatchObject({ runLineId: "L2", by: "name" });
  });
});

describe("matchAll", () => {
  it("never gives one line to two members: both are left to the Preparer", () => {
    const r = matchAll(
      [
        { code: "BDT-1", name: "Ben Dela Testpaz" },
        { code: "BDT-2", name: "Ben Dela Testpaz" },
        { code: "ATC-1", name: "Ana Testcruz" },
      ],
      lines,
      new Map(),
    );
    expect(r.get("BDT-1")).toMatchObject({ runLineId: null, candidates: ["L2"] });
    expect(r.get("BDT-2")).toMatchObject({ runLineId: null, candidates: ["L2"] });
    expect(r.get("ATC-1")?.runLineId).toBe("L1");
  });

  it("keeps remembered matches even when a name would clash", () => {
    const r = matchAll([{ code: "CM-1", name: "Carla Mock" }, { code: "CM-2", name: "Carla Mock TLF" }], lines, new Map([["CM-1", "K3"], ["CM-2", "K4"]]));
    expect(r.get("CM-1")?.runLineId).toBe("L3");
    expect(r.get("CM-2")?.runLineId).toBe("L4");
  });
});
