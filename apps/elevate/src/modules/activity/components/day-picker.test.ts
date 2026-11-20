import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DayPicker, shiftDay } from "./day-picker";

describe("shiftDay", () => {
  it("moves across month and year ends", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("DayPicker", () => {
  it("links to the previous and next day", () => {
    const html = renderToStaticMarkup(createElement(DayPicker, { basePath: "/activity/people/abc", date: "2026-11-10", today: "2026-11-12" }));
    expect(html).toContain("/activity/people/abc?date=2026-11-09");
    expect(html).toContain("/activity/people/abc?date=2026-11-11");
  });
  it("shows next as a disabled button, not a link, on today", () => {
    const html = renderToStaticMarkup(createElement(DayPicker, { basePath: "/activity/people/abc", date: "2026-11-12", today: "2026-11-12" }));
    expect(html).not.toContain("date=2026-11-13");
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Next day/);
  });
});
