import { describe, expect, it } from "vitest";
import { needsProvisioning } from "./provision-rules";

const base = { exists: true, hasBaseRole: true, listed: false, isSuperAdmin: false, anySuperAdmin: true };

describe("needsProvisioning", () => {
  it("sets up an account that has never been seen, or lost its base role", () => {
    expect(needsProvisioning({ ...base, exists: false })).toBe(true);
    expect(needsProvisioning({ ...base, hasBaseRole: false })).toBe(true);
  });
  it("is a plain read for anyone already set up", () => {
    expect(needsProvisioning(base)).toBe(false);
    expect(needsProvisioning({ ...base, listed: true, isSuperAdmin: true })).toBe(false);
  });
  it("promotes a listed person only while nobody is Super Admin yet", () => {
    expect(needsProvisioning({ ...base, listed: true, anySuperAdmin: false })).toBe(true);
  });
  it("does not rerun set-up on every request for a second listed person once a Super Admin exists", () => {
    expect(needsProvisioning({ ...base, listed: true, anySuperAdmin: true })).toBe(false);
  });
});
