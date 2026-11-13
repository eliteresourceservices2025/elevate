import { describe, expect, it } from "vitest";
import { flagDatesOf, resolveLines, type LineVersion } from "./lines";

// Period Nov 16-30. Invented line keys and dates only.
const period = { start: "2030-11-16", end: "2030-11-30" };
let n = 0;
type TV = LineVersion & { id: string };
const v = (lineKey: string, effectiveFrom: string, extra: Partial<TV> = {}): TV => ({
  id: `v${++n}`,
  lineKey,
  effectiveFrom,
  endsOn: null,
  createdAt: new Date(Date.UTC(2030, 0, 1, 0, 0, n)),
  ...extra,
});

describe("resolveLines", () => {
  it("uses the version dated on the first day of the period, with no flag", () => {
    const old = v("a", "2030-11-01");
    const current = v("a", "2030-11-16");
    const out = resolveLines([old, current], period);
    expect(out).toHaveLength(1);
    expect(out[0].version).toBe(current);
    expect(out[0].flags).toEqual([]);
  });

  it("keeps the old rate and flags a raise dated inside the period, never two results", () => {
    const old = v("a", "2030-11-01");
    const raise = v("a", "2030-11-20");
    const out = resolveLines([raise, old], period);
    expect(out).toHaveLength(1);
    expect(out[0].version).toBe(old);
    expect(out[0].flags).toEqual(["rate_change_mid_period"]);
  });

  it("lets the newest created_at win when two versions share a date", () => {
    const first = v("a", "2030-11-01", { createdAt: new Date("2030-10-01T00:00:00Z") });
    const second = v("a", "2030-11-01", { createdAt: new Date("2030-10-02T00:00:00Z") });
    expect(resolveLines([second, first], period)[0].version).toBe(second);
    expect(resolveLines([first, second], period)[0].version).toBe(second);
  });

  it("includes a line that starts inside the period, flagged", () => {
    const only = v("a", "2030-11-20");
    const out = resolveLines([only], period);
    expect(out).toHaveLength(1);
    expect(out[0].flags).toEqual(["starts_mid_period"]);
  });

  it("excludes a line that starts after the period", () => {
    expect(resolveLines([v("a", "2030-12-01")], period)).toEqual([]);
  });

  it("excludes a line that ended before the period and flags one that ends inside it", () => {
    expect(resolveLines([v("a", "2030-10-01", { endsOn: "2030-11-10" })], period)).toEqual([]);
    const out = resolveLines([v("a", "2030-10-01", { endsOn: "2030-11-20" })], period);
    expect(out).toHaveLength(1);
    expect(out[0].flags).toEqual(["ends_mid_period"]);
  });

  it("does not flag a line that ends on the last day of the period or later", () => {
    expect(resolveLines([v("a", "2030-10-01", { endsOn: "2030-11-30" })], period)[0].flags).toEqual([]);
    expect(resolveLines([v("a", "2030-10-01", { endsOn: "2031-01-31" })], period)[0].flags).toEqual([]);
  });

  it("returns one result per line key for a person with two lines", () => {
    const out = resolveLines([v("a", "2030-11-01"), v("b", "2030-09-01")], period);
    expect(out.map((r) => r.version.lineKey).sort()).toEqual(["a", "b"]);
  });

  it("flags a start and a later rate change together", () => {
    const start = v("a", "2030-11-18");
    const raise = v("a", "2030-11-25");
    const out = resolveLines([raise, start], period);
    expect(out).toHaveLength(1);
    expect(out[0].version).toBe(start);
    expect(out[0].flags).toEqual(["starts_mid_period", "rate_change_mid_period"]);
  });

  it("accepts created_at as a string", () => {
    const a = v("a", "2030-11-01", { createdAt: "2030-10-01T00:00:00Z" });
    const b = v("a", "2030-11-01", { createdAt: "2030-10-02T00:00:00Z" });
    expect(resolveLines([a, b], period)[0].version).toBe(b);
  });

  it("keeps ends_mid_period when a raise inside the period comes before the end", () => {
    const a = v("a", "2030-11-01");
    const raise = v("a", "2030-11-20");
    const end = v("a", "2030-11-20", { endsOn: "2030-11-25" });
    const out = resolveLines([a, raise, end], period);
    expect(out).toHaveLength(1);
    expect(out[0].version).toBe(a);
    expect(out[0].flags).toEqual(["rate_change_mid_period", "ends_mid_period"]);
  });

  it("ignores a version scheduled after the line's last day (a leaver with a raise saved for later)", () => {
    const a = v("a", "2030-11-01");
    const later = v("a", "2030-12-01");
    const end = v("a", "2030-11-01", { endsOn: "2030-11-25" }); // dated like the version in force on the last day
    const out = resolveLines([a, later, end], period);
    expect(out).toHaveLength(1);
    expect(out[0].version).toBe(end);
    expect(out[0].flags).toEqual(["ends_mid_period"]);
    // The period after the last day carries nothing, even though the later version starts inside it.
    expect(resolveLines([a, later, end], { start: "2030-12-01", end: "2030-12-15" })).toEqual([]);
  });
});

describe("flagDatesOf", () => {
  const period = { start: "2031-01-01", end: "2031-01-15" };
  const v = (effectiveFrom: string, endsOn: string | null = null): LineVersion => ({ lineKey: "k", effectiveFrom, endsOn, createdAt: 0 });

  it("has no dates for a line that is in force the whole period", () => {
    expect(flagDatesOf([v("2030-06-01")], "2030-06-01", period)).toEqual({ startsOn: null, endsOn: null, rateChangeOn: null });
  });

  it("names the start date when the paid version begins after the period began", () => {
    expect(flagDatesOf([v("2031-01-06")], "2031-01-06", period)).toEqual({ startsOn: "2031-01-06", endsOn: null, rateChangeOn: null });
  });

  it("names the first new rate inside the period, not the rate that is paid", () => {
    const versions = [v("2030-06-01"), v("2031-01-10"), v("2031-01-13")];
    expect(flagDatesOf(versions, "2030-06-01", period)).toEqual({ startsOn: null, endsOn: null, rateChangeOn: "2031-01-10" });
  });

  it("names a rate change after a mid-period start, but not the start itself as a rate change", () => {
    expect(flagDatesOf([v("2031-01-04"), v("2031-01-11")], "2031-01-04", period)).toEqual({ startsOn: "2031-01-04", endsOn: null, rateChangeOn: "2031-01-11" });
  });

  it("names the last day when it falls inside the period, and not one on the last day or before the period", () => {
    expect(flagDatesOf([v("2030-06-01", "2031-01-12")], "2030-06-01", period).endsOn).toBe("2031-01-12");
    expect(flagDatesOf([v("2030-06-01", "2031-01-15")], "2030-06-01", period).endsOn).toBeNull();
    expect(flagDatesOf([v("2030-06-01", "2030-12-20")], "2030-06-01", period).endsOn).toBeNull();
  });

  it("ignores a rate saved for after the line ended", () => {
    const versions = [v("2030-06-01", "2031-01-08"), v("2031-01-12")];
    expect(flagDatesOf(versions, "2030-06-01", period)).toEqual({ startsOn: null, endsOn: "2031-01-08", rateChangeOn: null });
  });
});
