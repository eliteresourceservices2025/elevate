import { describe, expect, it } from "vitest";
import { anniversariesThisMonth, birthdaysThisMonth, monthDayInYear, monthDayLabel, shortName } from "./celebrations";

describe("birthdaysThisMonth", () => {
  const today = "2026-11-19";
  const rows = [
    { first: "Maria", last: "Santos", monthDay: "11-19" },
    { first: "Jun", last: "Reyes", monthDay: "11-22" },
    { first: "Ana", last: "Torres", monthDay: "11-03" },
    { first: "Karl", last: "Dizon", monthDay: "12-01" },
    { first: "Bad", last: "Row", monthDay: "nonsense" },
  ];

  it("keeps only this month, today first, then upcoming days, then days already gone", () => {
    const out = birthdaysThisMonth(rows, today);
    expect(out.map((c) => c.name)).toEqual(["Maria S.", "Jun R.", "Ana T."]);
    expect(out[0].today).toBe(true);
    expect(out[1].today).toBe(false);
  });

  it("shows month and day only: the result has no year anywhere", () => {
    const out = birthdaysThisMonth(rows, today);
    expect(JSON.stringify(out)).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(out[1].label).toBe("Nov 22");
  });

  it("puts a 29 February birthday on 28 February in a year that is not a leap year", () => {
    const out = birthdaysThisMonth([{ first: "Leap", last: "Day", monthDay: "02-29" }], "2027-02-10");
    expect(out[0].monthDay).toBe("02-28");
    expect(birthdaysThisMonth([{ first: "Leap", last: "Day", monthDay: "02-29" }], "2028-02-10")[0].monthDay).toBe("02-29");
  });
});

describe("anniversariesThisMonth", () => {
  it("lists one year or more only, in date order, with the years", () => {
    const out = anniversariesThisMonth(
      [
        { first: "Karl", last: "Dizon", startDate: "2023-11-24" },
        { first: "Liza", last: "Perez", startDate: "2025-11-05" },
        { first: "New", last: "Starter", startDate: "2026-11-02" },
        { first: "Other", last: "Month", startDate: "2020-03-01" },
      ],
      "2026-11-19",
    );
    expect(out.map((c) => [c.name, c.years])).toEqual([["Liza P.", 1], ["Karl D.", 3]]);
  });
});

describe("small helpers", () => {
  it("formats names and dates", () => {
    expect(shortName("Maria", "santos")).toBe("Maria S.");
    expect(shortName("Cher", "")).toBe("Cher");
    expect(monthDayLabel("02-09")).toBe("Feb 9");
    expect(monthDayInYear("03-01", 2027)).toBe("03-01");
  });
});
