import { describe, expect, it } from "vitest";
import { planDeactivation, planReactivation } from "./deactivate";

const base = { actorId: "a", targetId: "t", alreadyDeactivated: false, isSuperAdmin: false, otherActiveSuperAdmins: 1, profileStatus: null };

describe("planDeactivation", () => {
  it("allows a test account with no people record", () => {
    expect(planDeactivation(base)).toEqual({ ok: true });
  });
  it("refuses your own account", () => {
    expect(planDeactivation({ ...base, targetId: "a" })).toEqual({ ok: false, error: "You cannot deactivate your own account." });
  });
  it("refuses an account that is already off", () => {
    expect(planDeactivation({ ...base, alreadyDeactivated: true }).ok).toBe(false);
  });
  it("keeps at least one active Super Admin", () => {
    expect(planDeactivation({ ...base, isSuperAdmin: true, otherActiveSuperAdmins: 0 }).ok).toBe(false);
    expect(planDeactivation({ ...base, isSuperAdmin: true, otherActiveSuperAdmins: 1 }).ok).toBe(true);
  });
  it("sends a working team member to Offboarding, but allows someone already separated", () => {
    for (const status of ["onboarding", "active", "on_leave"]) expect(planDeactivation({ ...base, profileStatus: status }).ok).toBe(false);
    expect(planDeactivation({ ...base, profileStatus: "separated" }).ok).toBe(true);
  });
});

describe("planReactivation", () => {
  it("only applies to a deactivated account", () => {
    expect(planReactivation({ alreadyDeactivated: true })).toEqual({ ok: true });
    expect(planReactivation({ alreadyDeactivated: false }).ok).toBe(false);
  });
});
