import { describe, expect, it } from "vitest";
import { retryAtIso } from "./retry-at";

describe("the time an exam can be tried again", () => {
  it("reads what Postgres writes (offset in hours only)", () => {
    expect(retryAtIso("2026-10-25T06:44:20+00")).toBe("2026-10-25T06:44:20+00:00");
    expect(Date.parse(retryAtIso("2026-10-25T06:44:20+00")!)).toBe(Date.parse("2026-10-25T06:44:20Z"));
    expect(Date.parse(retryAtIso("2026-10-25T14:44:20+08")!)).toBe(Date.parse("2026-10-25T06:44:20Z"));
    expect(retryAtIso("2026-10-25T06:44:20-07")).toBe("2026-10-25T06:44:20-07:00");
  });

  it("leaves a full offset alone, and gives null for nothing or nonsense", () => {
    expect(retryAtIso("2026-10-25T06:44:20+00:00")).toBe("2026-10-25T06:44:20+00:00");
    expect(retryAtIso(null)).toBeNull();
    expect(retryAtIso("")).toBeNull();
    expect(retryAtIso("soon")).toBeNull();
  });
});
