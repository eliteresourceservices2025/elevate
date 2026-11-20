import { describe, expect, it } from "vitest";
import { splitByDay } from "./work-log-days";

const T = (iso: string) => Date.parse(iso);
const base = { clientId: "c1", clientName: "Acme", projectId: "p1", projectName: "Intake" };

describe("splitting working time into the person's days", () => {
  it("keeps a stretch inside one day as it is", () => {
    const s = { ...base, from: T("2026-11-10T02:00:00Z"), to: T("2026-11-10T05:00:00Z") };
    expect(splitByDay([s], ["2026-11-10"], "Asia/Manila")).toEqual({ "2026-11-10": [s] });
  });

  it("cuts a stretch that crosses midnight in the person's zone, so each day shows its own part", () => {
    // 22:00 Nov 10 to 02:00 Nov 11 in Manila (UTC+8).
    const s = { ...base, from: T("2026-11-10T14:00:00Z"), to: T("2026-11-10T18:00:00Z") };
    const got = splitByDay([s], ["2026-11-10", "2026-11-11"], "Asia/Manila");
    expect(got["2026-11-10"]).toEqual([{ ...s, to: T("2026-11-10T16:00:00Z") }]);
    expect(got["2026-11-11"]).toEqual([{ ...s, from: T("2026-11-10T16:00:00Z") }]);
  });

  it("leaves out time outside the requested days and gives every requested day a list", () => {
    const s = { ...base, from: T("2026-11-12T02:00:00Z"), to: T("2026-11-12T03:00:00Z") };
    expect(splitByDay([s], ["2026-11-10", "2026-11-11"], "Asia/Manila")).toEqual({ "2026-11-10": [], "2026-11-11": [] });
  });

  it("uses the zone's own midnight, not UTC", () => {
    const s = { ...base, from: T("2026-11-10T20:00:00Z"), to: T("2026-11-10T23:00:00Z") }; // 13:00 to 16:00 in Phoenix (UTC-7)
    expect(splitByDay([s], ["2026-11-10"], "America/Phoenix")["2026-11-10"]).toEqual([s]);
  });
});
