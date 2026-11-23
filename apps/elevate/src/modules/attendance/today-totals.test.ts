import { describe, expect, it } from "vitest";
import { summarizeToday } from "./today-totals";

const MIN = 60_000;
const s = (from: number, to: number, clientId: string | null, projectId: string | null) => ({ from: from * MIN, to: to * MIN, clientId, projectId });

describe("today's time for the Tracker App", () => {
  it("is zero with nothing worked", () => {
    expect(summarizeToday([])).toEqual({ totalMs: 0, byWork: [] });
  });

  it("adds up the total and the time for each client and project, breaks already left out", () => {
    const got = summarizeToday([s(0, 60, "c1", "p1"), s(75, 105, "c1", "p1"), s(105, 120, "c1", null), s(120, 150, "c2", null)]);
    expect(got.totalMs).toBe(135 * MIN);
    expect(got.byWork).toEqual([
      { clientId: "c1", projectId: "p1", ms: 90 * MIN },
      { clientId: "c1", projectId: null, ms: 15 * MIN },
      { clientId: "c2", projectId: null, ms: 30 * MIN },
    ]);
  });

  it("counts time with no client in the total but gives it no line", () => {
    const got = summarizeToday([s(0, 30, null, null), s(30, 40, "c1", null)]);
    expect(got.totalMs).toBe(40 * MIN);
    expect(got.byWork).toEqual([{ clientId: "c1", projectId: null, ms: 10 * MIN }]);
  });

  it("ignores empty or backwards stretches", () => {
    expect(summarizeToday([s(10, 10, "c1", null), s(20, 10, "c1", null)]).totalMs).toBe(0);
  });
});
