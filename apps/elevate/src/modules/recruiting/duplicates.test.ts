import { describe, expect, it } from "vitest";
import { groupDuplicates, nameKey, phoneKey } from "./duplicates";

const c = (id: string, fullName: string, phone: string | null = null) => ({ id, fullName, email: `${id}@example.com`, phone });

describe("phoneKey", () => {
  it("compares the last 10 digits, so a country code or leading zero does not matter", () => {
    expect(phoneKey("+63 917 123 4567")).toBe("9171234567");
    expect(phoneKey("0917-123-4567")).toBe("9171234567");
  });
  it("ignores numbers too short to mean anything", () => {
    expect(phoneKey("12345")).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey("n/a")).toBeNull();
  });
});

describe("nameKey", () => {
  it("ignores case, accents, punctuation and extra spaces", () => {
    expect(nameKey("  José  M. Reyes ")).toBe("jose m reyes");
  });
  it("does not match on a single word", () => {
    expect(nameKey("Ana")).toBeNull();
    expect(nameKey("Al Li")).toBeNull(); // too short to be reliable
  });
});

describe("groupDuplicates", () => {
  it("groups people who share a phone number or a name, and says why", () => {
    const groups = groupDuplicates([
      c("a", "Maria Santos", "0917 123 4567"),
      c("b", "Maria S.", "+63 917 123 4567"), // same phone
      c("c", "Jose Cruz"),
      c("d", "jose  CRUZ"), // same name
      c("e", "Someone Else", "0999 000 1111"),
    ]);
    expect(groups).toEqual([
      { ids: ["a", "b"], reasons: ["phone"] },
      { ids: ["c", "d"], reasons: ["name"] },
    ]);
  });

  it("joins a chain into one group (A and B share a phone, B and C share a name)", () => {
    const groups = groupDuplicates([c("a", "Ann Lee", "0917 000 1111"), c("b", "Anne L. Lee", "0917 000 1111"), c("x", "Ann Lee")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids.sort()).toEqual(["a", "b", "x"]);
    expect(groups[0].reasons).toEqual(["name", "phone"]);
  });

  it("returns nothing when nobody matches", () => {
    expect(groupDuplicates([c("a", "Ana Reyes", "0917 111 2222"), c("b", "Ben Tan", "0917 333 4444")])).toEqual([]);
    expect(groupDuplicates([])).toEqual([]);
  });
});
