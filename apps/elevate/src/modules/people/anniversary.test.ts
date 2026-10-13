import { describe, expect, it } from "vitest";
import { anniversaryIn, dueAnniversary, yearsText } from "./anniversary";

describe("anniversaryIn", () => {
  it("keeps the month and day", () => {
    expect(anniversaryIn("2024-03-15", 2026)).toBe("2026-03-15");
  });
  it("puts a 29 February start on 28 February in a year with no 29th", () => {
    expect(anniversaryIn("2024-02-29", 2025)).toBe("2025-02-28");
    expect(anniversaryIn("2024-02-29", 2028)).toBe("2028-02-29");
  });
});

describe("dueAnniversary", () => {
  it("is due 7 days before, with the number of years", () => {
    expect(dueAnniversary("2024-11-24", "2026-11-17")).toEqual({ date: "2026-11-24", years: 2, daysAway: 7 });
  });
  it("is still due on the days after that, so a missed run is made up", () => {
    expect(dueAnniversary("2024-11-24", "2026-11-20")).toEqual({ date: "2026-11-24", years: 2, daysAway: 4 });
    expect(dueAnniversary("2024-11-24", "2026-11-23")).toEqual({ date: "2026-11-24", years: 2, daysAway: 1 });
  });
  it("is not due earlier than 7 days, on the day, or after it", () => {
    expect(dueAnniversary("2024-11-24", "2026-11-16")).toBeNull();
    expect(dueAnniversary("2024-11-24", "2026-11-24")).toBeNull();
    expect(dueAnniversary("2024-11-24", "2026-11-25")).toBeNull();
  });
  it("needs a whole year: the first day is not an anniversary", () => {
    expect(dueAnniversary("2026-11-24", "2026-11-17")).toBeNull();
    expect(dueAnniversary("2025-11-24", "2026-11-17")).toEqual({ date: "2026-11-24", years: 1, daysAway: 7 });
  });
  it("crosses New Year", () => {
    expect(dueAnniversary("2023-01-03", "2025-12-28")).toEqual({ date: "2026-01-03", years: 3, daysAway: 6 });
  });
  it("handles a 29 February start", () => {
    expect(dueAnniversary("2024-02-29", "2026-02-21")).toEqual({ date: "2026-02-28", years: 2, daysAway: 7 });
  });
  it("ignores a missing or malformed start date", () => {
    expect(dueAnniversary(null, "2026-11-17")).toBeNull();
    expect(dueAnniversary("", "2026-11-17")).toBeNull();
    expect(dueAnniversary("11/24/2024", "2026-11-17")).toBeNull();
  });
});

describe("yearsText", () => {
  it("reads naturally", () => {
    expect(yearsText(1)).toBe("1 year");
    expect(yearsText(5)).toBe("5 years");
  });
});
