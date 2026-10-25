import { describe, expect, it } from "vitest";
import { listAddress, returnCrumb, safeReturnTo, withReturn } from "./return-to";

describe("the address a detail page returns to", () => {
  it("accepts our own list pages, with or without filters", () => {
    expect(safeReturnTo("/people")).toBe("/people");
    expect(safeReturnTo("/people?team=abc&page=2")).toBe("/people?team=abc&page=2");
    expect(safeReturnTo("/recruiting/applicants?stage=interview")).toBe("/recruiting/applicants?stage=interview");
    expect(safeReturnTo("/training?course=hipaa")).toBe("/training?course=hipaa");
  });

  it("refuses another site, a protocol-relative address, a backslash trick and pages that are not lists", () => {
    for (const bad of ["https://evil.example/people", "//evil.example/people", "/\evil.example", "/people\n/x", "javascript:alert(1)", "/settings/roles", "/peoplex", "/people/../settings", "", undefined, 5, null]) {
      expect(safeReturnTo(bad as never)).toBeNull();
    }
    expect(safeReturnTo(`/people?${"a".repeat(600)}`)).toBeNull();
  });

  it("names the breadcrumb, and says when the list was filtered", () => {
    expect(returnCrumb("/people")).toEqual({ label: "People", href: "/people" });
    expect(returnCrumb("/people?page=3&sort=name")).toEqual({ label: "People", href: "/people?page=3&sort=name" });
    expect(returnCrumb("/people?q=maria")).toEqual({ label: "People (filtered)", href: "/people?q=maria" });
    expect(returnCrumb(null)).toBeNull();
  });

  it("adds and rebuilds the address safely", () => {
    expect(withReturn("/people/1", "/people?q=a&b")).toBe("/people/1?from=%2Fpeople%3Fq%3Da%26b");
    expect(withReturn("/people/1?tab=jobs", "/people")).toBe("/people/1?tab=jobs&from=%2Fpeople");
    expect(withReturn("/people/1", null)).toBe("/people/1");
    expect(listAddress("/people", { q: "ma ria", page: 2, archived: false, team: undefined })).toBe("/people?q=ma+ria&page=2");
  });
});
