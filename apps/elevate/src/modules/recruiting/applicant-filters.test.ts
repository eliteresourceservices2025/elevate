import { describe, expect, it } from "vitest";
import { EMPTY_FILTERS, escapeLike, filtersToQuery, parseApplicantFilters } from "./applicant-filters";

const ID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

describe("parseApplicantFilters", () => {
  it("gives no filters for an empty address", () => {
    expect(parseApplicantFilters({})).toEqual(EMPTY_FILTERS);
  });

  it("keeps valid values and drops anything it does not recognise", () => {
    expect(parseApplicantFilters({ q: "  ana   reyes ", stage: "screening", kind: "not_qualified", job: ID.toUpperCase(), source: "linkedin", tag: ID, score: "50", from: "2026-01-05", to: "2026-02-30", sort: "score" })).toEqual({
      q: "ana reyes",
      stage: "screening",
      closeKind: "not_qualified",
      openingId: ID,
      source: "linkedin",
      tagId: ID,
      minScore: 50,
      from: "2026-01-05",
      to: null, // not a real date
      sort: "score",
    });
    expect(parseApplicantFilters({ stage: "nope", kind: "x", job: "1; drop table", source: "x", tag: "nope", score: "60", from: "yesterday", sort: "random" })).toEqual(EMPTY_FILTERS);
  });

  it("accepts the not-said source", () => {
    expect(parseApplicantFilters({ source: "none" }).source).toBe("none");
  });

  it("accepts the open-pipeline stage, takes the first of repeated values and caps the search length", () => {
    expect(parseApplicantFilters({ stage: ["open", "hired"] }).stage).toBe("open");
    expect(parseApplicantFilters({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
});

describe("filtersToQuery", () => {
  it("leaves out everything that is not filtering", () => {
    expect(Object.values(filtersToQuery(EMPTY_FILTERS)).every((v) => v === undefined)).toBe(true);
    expect(filtersToQuery({ ...EMPTY_FILTERS, q: "ana", stage: "offer", sort: "name" })).toMatchObject({ q: "ana", stage: "offer", sort: "name", job: undefined });
  });
});

describe("escapeLike", () => {
  it("makes % _ and \\ plain characters", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});
