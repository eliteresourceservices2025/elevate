import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TimelineStrip } from "./timeline-strip";

const blocks = [
  { leftPct: 0, widthPct: 10, kind: "working" as const, label: "Clocked in, 00:00 to 02:00" },
  { leftPct: 1, widthPct: 4, kind: "active" as const, label: "Chrome, 00:10 to 01:00, active" },
  { leftPct: 5, widthPct: 2, kind: "idle" as const, label: "Chrome, 01:00 to 01:30, idle" },
];

describe("TimelineStrip", () => {
  const html = renderToStaticMarkup(createElement(TimelineStrip, { blocks, ticks: [{ leftPct: 0, label: "00:00" }], ariaLabel: "Day timeline" }));
  it("is one image for a screen reader, with a title on every block", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Day timeline"');
    expect((html.match(/title="/g) ?? []).length).toBe(3);
  });
  it("uses the status tokens and no raw palette classes", () => {
    expect(html).toContain("bg-success");
    expect(html).toContain("bg-warning");
    expect(html).not.toMatch(/(?:bg|text)-(?:red|green|amber|yellow|blue)-\d/);
  });
});
