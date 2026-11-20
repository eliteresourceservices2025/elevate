import { describe, expect, it } from "vitest";
import { flagCounts, percentOf } from "./manager-math";

describe("percentOf", () => {
  it("is 0 when nothing is scheduled, never NaN or Infinity", () => {
    expect(percentOf(120, 0)).toBe(0);
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(10, -5)).toBe(0);
  });

  it("rounds to a whole percent and caps at 100", () => {
    expect(percentOf(95, 100)).toBe(95);
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(130, 100)).toBe(100);
  });
});

describe("flagCounts", () => {
  const labels = new Map([["late", "Late"], ["left_early", "Left early"], ["on_leave", "On approved leave"], ["overbreak", "Overbreak"]]);
  const ignore = new Set(["on_leave"]);

  it("counts days per flag, skips ignored flags, and sorts by count then label", () => {
    const out = flagCounts([{ flags: ["late", "on_leave"] }, { flags: ["late", "overbreak"] }, { flags: ["left_early"] }, { flags: ["overbreak"] }], labels, ignore);
    expect(out).toEqual([{ label: "Late", count: 2 }, { label: "Overbreak", count: 2 }, { label: "Left early", count: 1 }]);
  });

  it("falls back to the raw flag when it has no label, and returns nothing for no rows", () => {
    expect(flagCounts([{ flags: ["mystery"] }], labels, ignore)).toEqual([{ label: "mystery", count: 1 }]);
    expect(flagCounts([], labels, ignore)).toEqual([]);
  });
});
