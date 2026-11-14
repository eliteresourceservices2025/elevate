import { describe, expect, it } from "vitest";
import { initials, likePattern, parseShow } from "./list-options";

describe("parseShow", () => {
  it("accepts all and test, and anything else means live", () => {
    expect([parseShow("all"), parseShow("test"), parseShow("live"), parseShow("x"), parseShow(undefined)]).toEqual(["all", "test", "live", "live", "live"]);
  });
});

describe("likePattern", () => {
  it("trims, shortens, and writes LIKE characters literally", () => {
    expect(likePattern("  INV-2026  ")).toBe("%INV-2026%");
    expect(likePattern("50%_off\\x")).toBe("%50\\%\\_off\\\\x%");
    expect(likePattern("a".repeat(200))).toBe(`%${"a".repeat(80)}%`);
  });
});

describe("initials", () => {
  it("takes two letters from two words, or two from one", () => {
    expect(initials("Golden Years Primary Care, LLC")).toBe("GY");
    expect(initials("Alturos Labs")).toBe("AL");
    expect(initials("Sunrise")).toBe("SU");
    expect(initials("  ")).toBe("?");
  });
});
