import { describe, expect, it } from "vitest";
import { balanceOf, expiryAmount, formatDays, isHalfDayStep, unusedByPool, type LedgerEntryType, type LedgerRow } from "./ledger";

let n = 0;
const row = (entryType: LedgerEntryType, daysValue: number, effectiveOn: string, expiresOn: string | null = null): LedgerRow => ({
  id: `r${++n}`,
  entryType,
  days: daysValue,
  effectiveOn,
  expiresOn,
  createdAtMs: n,
});

describe("balanceOf", () => {
  it("is the exact sum, with no floating point drift", () => {
    expect(balanceOf([{ days: 0.1 }, { days: 0.2 }])).toBe(0.3);
    expect(balanceOf([{ days: 1.5 }, { days: -0.5 }, { days: 2 }])).toBe(3);
    expect(balanceOf([])).toBe(0);
  });
});

describe("half day steps and wording", () => {
  it("accepts whole and half days only", () => {
    expect([0.5, 1, 2.5, 5].every(isHalfDayStep)).toBe(true);
    expect([0.25, 1.3, NaN, Infinity].some(isHalfDayStep)).toBe(false);
  });
  it("formats days", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(2)).toBe("2 days");
    expect(formatDays(0.5)).toBe("0.5 days");
    expect(formatDays(-1.5)).toBe("-1.5 days");
  });
});

describe("expiry", () => {
  it("expires an unused award in full", () => {
    const award = row("award", 2, "2026-10-01", "2026-10-31");
    expect(expiryAmount([award], award.id, "2026-10-31")).toBe(2);
  });

  it("expires only what is left after usage, and nothing when it was all used", () => {
    const award = row("award", 2, "2026-10-01", "2026-10-31");
    expect(expiryAmount([award, row("usage", -0.5, "2026-10-10")], award.id, "2026-10-31")).toBe(1.5);
    expect(expiryAmount([award, row("usage", -2, "2026-10-31")], award.id, "2026-10-31")).toBe(0); // used on its last day
  });

  it("uses the days that expire soonest first, so a later award is not wasted", () => {
    const soon = row("award", 2, "2026-10-01", "2026-10-31");
    const later = row("award", 2, "2026-10-02", "2026-12-31");
    const forever = row("award", 2, "2026-10-03");
    const rows = [soon, later, forever, row("usage", -2, "2026-10-15")];
    expect(expiryAmount(rows, soon.id, "2026-10-31")).toBe(0); // the 2 used days came out of the soonest
    expect(unusedByPool(rows, "2026-11-30").get(later.id)).toBe(2);
    expect(unusedByPool(rows, "2026-11-30").get(forever.id)).toBe(2);
  });

  it("cannot draw from days that already expired", () => {
    const old = row("award", 2, "2026-09-01", "2026-09-30");
    const fresh = row("award", 1, "2026-10-01");
    const usage = row("usage", -1, "2026-10-05"); // the old award is gone by now: this must come from the fresh one
    const rows = [old, fresh, usage];
    expect(unusedByPool(rows, "2026-10-10").get(fresh.id)).toBe(0);
    expect(expiryAmount(rows, old.id, "2026-09-30")).toBe(2);
  });

  it("gives days back to the most recent draw when a request is cancelled", () => {
    const a = row("award", 1, "2026-10-01", "2026-10-31");
    const b = row("award", 1, "2026-10-02");
    const rows = [a, b, row("usage", -1.5, "2026-10-10"), row("reversal", 1, "2026-10-11")];
    // 1.5 drew 1 from a and 0.5 from b; the reversal returns 1 to b first (0.5) then a (0.5)
    const left = unusedByPool(rows, "2026-10-31");
    expect(left.get(b.id)).toBe(1);
    expect(left.get(a.id)).toBe(0.5);
  });

  it("treats a negative adjustment as usage and a positive one as days that never expire", () => {
    const a = row("award", 2, "2026-10-01", "2026-10-31");
    const up = row("adjustment", 1, "2026-10-02");
    const rows = [a, up, row("adjustment", -1, "2026-10-03")];
    expect(expiryAmount(rows, a.id, "2026-10-31")).toBe(1);
    expect(unusedByPool(rows, "2026-10-31").get(up.id)).toBe(1);
  });

  it("ignores events after the date asked about", () => {
    const award = row("award", 2, "2026-10-01", "2026-10-31");
    expect(expiryAmount([award, row("usage", -2, "2026-11-05")], award.id, "2026-10-31")).toBe(2);
  });
});
