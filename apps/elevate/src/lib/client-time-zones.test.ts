import { describe, expect, it } from "vitest";
import { clientTimeZones } from "./client-time-zones";

describe("clientTimeZones", () => {
  it("includes canonical zones, UTC, and the application default without duplicates", () => {
    expect(clientTimeZones(["Asia/Manila", "America/New_York", "Asia/Manila"])).toEqual([
      "America/New_York",
      "America/Phoenix",
      "Asia/Manila",
      "UTC",
    ]);
  });

  it("keeps a valid stored alias without admitting an invalid value", () => {
    const zones = clientTimeZones(["America/New_York"], ["US/Eastern", "Mars/Olympus"]);
    expect(zones).toContain("US/Eastern");
    expect(zones).not.toContain("Mars/Olympus");
  });
});
