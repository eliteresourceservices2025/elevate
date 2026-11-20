import { describe, expect, it } from "vitest";
import { initials, invoiceActions, invoiceWhy, likePattern, parseShow } from "./list-options";

describe("parseShow", () => {
  it("accepts all and test, and anything else means live", () => {
    expect(["all", "live", "void", "replaced", "test", "archived"].map(parseShow)).toEqual(["all", "live", "void", "replaced", "test", "archived"]);
    expect([parseShow("x"), parseShow(undefined), parseShow(7)]).toEqual(["live", "live", "live"]);
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

describe("invoiceActions and invoiceWhy", () => {
  it("lets a void or replaced invoice be deleted, an archived test invoice be restored or deleted, and a live test invoice be archived", () => {
    expect(invoiceActions({ isTest: false, state: "voided" }).actions).toEqual(["delete"]);
    expect(invoiceActions({ isTest: false, state: "superseded" }).actions).toEqual(["delete"]);
    expect(invoiceActions({ isTest: true, state: "superseded" }).actions).toEqual(["delete"]);
    expect(invoiceActions({ isTest: true, state: "archived" }).actions).toEqual(["restore", "delete"]);
    expect(invoiceActions({ isTest: true, state: "active" }).actions).toEqual(["archive"]);
  });

  it("gives a live real invoice no action and says to void it first", () => {
    const r = invoiceActions({ isTest: false, state: "active" });
    expect(r.actions).toEqual([]);
    expect(r.whyNot).toMatch(/Void it/);
  });

  it("names a reason for every action that does not fit", () => {
    expect(invoiceWhy({ isTest: false, state: "active" })).toMatchObject({ delete: expect.stringMatching(/live invoice/i), archive: expect.stringMatching(/voided/i), restore: "It is not archived." });
    expect(invoiceWhy({ isTest: true, state: "active" }).delete).toMatch(/Archive it first/);
    expect(invoiceWhy({ isTest: true, state: "archived" })).toEqual({ archive: "It is already archived." });
    expect(invoiceWhy({ isTest: false, state: "voided" })).toMatchObject({ archive: expect.stringMatching(/already void/i), restore: "It is not archived." });
  });
});
