import { describe, expect, it } from "vitest";
import { FUNNEL_STAGES, formatDays, percent, reachedCounts } from "./report-math";

describe("reachedCounts", () => {
  it("counts an application at every step up to the furthest it got", () => {
    // 4 only applied, 3 got to screening, 2 to interview, 1 to offer, 1 hired
    expect(reachedCounts({ 0: 4, 1: 3, 2: 2, 4: 1, 5: 1 })).toEqual([11, 7, 4, 2, 2, 1]);
  });
  it("counts someone moved past a stage at the stages they skipped too", () => {
    expect(reachedCounts({ 4: 1 })).toEqual([1, 1, 1, 1, 1, 0]);
  });
  it("is all zeros with no applications, and ignores a step that does not exist", () => {
    expect(reachedCounts({})).toEqual(FUNNEL_STAGES.map(() => 0));
    expect(reachedCounts({ 99: 2 })).toEqual([2, 2, 2, 2, 2, 2]);
  });
});

describe("percent and formatDays", () => {
  it("rounds, and gives null when there is no total", () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 0)).toBeNull();
  });
  it("writes days plainly", () => {
    expect(formatDays(0.4)).toBe("under a day");
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(3.04)).toBe("3 days");
    expect(formatDays(1.46)).toBe("1.5 days");
    expect(formatDays(null)).toBe("-");
  });
});
