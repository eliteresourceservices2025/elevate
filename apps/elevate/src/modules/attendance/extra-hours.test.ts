import { describe, expect, it } from "vitest";
import { approvedExtra, checkWindow, coveringWindow, dayLimitWarning, effectiveEndMs, grantedByDate, isAfterTheFact, needsHrForAge, windowMinutes } from "./extra-hours";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse("2026-10-05T12:00:00Z");
const ok = { nowMs: NOW, maxPerDayMinutes: 240, alreadyGrantedMinutes: 0 };

describe("checking a requested window", () => {
  it("accepts a normal window", () => {
    expect(checkWindow({ ...ok, startMs: NOW + 2 * HOUR, endMs: NOW + 4 * HOUR })).toBeNull();
  });

  it("refuses an end before the start, a window under 15 minutes, and one longer than a day", () => {
    expect(checkWindow({ ...ok, startMs: NOW + HOUR, endMs: NOW + HOUR })).toBe("The end must be after the start.");
    expect(checkWindow({ ...ok, startMs: NOW + HOUR, endMs: NOW + HOUR - MIN })).toBe("The end must be after the start.");
    expect(checkWindow({ ...ok, startMs: NOW + HOUR, endMs: NOW + HOUR + 10 * MIN })).toBe("Ask for at least 15 minutes.");
    expect(checkWindow({ ...ok, startMs: NOW + HOUR, endMs: NOW + HOUR + 25 * HOUR, maxPerDayMinutes: 99999 })).toBe("A request cannot be longer than a day.");
  });

  it("holds the day's total to the cap, counting what is already asked or approved", () => {
    expect(checkWindow({ ...ok, startMs: NOW + HOUR, endMs: NOW + 5 * HOUR })).toBeNull(); // exactly 4 hours
    expect(checkWindow({ ...ok, startMs: NOW + HOUR, endMs: NOW + 5 * HOUR + MIN })).toContain("more than 4 hours");
    expect(checkWindow({ ...ok, alreadyGrantedMinutes: 180, startMs: NOW + HOUR, endMs: NOW + 3 * HOUR })).toContain("more than 4 hours");
    expect(checkWindow({ ...ok, alreadyGrantedMinutes: 180, startMs: NOW + HOUR, endMs: NOW + 2 * HOUR })).toBeNull();
    expect(checkWindow({ ...ok, maxPerDayMinutes: 90, startMs: NOW + HOUR, endMs: NOW + 3 * HOUR })).toContain("more than 1.5 hours");
  });

  it("allows asking up to 30 days ahead and 31 days back", () => {
    const day = 24 * HOUR;
    expect(checkWindow({ ...ok, startMs: NOW + 29 * day, endMs: NOW + 29 * day + HOUR })).toBeNull();
    expect(checkWindow({ ...ok, startMs: NOW + 31 * day, endMs: NOW + 31 * day + HOUR })).toBe("Requests can be made up to 30 days ahead.");
    expect(checkWindow({ ...ok, startMs: NOW - 5 * day, endMs: NOW - 5 * day + HOUR })).toBeNull();
    expect(checkWindow({ ...ok, startMs: NOW - 40 * day, endMs: NOW - 40 * day + HOUR })).toBe("That is too long ago to ask for. Ask HR.");
  });

  it("measures a window in minutes and spots one asked for after the fact", () => {
    expect(windowMinutes({ startMs: NOW, endMs: NOW + 90 * MIN })).toBe(90);
    expect(isAfterTheFact(NOW - MIN, NOW)).toBe(true);
    expect(isAfterTheFact(NOW + MIN, NOW)).toBe(false);
    expect(needsHrForAge(NOW - 8 * 24 * HOUR, NOW)).toBe(true);
    expect(needsHrForAge(NOW - 6 * 24 * HOUR, NOW)).toBe(false);
  });

  it("warns, but does not block, when the day gets very long", () => {
    expect(dayLimitWarning(420, 240, 720)).toBeNull(); // 11 hours
    expect(dayLimitWarning(480, 300, 720)).toContain("13 hours");
    expect(dayLimitWarning(null, 800, 720)).toContain("long day");
  });
});

describe("approved and unapproved extra time", () => {
  it("covers the extra with what was granted, and counts the rest as unapproved", () => {
    expect(approvedExtra(120, 120)).toEqual({ approved: 120, unapproved: 0 });
    expect(approvedExtra(180, 120)).toEqual({ approved: 120, unapproved: 60 });
    expect(approvedExtra(90, 240)).toEqual({ approved: 90, unapproved: 0 }); // approved more than was used
    expect(approvedExtra(60, 0)).toEqual({ approved: 0, unapproved: 60 });
    expect(approvedExtra(0, 120)).toEqual({ approved: 0, unapproved: 0 });
  });

  it("does not call a few leftover minutes unapproved", () => {
    expect(approvedExtra(130, 120)).toEqual({ approved: 120, unapproved: 0 }); // 10 left, under the 15 minute threshold
    expect(approvedExtra(135, 120)).toEqual({ approved: 120, unapproved: 15 });
  });

  it("groups granted minutes by the day each window starts in the person's own zone", () => {
    // 11 PM Manila on Oct 5 is 3 PM UTC the same day; 1 AM Manila Oct 6 is 5 PM UTC Oct 5
    const lateNight = Date.parse("2026-10-05T15:00:00Z");
    const afterMidnight = Date.parse("2026-10-05T17:00:00Z");
    const map = grantedByDate([{ startMs: lateNight, minutes: 60 }, { startMs: afterMidnight, minutes: 30 }, { startMs: lateNight + 5 * MIN, minutes: 15 }], "Asia/Manila");
    expect(map.get("2026-10-05")).toBe(75);
    expect(map.get("2026-10-06")).toBe(30);
  });
});

describe("approved windows against the clock", () => {
  const w = (a: number, b: number) => ({ startMs: NOW + a * MIN, endMs: NOW + b * MIN });

  it("finds the approved window that covers now or starts within five minutes", () => {
    expect(coveringWindow([w(-30, 60)], NOW)).toEqual(w(-30, 60));
    expect(coveringWindow([w(3, 60)], NOW)).toEqual(w(3, 60)); // about to start
    expect(coveringWindow([w(10, 60)], NOW)).toBeNull();
    expect(coveringWindow([w(-60, -1)], NOW)).toBeNull(); // over
    expect(coveringWindow([w(-30, 20), w(-10, 90)], NOW)).toEqual(w(-10, 90)); // the one that lasts longest
  });

  it("moves the end of the allowed time to the end of windows that run on from the shift end", () => {
    const shiftEnd = NOW;
    expect(effectiveEndMs(shiftEnd, [])).toBe(shiftEnd);
    expect(effectiveEndMs(shiftEnd, [w(0, 120)])).toBe(NOW + 120 * MIN);
    expect(effectiveEndMs(shiftEnd, [w(10, 60)])).toBe(NOW + 60 * MIN); // starts within the slack
    expect(effectiveEndMs(shiftEnd, [w(60, 120)])).toBe(shiftEnd); // a gap: not part of this shift
    expect(effectiveEndMs(shiftEnd, [w(0, 60), w(60, 120)])).toBe(NOW + 120 * MIN); // chained
  });
});
