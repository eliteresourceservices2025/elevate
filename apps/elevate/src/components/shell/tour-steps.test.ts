import { describe, expect, it } from "vitest";
import { TOUR_STEPS, placeCard, usableSteps } from "./tour-steps";

describe("usableSteps", () => {
  it("keeps the messages and the steps whose target is on screen, with the first target that is there", () => {
    const steps = usableSteps(TOUR_STEPS, (s) => s === '[data-tour="menu-button"]' || s === '[data-tour="account"]');
    expect(steps.map((s) => s.id)).toEqual(["welcome", "menu", "account", "done"]);
    expect(steps.find((s) => s.id === "menu")?.selector).toBe('[data-tour="menu-button"]');
  });
  it("skips every pointing step when nothing is on screen, so the tour is never pointing at nothing", () => {
    expect(usableSteps(TOUR_STEPS, () => false).map((s) => s.id)).toEqual(["welcome", "done"]);
  });
  it("tells a new person the essentials, in plain words and in a sensible order", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(["welcome", "menu", "search", "clock", "bell", "account", "speak-up", "done"]);
    for (const s of TOUR_STEPS) expect(s.body.length).toBeLessThan(260);
  });
});

describe("placeCard", () => {
  const card = { width: 320, height: 180 };
  const desktop = { width: 1280, height: 800 };
  it("docks to the bottom on a phone", () => {
    expect(placeCard({ top: 0, left: 10, width: 30, height: 30 }, { width: 390, height: 844 }, card)).toEqual({ docked: true });
  });
  it("centers a message that points at nothing", () => {
    expect(placeCard(null, desktop, card)).toEqual({ docked: false, top: 310, left: 480 });
  });
  it("sits below the target, centered on it and kept inside the screen", () => {
    expect(placeCard({ top: 10, left: 1200, width: 40, height: 40 }, desktop, card)).toEqual({ docked: false, top: 64, left: 948 }); // clamped to the right edge
    expect(placeCard({ top: 10, left: 600, width: 100, height: 40 }, desktop, card)).toEqual({ docked: false, top: 64, left: 490 });
  });
  it("goes above when there is no room below", () => {
    const place = placeCard({ top: 700, left: 600, width: 100, height: 40 }, desktop, card);
    expect(place).toEqual({ docked: false, top: 506, left: 490 });
  });
  it("goes beside a tall target such as the menu", () => {
    const place = placeCard({ top: 0, left: 0, width: 256, height: 800 }, desktop, card);
    expect(place).toEqual({ docked: false, top: 16, left: 270 });
  });
});
