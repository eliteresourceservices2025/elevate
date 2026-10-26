import { describe, expect, it } from "vitest";
import { popupStartsAt } from "./popup-schedule";
import { formatInZone, SECONDARY_TIMEZONE } from "@/lib/time";

describe("popup scheduling on the company calendar", () => {
  it("starts October 26 in Phoenix at 3 PM on October 26 in Manila", () => {
    const at = popupStartsAt("2026-10-26")!;
    expect(at.toISOString()).toBe("2026-10-26T07:00:00.000Z");
    expect(formatInZone(at, SECONDARY_TIMEZONE, "yyyy-MM-dd HH:mm")).toBe("2026-10-26 15:00");
    expect(new Date("2026-10-26T01:00:00+08:00").getTime()).toBeLessThan(at.getTime());
  });
  it("uses the same boundary in summer, since Phoenix has no daylight saving", () => {
    expect(popupStartsAt("2026-06-01")?.toISOString()).toBe("2026-06-01T07:00:00.000Z");
  });
  it("does not try to display an empty or invalid date", () => {
    for (const day of ["", "2026-02-30", "2026-13-01", "10/26/2026"]) expect(popupStartsAt(day)).toBeNull();
  });
});
