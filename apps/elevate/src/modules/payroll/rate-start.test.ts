import { describe, expect, it } from "vitest";
import { cutoffChoices, reasonText, startChoicesFor } from "./rate-start";

const starts = (s: string[]) => new Set(s);

describe("cutoffChoices", () => {
  it("defaults to the oldest recent cutoff with no real run, then offers the next", () => {
    // 13 Nov: Oct 1 and Oct 16 already ran; Nov 1 did not.
    const c = cutoffChoices("2026-11-13", starts(["2026-10-01", "2026-10-16"]));
    expect(c.map((x) => x.start)).toEqual(["2026-11-01", "2026-11-16"]);
    expect(c[0]).toMatchObject({ end: "2026-11-15", beingPrepared: true, label: "Nov 1 to 15 (being prepared)" });
    expect(c[1]).toMatchObject({ end: "2026-11-30", beingPrepared: false, label: "Nov 16 to 30" });
  });

  it("offers an earlier cutoff that has no run yet, with the oldest as the default", () => {
    const c = cutoffChoices("2026-11-13", starts([]));
    expect(c[0]).toMatchObject({ start: "2026-10-01", beingPrepared: true });
    expect(c.map((x) => x.start)).toEqual(["2026-10-01", "2026-10-16"]);
  });

  it("moves on to the next cutoff when every recent one already has a real run", () => {
    const c = cutoffChoices("2026-11-13", starts(["2026-10-01", "2026-10-16", "2026-11-01"]));
    expect(c.map((x) => x.start)).toEqual(["2026-11-16", "2026-12-01"]);
    expect(c[0].beingPrepared).toBe(true);
  });

  it("handles the end of February and a year boundary", () => {
    expect(cutoffChoices("2027-02-20", starts(["2027-01-16", "2027-02-01"])).map((x) => [x.start, x.end])).toEqual([
      ["2027-02-16", "2027-02-28"],
      ["2027-03-01", "2027-03-15"],
    ]);
    expect(cutoffChoices("2027-01-03", starts(["2026-12-01", "2026-12-16", "2027-01-01"])).map((x) => x.start)).toEqual(["2027-01-16", "2027-02-01"]);
  });
});

describe("startChoicesFor", () => {
  it("drops cutoffs that start before the version in force does", () => {
    const c = cutoffChoices("2026-11-13", starts([]));
    expect(startChoicesFor(c, "2026-10-16").map((x) => x.start)).toEqual(["2026-10-16"]);
    expect(startChoicesFor(c, "2026-11-01")).toEqual([]);
  });
});

describe("reasonText", () => {
  it("uses the quick pick, or the typed words under Other", () => {
    expect(reasonText("Raise", "ignored")).toBe("Raise");
    expect(reasonText("Other", "  Moved teams  ")).toBe("Moved teams");
    expect(reasonText("Other", "   ")).toBe("");
  });
});
