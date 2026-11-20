import { describe, expect, it } from "vitest";
import { activeMinutes, activePercent, categorize, clipToIntervals, dropOverlaps, isTrackerOffline, sanitizeApp, shotWindow, summarizeDay, trackerFlags, validateSegment, workingIntervals, type RawSegment } from "./logic";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 19, 10, 0, 0);
const seg = (startMin: number, endMin: number, state: "active" | "idle" = "active", app = "Chrome"): RawSegment => ({
  start: T0 + startMin * MIN,
  end: T0 + endMin * MIN,
  app,
  state,
});

describe("sanitizeApp", () => {
  it("trims and removes control characters", () => expect(sanitizeApp("  Chrome\u0007  ")).toBe("Chrome"));
  it("cuts a long name to 80 characters", () => expect(sanitizeApp("x".repeat(200))).toHaveLength(80));
  it("returns null for whitespace only", () => expect(sanitizeApp("   \t ")).toBeNull());
  it("collapses inner spaces", () => expect(sanitizeApp("Visual   Studio  Code")).toBe("Visual Studio Code"));
});

describe("validateSegment", () => {
  const now = T0 + 120 * MIN;
  it("accepts a normal segment", () => expect(validateSegment(seg(100, 110), now)).toBe("ok"));
  it("rejects an end more than 2 minutes in the future", () => {
    expect(validateSegment({ ...seg(100, 110), end: now + 2 * MIN + 1 }, now)).toBe("future");
    expect(validateSegment({ ...seg(100, 110), end: now + 2 * MIN }, now)).toBe("ok");
  });
  it("rejects a start older than 36 hours", () => {
    expect(validateSegment({ ...seg(0, 1), start: now - 36 * 60 * MIN - 1, end: now - 36 * 60 * MIN + MIN }, now)).toBe("too_old");
  });
  it("rejects an inverted or empty segment", () => {
    expect(validateSegment(seg(10, 10), now)).toBe("inverted");
    expect(validateSegment(seg(11, 10), now)).toBe("inverted");
  });
  it("rejects a segment longer than 30 minutes", () => {
    expect(validateSegment(seg(0, 31), now)).toBe("too_long");
    expect(validateSegment(seg(0, 30), now)).toBe("ok");
  });
});

describe("clipToIntervals", () => {
  it("keeps only the part inside the working interval", () => {
    const out = clipToIntervals(seg(0, 30), [{ start: T0 + 10 * MIN, end: T0 + 20 * MIN }]);
    expect(out).toEqual([{ start: T0 + 10 * MIN, end: T0 + 20 * MIN, app: "Chrome", state: "active" }]);
  });
  it("splits around a break", () => {
    const out = clipToIntervals(seg(0, 30), [
      { start: T0, end: T0 + 10 * MIN },
      { start: T0 + 20 * MIN, end: T0 + 30 * MIN },
    ]);
    expect(out.map((s) => [s.start - T0, s.end - T0])).toEqual([[0, 10 * MIN], [20 * MIN, 30 * MIN]]);
  });
  it("returns nothing for a segment fully outside", () => {
    expect(clipToIntervals(seg(0, 5), [{ start: T0 + 10 * MIN, end: T0 + 20 * MIN }])).toEqual([]);
  });
});

describe("dropOverlaps", () => {
  const existing = [{ start: T0, end: T0 + 10 * MIN }];
  it("trims the part that is already stored", () => {
    const { kept, dropped } = dropOverlaps([seg(5, 20)], existing);
    expect(kept).toEqual([seg(10, 20)]);
    expect(dropped).toBe(0);
  });
  it("drops an exact duplicate and counts it", () => {
    const { kept, dropped } = dropOverlaps([seg(0, 10)], existing);
    expect(kept).toEqual([]);
    expect(dropped).toBe(1);
  });
  it("keeps a segment with no overlap", () => {
    expect(dropOverlaps([seg(20, 25)], existing)).toEqual({ kept: [seg(20, 25)], dropped: 0 });
  });
  it("does not let two incoming segments overlap each other", () => {
    const { kept } = dropOverlaps([seg(20, 30), seg(25, 35)], []);
    expect(kept).toEqual([seg(20, 30), seg(30, 35)]);
  });
});

describe("activeMinutes and activePercent", () => {
  it("sums active and idle time", () => {
    expect(activeMinutes([seg(0, 60), seg(60, 90, "idle")])).toEqual({ activeMs: 60 * MIN, idleMs: 30 * MIN });
  });
  it("is 0 percent when nothing was worked", () => expect(activePercent(0, 0)).toBe(0));
  it("never exceeds 100", () => expect(activePercent(120 * MIN, 60 * MIN)).toBe(100));
  it("rounds to a whole number", () => expect(activePercent(20 * MIN, 60 * MIN)).toBe(33));
});

describe("categorize", () => {
  const rules = [
    { pattern: "chrome", category: "work" as const, rank: 10 },
    { pattern: "^chrome$", category: "non_work" as const, rank: 20 },
    { pattern: "(", category: "work" as const, rank: 99 },
  ];
  it("lets the highest rank win and ignores an invalid pattern", () => expect(categorize("Chrome", rules)).toBe("non_work"));
  it("is unknown when nothing matches", () => expect(categorize("Notepad", rules)).toBe("unknown"));
});

