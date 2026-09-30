import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEZONE,
  SECONDARY_TIMEZONE,
  formatDual,
  formatInZone,
  isValidTimeZone,
  resolveTimeZone,
} from "./time";

describe("time zones", () => {
  it("defaults to Arizona and Manila", () => {
    expect(DEFAULT_TIMEZONE).toBe("America/Phoenix");
    expect(SECONDARY_TIMEZONE).toBe("Asia/Manila");
  });

  it("validates zone names", () => {
    expect(isValidTimeZone("America/Phoenix")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("falls back to the default for missing or invalid zones", () => {
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimeZone("nope")).toBe(DEFAULT_TIMEZONE);
    expect(resolveTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("Phoenix is UTC-7 all year (no daylight saving)", () => {
    expect(formatInZone("2026-01-15T12:00:00Z", "America/Phoenix", "HH:mm")).toBe("05:00");
    expect(formatInZone("2026-07-15T12:00:00Z", "America/Phoenix", "HH:mm")).toBe("05:00");
  });

  it("formats one instant in two zones", () => {
    const t = formatDual("2026-07-15T12:00:00Z", { pattern: "yyyy-MM-dd HH:mm" });
    expect(t.primary).toBe("2026-07-15 05:00");
    expect(t.secondary).toBe("2026-07-15 20:00");
  });

  it("honours a viewer-chosen zone and ignores a bad secondary zone", () => {
    const t = formatDual("2026-01-15T12:00:00Z", { zone: "America/New_York", secondaryZone: "bad", pattern: "HH:mm" });
    expect(t.primaryZone).toBe("America/New_York");
    expect(t.secondaryZone).toBe(SECONDARY_TIMEZONE);
    expect(t.primary).toBe("07:00");
  });
});
