import { describe, expect, it } from "vitest";
import { attendanceRisk, crowdedDayRisk, meanOrNull, netLossRisk, payrollRisks, rankRisks, rateTrend, thinPipelineRisk } from "./risks";
import { orderCases, percentDone, whenLabel } from "./tracker";
import { sparkline } from "./workforce";

describe("early warnings", () => {
  // Mondays from 2026-08-03; week index 8 is 2026-09-28, which is complete on Sunday 2026-10-04.
  const week = (n: number) => new Date(Date.UTC(2026, 7, 3 + n * 7)).toISOString().slice(0, 10);
  const points = (late: (number | null)[]) => late.map((lateRate, i) => ({ week: week(i), lateRate, absentRate: 1 }));
  const ASOF = "2026-10-04";

  it("averages only when every value is visible", () => {
    expect(meanOrNull([2, 4])).toBe(3);
    expect(meanOrNull([2, null])).toBeNull();
    expect(meanOrNull([])).toBeNull();
  });

  it("compares the last 4 complete weeks with the 4 before, and needs all 8 visible", () => {
    const rising = points([9, 2, 2, 2, 2, 6, 6, 6, 8]);
    expect(rateTrend(rising, "lateRate", ASOF)).toEqual({ recent: 6.5, prior: 2, delta: 4.5 });
    expect(rateTrend(points([2, 2, 2, 2, 6, 6, 6, null, 9]), "lateRate", ASOF)).toBeNull();
    expect(rateTrend(points([2, 2, 2]), "lateRate", ASOF)).toBeNull();
  });

  it("ignores a week that has not finished", () => {
    // Week index 9 starts 2026-10-05, after the snapshot day, so it is dropped and weeks 1 to 8 are compared.
    const withPartial = points([2, 2, 2, 2, 2, 6, 6, 6, 6, 99]);
    expect(rateTrend(withPartial, "lateRate", ASOF)?.recent).toBe(6);
  });

  it("warns only for a real rise to a real rate, and states its rule", () => {
    expect(attendanceRisk({ recent: 6, prior: 5, delta: 1 }, "late")).toBeNull();
    expect(attendanceRisk({ recent: 4, prior: 0.5, delta: 3.5 }, "late")).toBeNull();
    expect(attendanceRisk(null, "late")).toBeNull();
    const card = attendanceRisk({ recent: 12, prior: 4, delta: 8 }, "absent");
    expect(card).toMatchObject({ id: "absent-rising", severity: "urgent", title: "Absences are up 8 points" });
    expect(card?.rule).toContain("12%");
  });

  it("flags a net loss of people, but not when a month is hidden", () => {
    const m = (joiners: number | null, leavers: number | null) => ({ joiners, leavers });
    expect(netLossRisk([m(2, 1), m(1, 3), m(0, 3)])).toMatchObject({ id: "net-loss", severity: "warn" });
    expect(netLossRisk([m(2, 2), m(2, 3)])).toBeNull();
    expect(netLossRisk([m(2, 1), m(null, 3), m(0, 9)])).toBeNull();
    expect(netLossRisk([])).toBeNull();
  });

  it("flags an ended pay period that still has unapproved hours", () => {
    const periods = [
      { start: "2026-10-01", end: "2026-10-15", label: "Oct 1-15" },
      { start: "2026-09-16", end: "2026-09-30", label: "Sep 16-30" },
    ];
    const cards = payrollRisks(periods, [{ start: "2026-10-01", pendingDays: 40, pendingPeople: 9 }, { start: "2026-09-16", pendingDays: 3, pendingPeople: 2 }], "2026-10-02");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ severity: "warn", title: "Sep 16-30: 3 days of hours not approved" });
    expect(payrollRisks(periods, [{ start: "2026-09-16", pendingDays: 3, pendingPeople: 2 }], "2026-10-09")[0].severity).toBe("urgent");
    expect(payrollRisks(periods, [{ start: "2026-09-16", pendingDays: 0, pendingPeople: 0 }], "2026-10-05")).toEqual([]);
  });

  it("flags the busiest day only above the bar", () => {
    const days = [{ date: "2026-10-12", count: 3 }, { date: "2026-10-13", count: 7 }];
    expect(crowdedDayRisk(days, 100)).toMatchObject({ id: "crowded-day" });
    expect(crowdedDayRisk(days, 400)).toBeNull(); // 5% of 400 is 20
    expect(crowdedDayRisk([{ date: "2026-10-12", count: 4 }], null)).toBeNull();
    expect(crowdedDayRisk([], 100)).toBeNull();
  });

  it("flags a thin pipeline", () => {
    expect(thinPipelineRisk(19, 18)).toMatchObject({ id: "thin-pipeline" });
    expect(thinPipelineRisk(2, 0)).toBeNull();
    expect(thinPipelineRisk(5, 50)).toBeNull();
    expect(thinPipelineRisk(null, 3)).toBeNull();
  });

  it("ranks by urgency and keeps only the view's cards", () => {
    const card = (id: string, severity: "urgent" | "warn" | "info", lenses: Parameters<typeof rankRisks>[1][]) => ({ id, severity, title: id, rule: "r", href: "/x", lenses });
    const ranked = rankRisks([card("a", "info", ["hr"]), card("b", "urgent", ["hr"]), card("c", "warn", ["executive"])], "hr");
    expect(ranked.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

describe("tracker", () => {
  const c = (name: string, date: string, overdue: number) => ({ id: name, name, position: null, date, done: 1, total: 4, overdue, accessRemoved: false });

  it("words the dates and the progress", () => {
    expect(whenLabel("onboarding", "2026-10-05", "2026-10-05")).toBe("Starts today");
    expect(whenLabel("onboarding", "2026-10-08", "2026-10-05")).toBe("Starts in 3 days");
    expect(whenLabel("onboarding", "2026-10-04", "2026-10-05")).toBe("Started 1 day ago");
    expect(whenLabel("offboarding", "2026-10-06", "2026-10-05")).toBe("Last day in 1 day");
    expect(whenLabel("offboarding", "2026-10-02", "2026-10-05")).toBe("Last day was 3 days ago");
    expect(percentDone(1, 4)).toBe(25);
    expect(percentDone(0, 0)).toBe(0);
  });

  it("puts overdue first, then the soonest date, and stops at the limit", () => {
    const ordered = orderCases([c("late-start", "2026-11-01", 0), c("overdue", "2026-12-01", 2), c("soon", "2026-10-10", 0)]);
    expect(ordered.map((x) => x.name)).toEqual(["overdue", "soon", "late-start"]);
    expect(orderCases(Array.from({ length: 10 }, (_, i) => c(`n${i}`, "2026-10-10", 0)), 6)).toHaveLength(6);
  });
});

describe("workforce sparkline", () => {
  it("draws only visible months and needs two of them", () => {
    expect(sparkline([5])).toBeNull();
    expect(sparkline([null, null, 5])).toBeNull();
    expect(sparkline([10, null, 20, 30])?.split(" ")).toHaveLength(3);
  });

  it("keeps every point inside the box", () => {
    for (const pt of (sparkline([10, 40, 25, 12, 99]) ?? "").split(" ")) {
      const [x, y] = pt.split(",").map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(120);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(36);
    }
  });
});
