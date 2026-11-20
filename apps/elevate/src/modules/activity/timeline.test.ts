import { describe, expect, it } from "vitest";
import { hourTicks, layoutTimeline } from "./timeline";

const HOUR = 3_600_000;
const D0 = Date.UTC(2026, 10, 10, 0, 0);
const D1 = D0 + 24 * HOUR;
const at = (h: number, m = 0) => new Date(D0 + h * HOUR + m * 60_000).toISOString();
const fmt = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const seg = (from: [number, number], to: [number, number], app = "Chrome", state: "active" | "idle" = "active") => ({ start: at(...from), end: at(...to), app, state });
const run = (segments: ReturnType<typeof seg>[], working: { start: string; end: string }[] = []) => layoutTimeline({ segments, working, dayStart: D0, dayEnd: D1, formatTime: fmt });

describe("layoutTimeline", () => {
  it("places a segment as a share of the day", () => {
    const [b] = run([seg([10, 0], [10, 30])]);
    expect(b.leftPct).toBeCloseTo(41.67, 2);
    expect(b.widthPct).toBeCloseTo(2.08, 2);
    expect(b.kind).toBe("active");
    expect(b.label).toBe("Chrome, 10:00 to 10:30, active");
  });
  it("clamps a segment that starts before the day", () => {
    const [b] = layoutTimeline({ segments: [{ start: new Date(D0 - HOUR).toISOString(), end: at(1), app: "Chrome", state: "active" }], working: [], dayStart: D0, dayEnd: D1, formatTime: fmt });
    expect(b.leftPct).toBe(0);
    expect(b.widthPct).toBeCloseTo(4.17, 2);
  });
  it("merges touching blocks of the same app and state, but not different apps", () => {
    expect(run([seg([10, 0], [10, 30]), seg([10, 30], [11, 0])])).toHaveLength(1);
    expect(run([seg([10, 0], [10, 30]), seg([10, 30], [11, 0], "Excel")])).toHaveLength(2);
  });
  it("draws clocked-in time first, as an underlay", () => {
    const blocks = run([seg([10, 0], [10, 30])], [{ start: at(9), end: at(12) }]);
    expect(blocks.map((b) => b.kind)).toEqual(["working", "active"]);
  });
  it("is empty for no data", () => expect(run([])).toEqual([]));
});

describe("hourTicks", () => {
  it("gives a tick every 2 hours of a 24 hour day, at most 12", () => {
    const ticks = hourTicks(D0, D1, fmt);
    expect(ticks).toHaveLength(12);
    expect(ticks[0]).toEqual({ leftPct: 0, label: "00:00" });
    expect(ticks[1].leftPct).toBeCloseTo(8.33, 2);
  });
});
