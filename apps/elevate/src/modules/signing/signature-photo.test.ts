import { describe, expect, it } from "vitest";
import { inkBox, otsuThreshold } from "./signature-photo";

describe("telling ink from paper", () => {
  it("puts the threshold between a dark ink peak and a light paper peak", () => {
    const histogram = new Array<number>(256).fill(0);
    histogram[30] = 400; // ink
    histogram[220] = 9600; // paper
    const t = otsuThreshold(histogram);
    expect(t).toBeGreaterThanOrEqual(30);
    expect(t).toBeLessThan(220);
  });

  it("handles a picture of one grey level without failing", () => {
    const histogram = new Array<number>(256).fill(0);
    histogram[128] = 1000;
    expect(() => otsuThreshold(histogram)).not.toThrow();
  });
});

describe("the box around the ink", () => {
  const w = 10;
  const h = 6;
  const grey = new Uint8Array(w * h).fill(250);
  const set = (x: number, y: number) => {
    grey[y * w + x] = 20;
  };

  it("finds the smallest box that holds every dark pixel, and how much of the picture is ink", () => {
    set(2, 1);
    set(6, 4);
    const { box, inkShare } = inkBox(grey, w, h, 100);
    expect(box).toEqual({ x: 2, y: 1, w: 5, h: 4 });
    expect(inkShare).toBeCloseTo(2 / 60);
  });

  it("returns no box for a blank page", () => {
    expect(inkBox(new Uint8Array(w * h).fill(250), w, h, 100).box).toBeNull();
  });
});
