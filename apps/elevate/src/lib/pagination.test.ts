import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, pageInfo, paginate, parsePaging } from "./pagination";

describe("parsePaging", () => {
  it("defaults to page 1 and 25 rows", () => {
    expect(parsePaging({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });
  it("accepts the offered sizes only", () => {
    expect(parsePaging({ page: "3", size: "50" })).toEqual({ page: 3, pageSize: 50 });
    expect(parsePaging({ size: "7" }).pageSize).toBe(25);
    expect(parsePaging({ size: "100000" }).pageSize).toBe(25);
    expect(parsePaging({ size: "7" }, 10).pageSize).toBe(10);
  });
  it("ignores garbage and non-positive pages", () => {
    expect(parsePaging({ page: "abc" }).page).toBe(1);
    expect(parsePaging({ page: "-4" }).page).toBe(1);
    expect(parsePaging({ page: "0" }).page).toBe(1);
    expect(parsePaging({ page: ["2"] }).page).toBe(1);
  });
});

describe("pageInfo and paginate", () => {
  const rows = Array.from({ length: 635 }, (_, i) => i + 1);
  it("cuts the first and the last page", () => {
    const first = paginate(rows, 1, 25);
    expect(first.rows).toHaveLength(25);
    expect(first.info).toMatchObject({ page: 1, pages: 26, from: 1, to: 25, total: 635 });
    const last = paginate(rows, 26, 25);
    expect(last.rows).toEqual(rows.slice(625));
    expect(last.info).toMatchObject({ from: 626, to: 635 });
  });
  it("snaps a page past the end to the last page", () => {
    expect(paginate(rows, 999, 25).info.page).toBe(26);
  });
  it("handles an empty list", () => {
    expect(pageInfo(0, 1, 25)).toMatchObject({ page: 1, pages: 1, from: 0, to: 0 });
    expect(paginate([], 4, 10).rows).toEqual([]);
  });
});
