import { describe, expect, it } from "vitest";
import { sampleExam, seeded, type PreviewQuestion } from "./studio-exam-preview";

const make = (module: string, n: number): PreviewQuestion[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${module}-${i}`,
    moduleKey: module,
    topic: "t",
    stem: `Question ${module} ${i}`,
    type: "single",
    options: [
      { id: "a", text: "one" },
      { id: "b", text: "two" },
      { id: "c", text: "three" },
    ],
    correctIds: ["a"],
  }));

describe("exam preview sampling", () => {
  const bank = [...make("m1", 6), ...make("m2", 6), ...make("m3", 6), ...make("other", 10)];

  it("is repeatable for a seed and different for another", () => {
    const a = sampleExam(bank, ["m1", "m2", "m3"], 9, 1).questions.map((q) => q.id);
    expect(sampleExam(bank, ["m1", "m2", "m3"], 9, 1).questions.map((q) => q.id)).toEqual(a);
    expect(sampleExam(bank, ["m1", "m2", "m3"], 9, 2).questions.map((q) => q.id)).not.toEqual(a);
    expect(seeded(5)()).toBe(seeded(5)());
  });

  it("draws only from the track's modules and spreads evenly across them", () => {
    const s = sampleExam(bank, ["m1", "m2", "m3"], 9, 7);
    expect(s.questions).toHaveLength(9);
    expect(s.questions.every((q) => q.moduleKey !== "other")).toBe(true);
    for (const m of ["m1", "m2", "m3"]) expect(s.questions.filter((q) => q.moduleKey === m)).toHaveLength(3);
    expect(s.pool).toEqual({ m1: 6, m2: 6, m3: 6 });
    expect(s.short).toBe(false);
  });

  it("uses every option once, and says when the track has too few questions", () => {
    const s = sampleExam(bank, ["m1"], 8, 3);
    expect(s.short).toBe(true);
    expect(s.questions).toHaveLength(6);
    for (const q of s.questions) expect([...q.shuffledOptions.map((o) => o.id)].sort()).toEqual(["a", "b", "c"]);
  });
});
