import { describe, expect, it } from "vitest";
import { layoutSchema, resetSchema } from "./layout-validators";

describe("layoutSchema", () => {
  const ok = { view: "team_lead", hidden: ["team-flags"], order: ["reviews-goals", "decisions"] };

  it("accepts a valid layout", () => {
    expect(layoutSchema.safeParse(ok).success).toBe(true);
    expect(layoutSchema.safeParse({ view: "my_work", hidden: [], order: [] }).success).toBe(true);
  });

  it("rejects a view that does not exist", () => {
    expect(layoutSchema.safeParse({ ...ok, view: "boss" }).success).toBe(false);
  });

  it("rejects tile ids that are not plain lowercase ids (no spaces, capitals, slashes or markup)", () => {
    for (const bad of ["Team Flags", "../x", "<b>", "", "a".repeat(41)]) {
      expect(layoutSchema.safeParse({ ...ok, hidden: [bad] }).success).toBe(false);
      expect(layoutSchema.safeParse({ ...ok, order: [bad] }).success).toBe(false);
    }
  });

  it("allows 30 entries and rejects 31", () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `tile-${i}`);
    expect(layoutSchema.safeParse({ ...ok, hidden: many(30) }).success).toBe(true);
    expect(layoutSchema.safeParse({ ...ok, hidden: many(31) }).success).toBe(false);
    expect(layoutSchema.safeParse({ ...ok, order: many(31) }).success).toBe(false);
  });

  it("rejects missing fields and extra shapes", () => {
    expect(layoutSchema.safeParse({ view: "hr" }).success).toBe(false);
    expect(layoutSchema.safeParse({ view: "hr", hidden: "a", order: [] }).success).toBe(false);
    expect(layoutSchema.safeParse(null).success).toBe(false);
  });
});

describe("resetSchema", () => {
  it("needs a real view", () => {
    expect(resetSchema.safeParse({ view: "executive" }).success).toBe(true);
    expect(resetSchema.safeParse({ view: "x" }).success).toBe(false);
    expect(resetSchema.safeParse({}).success).toBe(false);
  });
});
