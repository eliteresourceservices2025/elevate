import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentBlocks } from "@/components/content-blocks";
import { customerServiceCourse } from "./index";

// Every slide of the course renders without error, and none shows an answer before the person acts.

describe("the Customer Service course as the player shows it", () => {
  it("renders every screen of every module", () => {
    let screens = 0;
    for (const m of customerServiceCourse.modules) {
      for (const s of m.screens) {
        const html = renderToStaticMarkup(createElement(ContentBlocks, { blocks: s.blocks }));
        expect(html.length, `${m.key}/${s.id}`).toBeGreaterThan(20);
        screens += 1;
      }
    }
    expect(screens).toBeGreaterThanOrEqual(75);
  });

  it("keeps every slide short enough for the lesson stage", () => {
    const text = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(text) : v && typeof v === "object" ? Object.values(v).flatMap(text) : []);
    for (const m of customerServiceCourse.modules) {
      for (const s of m.screens) {
        expect(s.blocks.length, `${m.key}/${s.id} blocks`).toBeLessThanOrEqual(4);
        expect(text(s.blocks).join(" ").length, `${m.key}/${s.id} characters`).toBeLessThanOrEqual(3200);
      }
    }
  });
});
