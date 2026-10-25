import { describe, expect, it } from "vitest";
import { readableDay } from "./dates";

describe("a day as people read it", () => {
  it("reads a plain day, a full timestamp and leaves anything else alone", () => {
    expect(readableDay("2026-11-13")).toBe("Nov 13, 2026");
    expect(readableDay("2026-10-25T00:00:00.000Z")).toBe("Oct 25, 2026");
    expect(readableDay("soon")).toBe("soon");
    expect(readableDay("")).toBe("");
  });
});