describe("isTrackerOffline", () => {
  const now = T0;
  it("is offline when there has never been a segment", () => expect(isTrackerOffline(null, now, 5 * MIN)).toBe(true));
  it("is online within the grace period", () => expect(isTrackerOffline(now - 5 * MIN, now, 5 * MIN)).toBe(false));
  it("is offline past the grace period", () => expect(isTrackerOffline(now - 5 * MIN - 1, now, 5 * MIN)).toBe(true));
});

describe("shotWindow", () => {
  it("is the same for two times in one 10 minute window", () => {
    expect(shotWindow(T0 + 1000)).toBe(shotWindow(T0 + 9 * MIN));
    expect(shotWindow(T0 + 10 * MIN)).toBe(shotWindow(T0) + 1);
  });
});

describe("workingIntervals", () => {
  const session = (startMin: number, endMin: number | null, breaks: { s: number; e: number | null }[] = []) => ({
    startAt: T0 + startMin * MIN,
    endAt: endMin === null ? null : T0 + endMin * MIN,
    breaks: breaks.map((b) => ({ startAt: T0 + b.s * MIN, endAt: b.e === null ? null : T0 + b.e * MIN, plannedMinutes: null })),
  });
  const rel = (list: { start: number; end: number }[]) => list.map((i) => [(i.start - T0) / MIN, (i.end - T0) / MIN]);

  it("cuts breaks out of a closed session", () => {
    expect(rel(workingIntervals([session(0, 60, [{ s: 20, e: 30 }])], T0 + 90 * MIN))).toEqual([[0, 20], [30, 60]]);
  });
  it("runs an open session up to now", () => {
    expect(rel(workingIntervals([session(0, null)], T0 + 45 * MIN))).toEqual([[0, 45]]);
  });
  it("stops at the start of a break that is still open", () => {
    expect(rel(workingIntervals([session(0, null, [{ s: 30, e: null }])], T0 + 45 * MIN))).toEqual([[0, 30]]);
  });
  it("returns nothing when there is no session", () => {
    expect(workingIntervals([], T0)).toEqual([]);
  });
});

describe("trackerFlags", () => {
  const base = { workingMs: 120 * MIN, coveredMs: 120 * MIN, activeMs: 100 * MIN, shots: 5, lowActivityPercent: 30 };
  it("is clean for a normal day", () => expect(trackerFlags(base)).toEqual([]));
  it("flags tracker_offline when 30 or more working minutes have no recording", () => {
    expect(trackerFlags({ ...base, coveredMs: 90 * MIN })).toContain("tracker_offline");
    expect(trackerFlags({ ...base, coveredMs: 91 * MIN })).not.toContain("tracker_offline");
  });
  it("does not flag a short day as offline", () => {
    expect(trackerFlags({ ...base, workingMs: 25 * MIN, coveredMs: 0, activeMs: 0, shots: 0 })).toEqual([]);
  });
  it("flags low_activity from recorded time, not from the offline gap", () => {
    expect(trackerFlags({ ...base, activeMs: 30 * MIN })).toEqual(["low_activity"]); // 25% of 120
    expect(trackerFlags({ ...base, workingMs: 240 * MIN, coveredMs: 120 * MIN, activeMs: 100 * MIN })).toEqual(["tracker_offline"]);
  });
  it("needs an hour of recorded time before judging activity", () => {
    expect(trackerFlags({ ...base, workingMs: 50 * MIN, coveredMs: 50 * MIN, activeMs: 5 * MIN, shots: 5 })).not.toContain("low_activity");
  });
  it("flags no_shots after an hour of work with none", () => {
    expect(trackerFlags({ ...base, shots: 0 })).toEqual(["no_shots"]);
    expect(trackerFlags({ ...base, workingMs: 59 * MIN, coveredMs: 59 * MIN, shots: 0 })).toEqual([]);
  });
});

describe("summarizeDay", () => {
  const rules = [
    { pattern: "^chrome$", category: "work" as const, rank: 10 },
    { pattern: "^spotify$", category: "non_work" as const, rank: 10 },
  ];
  const day0 = T0;
  const day1 = T0 + 24 * 60 * MIN;
  it("totals active, idle, work and non-work minutes, with the top apps by active time", () => {
    const out = summarizeDay([seg(0, 60), seg(60, 90, "idle"), seg(90, 105, "active", "Spotify")], day0, day1, rules);
    expect(out).toEqual({
      activeMinutes: 75,
      idleMinutes: 30,
      workMinutes: 60,
      nonWorkMinutes: 15,
      topApps: [{ app: "Chrome", minutes: 60 }, { app: "Spotify", minutes: 15 }],
    });
  });
  it("counts only the part of a segment inside the day", () => {
    const out = summarizeDay([{ start: day0 - 10 * MIN, end: day0 + 20 * MIN, app: "Chrome", state: "active" }], day0, day1, rules);
    expect(out.activeMinutes).toBe(20);
  });
  it("keeps at most 10 apps", () => {
    const many = Array.from({ length: 15 }, (_, i) => seg(i * 2, i * 2 + 1, "active", `App${i}`));
    expect(summarizeDay(many, day0, day1, []).topApps).toHaveLength(10);
  });
});
