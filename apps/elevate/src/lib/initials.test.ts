import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";

describe("initialsOf", () => {
  it("uses the first letters of the first and last word of a name", () => {
    expect(initialsOf("Ana Reyes", "a@x.com")).toBe("AR");
    expect(initialsOf("  maria  clara de la cruz ", "a@x.com")).toBe("MC");
    expect(initialsOf("Ana", "a@x.com")).toBe("A");
  });
  it("falls back to the email when there is no name", () => {
    expect(initialsOf(null, "juan.dela-cruz@example.com")).toBe("JC"); // first and last part
    expect(initialsOf("", "lux_aeterna@example.com")).toBe("LA");
    expect(initialsOf(undefined, "admin@example.com")).toBe("A");
  });
  it("never returns an empty badge", () => {
    expect(initialsOf(null, "@example.com")).toBe("?");
    expect(initialsOf(null, "...@example.com")).toBe("?");
  });
  it("handles letters outside A to Z", () => {
    expect(initialsOf("Ñoño Bañes", "a@x.com")).toBe("ÑB");
  });
});
