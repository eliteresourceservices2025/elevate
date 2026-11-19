import { describe, expect, it } from "vitest";
import { countOnline } from "./online-count";

const people = ["a", "b", "c", "d"].map((userId) => ({ userId }));

describe("countOnline", () => {
  it("counts every member who is online, the viewer included, so it equals the number of green dots", () => {
    expect(countOnline(people, new Set(["a", "c"]))).toBe(2);
    expect(countOnline(people, new Set(["a", "b", "c", "d"]))).toBe(4);
    expect(countOnline(people, new Set())).toBe(0);
  });
  it("ignores people who are connected but no longer members, and members listed twice in the presence set", () => {
    expect(countOnline(people, new Set(["a", "gone", "also-gone"]))).toBe(1);
    expect(countOnline([], new Set(["a"]))).toBe(0);
  });
  it("matches the dots drawn for the same list (the screenshot case: 9 people, 3 online)", () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ userId: `u${i}` }));
    const online = new Set(["u2", "u7", "u8"]);
    const dots = nine.filter((m) => online.has(m.userId)).length;
    expect(countOnline(nine, online)).toBe(dots);
    expect(dots).toBe(3);
  });
});
