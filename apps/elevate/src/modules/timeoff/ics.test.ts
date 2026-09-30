import { describe, expect, it } from "vitest";
import { buildLeaveIcs } from "./ics";

const invite = { uid: "abc-123", summary: "Day off", startDate: "2026-10-05", endDate: "2026-10-07", stampIso: "2026-10-01T02:30:45.123Z" };

describe("buildLeaveIcs", () => {
  it("builds an all-day event whose end date is the day after the last day", () => {
    const ics = buildLeaveIcs(invite);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261005\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20261008\r\n"); // exclusive end
    expect(ics).toContain("DTSTAMP:20261001T023045Z\r\n");
    expect(ics).toContain("UID:abc-123@elevate\r\n");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain("METHOD:PUBLISH");
  });

  it("crosses a month end for the exclusive end date", () => {
    expect(buildLeaveIcs({ ...invite, startDate: "2026-10-30", endDate: "2026-10-31" })).toContain("DTEND;VALUE=DATE:20261101");
  });

  it("makes a cancellation of the same event", () => {
    const ics = buildLeaveIcs({ ...invite, method: "CANCEL" });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("UID:abc-123@elevate");
  });

  it("escapes text and folds long lines", () => {
    const ics = buildLeaveIcs({ ...invite, summary: `Day off; back, soon\nreally ${"x".repeat(100)}` });
    expect(ics).toContain("\\;");
    expect(ics).toContain("\\,");
    expect(ics).toContain("\\n");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
});
