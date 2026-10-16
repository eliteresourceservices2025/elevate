import { describe, expect, it } from "vitest";
import { compareWithExisting, groupPossibleDuplicates, normalizeName, strongSignals, type PersonLike } from "./duplicates";

const p = (id: string, first: string, last: string, extra: Partial<PersonLike> = {}): PersonLike => ({ id, first, last, workEmail: `${id}@example.com`, ...extra });

describe("names are compared the way a person would", () => {
  it("ignores case, accents, punctuation and spacing", () => {
    expect(normalizeName("María", "dela  Cruz")).toBe("maria dela cruz");
    expect(normalizeName("Ma.", "Santos", "Cristina")).toBe("ma cristina santos");
    expect(normalizeName("JOSE", "O'Brien")).toBe("jose o brien");
  });
});

describe("strong signals beyond the name", () => {
  it("finds a shared personal email, mobile number or birth date", () => {
    const a = p("a", "Ana", "Reyes", { personalEmail: "Ana.R@gmail.com", mobile: "+63 917 123 4567", birthDate: "1995-03-04" });
    expect(strongSignals(a, p("b", "Ana", "Reyes", { personalEmail: "ana.r@gmail.com" }))).toEqual(["the same email"]);
    expect(strongSignals(a, p("b", "Ana", "Reyes", { mobile: "0917-123-4567" }))).toEqual(["the same mobile number"]);
    expect(strongSignals(a, p("b", "Ana", "Reyes", { birthDate: "1995-03-04" }))).toEqual(["the same birth date"]);
    expect(strongSignals(a, p("b", "Ana", "Reyes"))).toEqual([]);
    // an empty field never matches an empty field
    expect(strongSignals(p("a", "A", "B"), p("b", "A", "B", { mobile: "" }))).toEqual([]);
  });
});

describe("grouping", () => {
  it("groups people who share a name, strongest first, and leaves single names out", () => {
    const groups = groupPossibleDuplicates([
      p("1", "Ben", "Cruz"),
      p("2", "Ana", "Reyes", { birthDate: "1990-01-01" }),
      p("3", "ana", "reyes", { birthDate: "1990-01-01" }),
      p("4", "Dina", "Lim"),
      p("5", "Dina", "Lim"),
    ]);
    expect(groups.map((g) => g.people.map((x) => x.id))).toEqual([["2", "3"], ["4", "5"]]);
    expect(groups[0].signals).toEqual(["the same name", "the same birth date"]);
    expect(groups[1].signals).toEqual(["the same name"]);
  });

  it("finds someone who changed their name AND email, by a shared personal email, mobile number or birth date, and chains records together", () => {
    const groups = groupPossibleDuplicates([
      p("a", "Cong", "Avila", { mobile: "+63 917 555 1212" }),
      p("b", "Victor", "Ormita", { mobile: "0917-555-1212", birthDate: "1991-05-05" }),
      p("c", "Vic", "Ormita-Avila", { birthDate: "1991-05-05" }),
      p("d", "Eve", "Solo"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].people.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(groups[0].signals).toEqual(expect.arrayContaining(["the same mobile number", "the same birth date"]));
    expect(groups[0].signals).not.toContain("the same name");
  });
});

describe("a new person against the existing ones", () => {
  const existing = [p("1", "Ana", "Reyes", { personalEmail: "ana@gmail.com" }), p("2", "Ana", "Reyes")];
  it("says 'same' with a shared signal, 'name' with only the name, and nothing otherwise", () => {
    expect(compareWithExisting(p("n", "Ana", "Reyes", { personalEmail: "ana@gmail.com" }), existing)).toMatchObject({ level: "same", with: { id: "1" } });
    expect(compareWithExisting(p("n", "Ana", "Reyes"), existing)).toMatchObject({ level: "name" });
    expect(compareWithExisting(p("n", "Bea", "Santos"), existing)).toBeNull();
    // a person is never a duplicate of themselves
    expect(compareWithExisting(p("1", "Ana", "Reyes"), [existing[0]])).toBeNull();
  });
});
