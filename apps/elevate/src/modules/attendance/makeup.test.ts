import { describe, expect, it } from "vitest";
import { absenceDateProblem, checkMakeupWindow, shortfallMinutes } from "./makeup";

const MIN = 60_000;
const NOW = Date.parse("2030-03-04T15:00:00Z");
const ok = { nowMs: NOW, missedMinutes: 240, alreadyMinutes: 0 };

describe("checkMakeupWindow", () => {
  it("accepts a window ahead that fits the missed time", () => {
    expect(checkMakeupWindow({ ...ok, startMs: NOW + 60 * MIN, endMs: NOW + 180 * MIN })).toBeNull();
  });

  it("refuses an end that is not after the start", () => {
    expect(checkMakeupWindow({ ...ok, startMs: NOW + 60 * MIN, endMs: NOW + 60 * MIN })).toBe("The end must be after the start.");
  });

  it("refuses less than 15 minutes", () => {
    expect(checkMakeupWindow({ ...ok, startMs: NOW + 60 * MIN, endMs: NOW + 70 * MIN })).toBe("Ask for at least 15 minutes.");
  });

  it("is for time that has not started: a window that began more than 5 minutes ago is refused", () => {
    expect(checkMakeupWindow({ ...ok, startMs: NOW - 10 * MIN, endMs: NOW + 60 * MIN })).toBe("Make-up hours are asked for before they are worked. Choose a time that has not started.");
    expect(checkMakeupWindow({ ...ok, startMs: NOW - 3 * MIN, endMs: NOW + 60 * MIN })).toBeNull();
  });

  it("refuses a window more than 31 days away or longer than 16 hours", () => {
    expect(checkMakeupWindow({ ...ok, missedMinutes: 960, startMs: NOW + 32 * 86_400_000, endMs: NOW + 32 * 86_400_000 + 60 * MIN })).toBe("Choose a time within the next 31 days.");
    expect(checkMakeupWindow({ ...ok, missedMinutes: 960, startMs: NOW + 60 * MIN, endMs: NOW + 60 * MIN + 17 * 60 * MIN })).toBe("A make-up window can be 16 hours at most.");
  });

  it("refuses more than what is left to make up for that day, counting windows already asked for", () => {
    expect(checkMakeupWindow({ ...ok, alreadyMinutes: 180, startMs: NOW + 60 * MIN, endMs: NOW + 180 * MIN })).toBe("That is more than the 60 minutes you still have to make up for that day.");
    expect(checkMakeupWindow({ ...ok, alreadyMinutes: 240, startMs: NOW + 60 * MIN, endMs: NOW + 120 * MIN })).toBe("You have already asked to make up all of that day.");
  });
});

describe("shortfallMinutes", () => {
  it("is what the schedule asked for minus what was worked, never negative", () => {
    expect(shortfallMinutes(480, 300)).toBe(180);
    expect(shortfallMinutes(480, 480)).toBe(0);
    expect(shortfallMinutes(480, 600)).toBe(0);
  });

  it("is zero when the person had no schedule that day", () => {
    expect(shortfallMinutes(null, 0)).toBe(0);
  });
});

describe("absenceDateProblem", () => {
  it("accepts a day in the last 31 days before today", () => {
    expect(absenceDateProblem("2030-03-03", "2030-03-04")).toBeNull();
    expect(absenceDateProblem("2030-02-01", "2030-03-04")).toBeNull();
  });

  it("refuses today, a future day or a day more than 31 days back", () => {
    expect(absenceDateProblem("2030-03-04", "2030-03-04")).toBe("Choose a day that has already passed.");
    expect(absenceDateProblem("2030-03-10", "2030-03-04")).toBe("Choose a day that has already passed.");
    expect(absenceDateProblem("2030-01-01", "2030-03-04")).toBe("Make-up hours can only cover the last 31 days.");
  });
});
