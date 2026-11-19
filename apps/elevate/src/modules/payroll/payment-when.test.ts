import { describe, expect, it } from "vitest";
import { hhmm, quickDates, timeLabel, whenLabel } from "./payment-when";

describe("whenLabel", () => {
  it("names the day, and the time in Manila when there is one", () => {
    expect(whenLabel("2026-11-24", null)).toBe("Tue, Nov 24");
    expect(whenLabel("2026-11-24", "09:30")).toBe("Tue, Nov 24 · 9:30 AM PHT");
    expect(whenLabel("2026-11-24", "09:30:00")).toBe("Tue, Nov 24 · 9:30 AM PHT");
  });
});

describe("timeLabel", () => {
  it("reads a 24-hour time as a 12-hour one, with midnight and noon right", () => {
    expect(timeLabel("00:05")).toBe("12:05 AM");
    expect(timeLabel("12:00")).toBe("12:00 PM");
    expect(timeLabel("14:05")).toBe("2:05 PM");
    expect(timeLabel("nope")).toBe("nope");
  });
});

describe("hhmm", () => {
  it("cuts seconds off and keeps blank as null", () => {
    expect(hhmm("09:30:00")).toBe("09:30");
    expect(hhmm(null)).toBeNull();
    expect(hhmm("")).toBeNull();
  });
});

describe("quickDates", () => {
  it("offers today, tomorrow and the coming Tuesday", () => {
    // Monday 2026-11-23: the coming Tuesday is tomorrow.
    expect(quickDates("2026-11-23")).toEqual([
      { label: "Today", value: "2026-11-23" },
      { label: "Tomorrow", value: "2026-11-24" },
      { label: "Next Tuesday", value: "2026-11-24" },
    ]);
  });
  it("never picks today as the next Tuesday, and crosses a month end", () => {
    expect(quickDates("2026-11-24")[2].value).toBe("2026-12-01"); // a Tuesday: the one after
    expect(quickDates("2026-11-30")[1].value).toBe("2026-12-01");
  });
});
