import { describe, expect, it } from "vitest";
import { DRILLS, drillFor, quarterOf } from "./drills";

describe("micro-drills", () => {
  const all = Object.entries(DRILLS).flatMap(([course, list]) => list.map((d) => ({ course, ...d })));

  it("every drill is well formed, has one best answer and no markup", () => {
    expect(all.length).toBeGreaterThanOrEqual(8);
    for (const d of all) {
      expect(d.key).toMatch(/^[a-z0-9-]{3,40}$/);
      expect(d.title.length).toBeLessThanOrEqual(80);
      expect(d.scenario.length).toBeLessThanOrEqual(400);
      expect(d.explanation.length).toBeLessThanOrEqual(400);
      expect(d.options.map((o) => o.id)).toEqual(["a", "b", "c"]);
      expect(d.options.some((o) => o.id === d.best)).toBe(true);
      for (const o of d.options) expect(o.text.length).toBeLessThanOrEqual(160);
      expect(`${d.title}${d.scenario}${d.explanation}${d.options.map((o) => o.text).join("")}`).not.toMatch(/[<>]|https?:/);
    }
  });

  it("keys are unique within a course and the best answer is not always the same letter", () => {
    for (const list of Object.values(DRILLS)) {
      expect(new Set(list.map((d) => d.key)).size).toBe(list.length);
      expect(new Set(list.map((d) => d.best)).size).toBeGreaterThan(1);
    }
  });

  it("walks the list one step a quarter, repeats only after a full cycle, and knows no other course", () => {
    const n = DRILLS.hipaa.length;
    expect(drillFor("hipaa", "2026-Q4")!.key).not.toBe(drillFor("hipaa", "2027-Q1")!.key);
    expect(drillFor("hipaa", "2026-Q4")!.key).toBe(drillFor("hipaa", `${2026 + n / 4}-Q4`)!.key);
    expect(drillFor("nope", "2026-Q4")).toBeNull();
    expect(drillFor("hipaa", "2026-Q5")).toBeNull();
  });

  it("names the quarter in the company time zone", () => {
    expect(quarterOf(new Date("2026-10-15T12:00:00Z"))).toBe("2026-Q4");
    // 2026-04-01 03:00 UTC is still 31 March in Phoenix
    expect(quarterOf(new Date("2026-04-01T03:00:00Z"))).toBe("2026-Q1");
    expect(quarterOf(new Date("2026-04-01T08:00:00Z"))).toBe("2026-Q2");
  });
});
