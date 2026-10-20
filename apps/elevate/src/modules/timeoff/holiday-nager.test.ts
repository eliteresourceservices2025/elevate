import { describe, expect, it } from "vitest";
import { fetchNagerYear, mapNagerHolidays, phKind } from "./holiday-nager";

// Shaped like real Nager.Date responses (2026): PH is all "Public", US mixes nationwide, state-only and observance days.
const PH = [
  { date: "2026-01-01", name: "New Year's Day", global: true, types: ["Public"] },
  { date: "2026-04-04", name: "Holy Saturday", global: true, types: ["Public"] },
  { date: "2026-08-31", name: "National Heroes Day", global: true, types: ["Public"] },
  { date: "2026-10-31", name: "All Saints' Day Eve", global: true, types: ["Public"] },
  { date: "2026-12-25", name: "Christmas Day", global: true, types: ["Public"] },
];
const US = [
  { date: "2026-01-01", name: "New Year's Day", global: true, types: ["Public", "Bank"] },
  { date: "2026-02-12", name: "Lincoln's Birthday", global: false, counties: ["US-CA"], types: ["Observance"] },
  { date: "2026-04-03", name: "Good Friday", global: false, counties: ["US-CT"], types: ["Public"] },
  { date: "2026-10-12", name: "Columbus Day", global: false, counties: ["US-AL"], types: ["Public"] },
  { date: "2026-10-12", name: "Columbus Day", global: true, types: ["Bank"] },
  { date: "2026-12-25", name: "Christmas Day", global: true, types: ["Public", "Bank"] },
];

describe("mapNagerHolidays", () => {
  it("Philippines: keeps every day, classifies the standing ones, and leaves all unchecked", () => {
    const out = mapNagerHolidays("PH", PH);
    expect(out).toHaveLength(5);
    expect(out.every((h) => h.calendar === "PH" && !h.verified)).toBe(true);
    expect(out.map((h) => h.kind)).toEqual(["regular", "special_non_working", "regular", "special_non_working", "regular"]);
    expect(phKind("Eid'l Fitr")).toBe("other");
  });

  it("US: keeps only nationwide Public or Bank days, one per date, saved as checked federal days", () => {
    const out = mapNagerHolidays("US", US);
    expect(out.map((h) => `${h.date} ${h.name}`)).toEqual(["2026-01-01 New Year's Day", "2026-10-12 Columbus Day", "2026-12-25 Christmas Day"]);
    expect(out.every((h) => h.kind === "federal" && h.verified)).toBe(true);
  });

  it("drops rows that do not look right and survives a bad response", () => {
    expect(mapNagerHolidays("PH", [{ date: "12/25/2026", name: "x" }, { date: "2026-05-01" }, null, ...PH.slice(0, 1)])).toHaveLength(1);
    expect(mapNagerHolidays("PH", { error: "nope" })).toEqual([]);
    expect(mapNagerHolidays("PH", "<html>")).toEqual([]);
  });
});

describe("fetchNagerYear", () => {
  it("asks for the year and calendar, and reports only the status when refused", async () => {
    let asked = "";
    const ok = async (url: string) => ((asked = url), { ok: true, status: 200, json: async () => PH });
    expect(await fetchNagerYear(2026, "PH", ok)).toHaveLength(5);
    expect(asked).toBe("https://date.nager.at/api/v3/PublicHolidays/2026/PH");
    await expect(fetchNagerYear(2026, "US", async () => ({ ok: false, status: 429, json: async () => ({}) }))).rejects.toThrow("Nager.Date refused the request (HTTP 429)");
    await expect(fetchNagerYear(1500, "PH", ok)).rejects.toThrow("That year is not supported.");
  });
});
