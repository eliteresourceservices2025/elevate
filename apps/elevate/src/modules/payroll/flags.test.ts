import { describe, expect, it } from "vitest";
import { flagPills, shortDate, suggestedDays } from "./flags";

const none = { startsOn: null, endsOn: null, rateChangeOn: null };
// 1 to 15 November 2031: Saturday 1 Nov is a weekend; weekdays are 3-7, 10-14 (10 weekdays); 15 Nov is a Saturday.
const period = { start: "2031-11-01", end: "2031-11-15" };

describe("shortDate", () => {
  it("writes the day and the month name", () => {
    expect(shortDate("2031-11-06")).toBe("6 Nov");
    expect(shortDate("2031-01-16")).toBe("16 Jan");
  });
});

describe("flagPills", () => {
  it("is empty without flags", () => {
    expect(flagPills([], none)).toEqual([]);
  });

  it("puts the real date in each pill, and says part-way when the date is missing", () => {
    expect(flagPills(["starts_mid_period"], { ...none, startsOn: "2031-11-06" })).toEqual([{ kind: "starts", text: "Starts 6 Nov" }]);
    expect(flagPills(["ends_mid_period"], { ...none, endsOn: "2031-11-12" })).toEqual([{ kind: "ends", text: "Ends 12 Nov" }]);
    expect(flagPills(["rate_change_mid_period"], { ...none, rateChangeOn: "2031-11-10" })).toEqual([{ kind: "rate", text: "New rate 10 Nov" }]);
    expect(flagPills(["starts_mid_period"], none)).toEqual([{ kind: "starts", text: "Starts part-way" }]);
  });

  it("orders the pills start, new rate, end, left, and says Has left plainly", () => {
    const all = flagPills(["person_left", "ends_mid_period", "rate_change_mid_period", "starts_mid_period"], { startsOn: "2031-11-04", endsOn: "2031-11-13", rateChangeOn: "2031-11-08" });
    expect(all.map((p) => p.kind)).toEqual(["starts", "rate", "ends", "left"]);
    expect(all[3].text).toBe("Has left");
  });
});

describe("suggestedDays", () => {
  it("counts the weekdays from a start inside the cutoff to its last day", () => {
    // Thursday 6 Nov to Saturday 15 Nov: 6, 7, 10, 11, 12, 13, 14
    expect(suggestedDays({ startsOn: "2031-11-06", endsOn: null }, period, 11)).toBe(7);
  });

  it("counts the weekdays from the first day to a last day inside the cutoff", () => {
    // Monday 3 Nov to Wednesday 12 Nov: 3-7 and 10-12
    expect(suggestedDays({ startsOn: null, endsOn: "2031-11-12" }, period, 11)).toBe(8);
  });

  it("uses both ends when the person started and left inside the cutoff", () => {
    expect(suggestedDays({ startsOn: "2031-11-05", endsOn: "2031-11-11" }, period, 11)).toBe(5);
  });

  it("never goes over a full cutoff, and never counts weekends", () => {
    expect(suggestedDays({ startsOn: null, endsOn: null }, period, 11)).toBe(10);
    expect(suggestedDays({ startsOn: null, endsOn: null }, period, 8)).toBe(8);
    expect(suggestedDays({ startsOn: "2031-11-08", endsOn: "2031-11-09" }, period, 11)).toBe(0); // Saturday and Sunday
  });

  it("is 0 when the dates do not overlap the cutoff", () => {
    expect(suggestedDays({ startsOn: "2031-11-20", endsOn: null }, period, 11)).toBe(0);
    expect(suggestedDays({ startsOn: null, endsOn: "2031-10-30" }, period, 11)).toBe(0);
  });
});
