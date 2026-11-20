import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FloorCounts, FloorGrid, countStates, sortFloor } from "./floor-grid";
import type { FloorRow } from "../queries";

const row = (over: Partial<FloorRow>): FloorRow => ({ employeeId: "e1", name: "Ana Reyes", state: "active", minutesInState: 12, activePercentToday: 80, teamName: "Team A", lastSeenMinutes: 1, ...over });

describe("countStates", () => {
  it("counts each state and the counts add up to the rows", () => {
    const rows = [row({ state: "active" }), row({ state: "active" }), row({ state: "idle" }), row({ state: "offline" }), row({ state: "out" })];
    const c = countStates(rows);
    expect(c).toEqual({ active: 2, idle: 1, break: 0, offline: 1, out: 1 });
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(rows.length);
  });
});

describe("sortFloor", () => {
  it("puts offline first, then idle, active, break, out, and sorts ties by name", () => {
    const sorted = sortFloor([row({ employeeId: "1", name: "Zed", state: "out" }), row({ employeeId: "2", name: "Bea", state: "active" }), row({ employeeId: "3", name: "Al", state: "active" }), row({ employeeId: "4", name: "Cy", state: "offline" }), row({ employeeId: "5", name: "Di", state: "idle" })]);
    expect(sorted.map((r) => r.name)).toEqual(["Cy", "Di", "Al", "Bea", "Zed"]);
  });
});

describe("FloorGrid", () => {
  it("says so when nobody has the app yet", () => {
    expect(renderToStaticMarkup(createElement(FloorGrid, { rows: [] }))).toContain("Nobody has the ELEVATE Tracker App yet");
  });
  it("shows a card per person, linked to their day, and escapes names", () => {
    const html = renderToStaticMarkup(createElement(FloorGrid, { rows: [row({ employeeId: "abc", name: "<b>Bad</b> Name" })] }));
    expect(html).toContain("/activity/people/abc");
    expect(html).not.toContain("<b>Bad</b>");
    expect(html).toContain("&lt;b&gt;Bad&lt;/b&gt; Name");
    expect(html).toContain("Active for 12 min");
  });
  it("counts bar shows a link per state with its number", () => {
    const html = renderToStaticMarkup(createElement(FloorCounts, { counts: { active: 3, idle: 1, break: 0, offline: 2, out: 4 }, current: undefined }));
    expect(html).toContain("Active");
    expect(html).toContain(">3<");
    expect(html).toContain("/activity?state=offline");
  });
});
