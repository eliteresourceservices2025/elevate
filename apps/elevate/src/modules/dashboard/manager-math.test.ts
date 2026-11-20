import { describe, expect, it } from "vitest";
import { dropSmall, flagCounts, percentOf, shapeHrKpis, trainingPercent } from "./manager-math";

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

describe("shapeHrKpis", () => {
  const all = { active: 126, onboarding: 7, offboarding: 2, changeRequests: 3, docsExpiring: 5, trainingOverdue: 7 };

  it("returns exactly six tiles in the fixed order, each with a page to open", () => {
    const tiles = shapeHrKpis(all);
    expect(tiles.map((t) => t.id)).toEqual(["active", "onboarding", "offboarding", "change-requests", "docs-expiring", "training-overdue"]);
    expect(tiles.map((t) => t.value)).toEqual([126, 7, 2, 3, 5, 7]);
    expect(tiles.every((t) => t.href.startsWith("/"))).toBe(true);
  });

  it("keeps a tile with a null value (shown as a dash) when its source was refused, instead of dropping or zeroing it", () => {
    const tiles = shapeHrKpis({ ...all, docsExpiring: null, trainingOverdue: null });
    expect(tiles).toHaveLength(6);
    expect(tiles[4].value).toBeNull();
    expect(tiles[5].value).toBeNull();
    expect(tiles[0].value).toBe(126);
  });
});

describe("trainingPercent", () => {
  it("is null when nobody is assigned, never NaN", () => {
    expect(trainingPercent(0, 0)).toBeNull();
    expect(trainingPercent(5, 0)).toBeNull();
  });

  it("rounds to a whole percent and never goes above 100", () => {
    expect(trainingPercent(47, 50)).toBe(94);
    expect(trainingPercent(1, 3)).toBe(33);
    expect(trainingPercent(60, 50)).toBe(100);
    expect(trainingPercent(0, 10)).toBe(0);
  });
});

describe("dropSmall", () => {
  it("removes groups under the minimum, so a team of 1 to 4 people never shows", () => {
    const teams = [{ name: "Dental", count: 48 }, { name: "Tiny", count: 3 }, { name: "Edge", count: 4 }, { name: "Five", count: 5 }];
    expect(dropSmall(teams, 5).map((t) => t.name)).toEqual(["Dental", "Five"]);
    expect(dropSmall([], 5)).toEqual([]);
  });
});
