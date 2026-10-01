import { describe, expect, it } from "vitest";
import { addDays, mondayOf, periodContaining, recentPeriods, toHours } from "./pay-periods";

describe("pay periods", () => {
  it("cuts twice a month at the 15th, with a month end that follows the calendar", () => {
    expect(periodContaining("semi_monthly", "2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-10-15", label: "Oct 1-15, 2026" });
    expect(periodContaining("semi_monthly", "2026-10-15").end).toBe("2026-10-15");
    expect(periodContaining("semi_monthly", "2026-10-16")).toMatchObject({ start: "2026-10-16", end: "2026-10-31" });
    expect(periodContaining("semi_monthly", "2026-02-20").end).toBe("2026-02-28");
    expect(periodContaining("semi_monthly", "2028-02-20").end).toBe("2028-02-29"); // a leap year
    expect(periodContaining("semi_monthly", "2026-04-30").end).toBe("2026-04-30");
  });

  it("cuts monthly and weekly (Monday to Sunday)", () => {
    expect(periodContaining("monthly", "2026-10-17")).toEqual({ start: "2026-10-01", end: "2026-10-31", label: "Oct 1-31, 2026" });
    expect(periodContaining("weekly", "2026-10-07")).toEqual({ start: "2026-10-05", end: "2026-10-11", label: "Oct 5-11, 2026" });
    expect(periodContaining("weekly", "2026-10-11").start).toBe("2026-10-05"); // Sunday belongs to the week before it
    expect(periodContaining("weekly", "2026-10-12").start).toBe("2026-10-12");
    expect(periodContaining("weekly", "2026-10-30").label).toBe("Oct 26, 2026 - Nov 1, 2026"); // a week that spans two months
  });

  it("cuts every two weeks from an anchor Monday", () => {
    // 2026-01-05 is a Monday
    expect(periodContaining("biweekly", "2026-01-05")).toMatchObject({ start: "2026-01-05", end: "2026-01-18" });
    expect(periodContaining("biweekly", "2026-01-18").start).toBe("2026-01-05");
    expect(periodContaining("biweekly", "2026-01-19")).toMatchObject({ start: "2026-01-19", end: "2026-02-01" });
    expect(periodContaining("biweekly", "2025-12-31")).toMatchObject({ start: "2025-12-22", end: "2026-01-04" }); // before the anchor
    expect(periodContaining("biweekly", "2026-10-07", "2026-10-05").start).toBe("2026-10-05");
  });

  it("lists the current period and earlier ones, newest first, without gaps or overlaps", () => {
    const list = recentPeriods("semi_monthly", "2026-10-20", 4);
    expect(list.map((p) => `${p.start}..${p.end}`)).toEqual(["2026-10-16..2026-10-31", "2026-10-01..2026-10-15", "2026-09-16..2026-09-30", "2026-09-01..2026-09-15"]);
    list.slice(0, -1).forEach((p, i) => expect(addDays(list.at(i + 1)!.end, 1)).toBe(p.start));
    expect(recentPeriods("weekly", "2026-10-07", 2).map((p) => p.start)).toEqual(["2026-10-05", "2026-09-28"]);
  });

  it("finds Mondays and rounds hours to two decimals", () => {
    expect(mondayOf("2026-10-07")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05");
    expect(toHours(450)).toBe(7.5);
    expect(toHours(100)).toBe(1.67);
    expect(toHours(0)).toBe(0);
  });
});
