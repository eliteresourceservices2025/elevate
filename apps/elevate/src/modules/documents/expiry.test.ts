import { describe, expect, it } from "vitest";
import { daysUntil, describeExpiry, dueReminder, expiryStatus } from "./expiry";

describe("daysUntil and expiryStatus", () => {
  it("counts whole days, negative once expired", () => {
    expect(daysUntil("2026-10-30", "2026-09-30")).toBe(30);
    expect(daysUntil("2026-09-30", "2026-09-30")).toBe(0);
    expect(daysUntil("2026-09-29", "2026-09-30")).toBe(-1);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1); // across a year end
  });

  it("classifies", () => {
    const today = "2026-09-30";
    expect(expiryStatus(null, today)).toBe("none");
    expect(expiryStatus("2027-09-30", today)).toBe("valid");
    expect(expiryStatus("2026-10-30", today)).toBe("expiring"); // exactly 30 days
    expect(expiryStatus("2026-10-31", today)).toBe("valid"); // 31 days
    expect(expiryStatus("2026-09-30", today)).toBe("expiring"); // expires today is still valid today
    expect(expiryStatus("2026-09-29", today)).toBe("expired");
  });

  it("describes in words", () => {
    expect(describeExpiry("2026-10-05", "2026-09-30")).toBe("expires in 5 days");
    expect(describeExpiry("2026-10-01", "2026-09-30")).toBe("expires in 1 day");
    expect(describeExpiry("2026-09-30", "2026-09-30")).toBe("expires today");
    expect(describeExpiry("2026-09-28", "2026-09-30")).toBe("expired 2 days ago");
  });
});

describe("dueReminder", () => {
  const none = new Set<number>();

  it("sends nothing while more than 30 days remain", () => {
    expect(dueReminder("2026-11-15", "2026-09-30", none)).toEqual({ send: null, record: [] });
  });

  it("sends the 30-day reminder on day 30, then the 7-day one, then on the day", () => {
    expect(dueReminder("2026-10-30", "2026-09-30", none)).toEqual({ send: 30, record: [30] });
    expect(dueReminder("2026-10-07", "2026-09-30", new Set([30]))).toEqual({ send: 7, record: [7] });
    expect(dueReminder("2026-09-30", "2026-09-30", new Set([30, 7]))).toEqual({ send: 0, record: [0] });
  });

  it("never repeats a reminder", () => {
    expect(dueReminder("2026-10-25", "2026-09-30", new Set([30]))).toEqual({ send: null, record: [] });
    expect(dueReminder("2026-09-30", "2026-09-30", new Set([30, 7, 0]))).toEqual({ send: null, record: [] });
  });

  it("catches up after missed days by sending only the most urgent and recording the rest", () => {
    // uploaded with 5 days left: 30 and 7 are both due, only the 7-day message goes out
    expect(dueReminder("2026-10-05", "2026-09-30", none)).toEqual({ send: 7, record: [30, 7] });
    // the job was down and the document is already expired
    expect(dueReminder("2026-09-20", "2026-09-30", none)).toEqual({ send: 0, record: [30, 7, 0] });
    expect(dueReminder("2026-09-20", "2026-09-30", new Set([30, 7]))).toEqual({ send: 0, record: [0] });
  });
});
