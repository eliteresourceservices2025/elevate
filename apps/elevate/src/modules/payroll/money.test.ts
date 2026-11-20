import { describe, expect, it } from "vitest";
import { divRoundHalfUp, formatPesos, parseMoney } from "./money";

describe("divRoundHalfUp", () => {
  it("rounds half away from zero", () => {
    expect(divRoundHalfUp(1n, 2n)).toBe(1n);
    expect(divRoundHalfUp(5n, 10n)).toBe(1n);
    expect(divRoundHalfUp(4n, 10n)).toBe(0n);
    expect(divRoundHalfUp(-5n, 10n)).toBe(-1n);
    expect(divRoundHalfUp(-4n, 10n)).toBe(0n);
  });
  it("refuses a zero divisor", () => {
    expect(() => divRoundHalfUp(1n, 0n)).toThrow();
  });
});

describe("parseMoney", () => {
  it("reads pasted amounts into centavos", () => {
    expect(parseMoney("1,250.50")).toBe(125050n);
    expect(parseMoney("1250.5")).toBe(125050n);
    expect(parseMoney("0")).toBe(0n);
    expect(parseMoney(" 12 ")).toBe(1200n);
    expect(parseMoney("10000000.00")).toBe(1000000000n);
  });
  it.each(["$50", "1,25.0", "1.255", "-5", "", "abc", "1e5", "10000000.01"])(
    "refuses %j",
    (input) => {
      expect(parseMoney(input)).toBeNull();
    },
  );
});

describe("formatPesos", () => {
  it("formats centavos with grouping and two decimals", () => {
    expect(formatPesos(125050n)).toBe("1,250.50");
    expect(formatPesos(0n)).toBe("0.00");
    expect(formatPesos(5n)).toBe("0.05");
    expect(formatPesos(-500000n)).toBe("-5,000.00");
  });
});
