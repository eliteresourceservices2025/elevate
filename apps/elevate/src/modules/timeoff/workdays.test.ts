import { describe, expect, it } from "vitest";
import { eachDate, isWeekday, requestDays, workingDaysBetween, workingDaysIn } from "./workdays";

describe("working days", () => {
  it("knows weekdays (2026-10-05 is a Monday)", () => {
    expect(isWeekday("2026-10-05")).toBe(true);
    expect(isWeekday("2026-10-09")).toBe(true);
    expect(isWeekday("2026-10-10")).toBe(false);
    expect(isWeekday("2026-10-11")).toBe(false);
  });

  it("lists dates across month ends and is empty for a backwards range", () => {
    expect(eachDate("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(eachDate("2026-10-05", "2026-10-04")).toEqual([]);
  });

  it("skips weekends and holidays", () => {
    const holidays = new Set(["2026-10-07"]);
    expect(workingDaysIn("2026-10-05", "2026-10-12", holidays)).toEqual(["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-09", "2026-10-12"]);
    expect(workingDaysIn("2026-10-10", "2026-10-11", new Set())).toEqual([]);
  });

  it("counts request days, with half days only on a single working day", () => {
    const none = new Set<string>();
    expect(requestDays("2026-10-05", "2026-10-09", false, none)).toBe(5);
    expect(requestDays("2026-10-05", "2026-10-09", true, none)).toBe(0);
    expect(requestDays("2026-10-05", "2026-10-05", true, none)).toBe(0.5);
    expect(requestDays("2026-10-10", "2026-10-10", true, none)).toBe(0); // a Saturday
    expect(requestDays("2026-10-05", "2026-10-05", false, new Set(["2026-10-05"]))).toBe(0); // a holiday
  });

  it("counts working days elapsed after a start date", () => {
    // Friday 2026-10-02 to Tuesday 2026-10-06: Monday and Tuesday have passed
    expect(workingDaysBetween("2026-10-02", "2026-10-06")).toBe(2);
    expect(workingDaysBetween("2026-10-02", "2026-10-02")).toBe(0);
    expect(workingDaysBetween("2026-10-06", "2026-10-02")).toBe(0);
    expect(workingDaysBetween("2026-10-05", "2026-10-09")).toBe(4);
    expect(workingDaysBetween("2026-10-05", "2026-10-09", new Set(["2026-10-07"]))).toBe(3);
  });
});
