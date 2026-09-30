import { describe, expect, it } from "vitest";
import { planRoleChange } from "./plan";

const base = { actorId: "admin", targetId: "person", currentRoles: ["employee"] as const, superAdminCount: 1 };

describe("planRoleChange", () => {
  it("adds roles and always keeps employee", () => {
    const plan = planRoleChange({ ...base, requestedRoles: ["team_lead"] });
    expect(plan).toEqual({ ok: true, finalRoles: ["team_lead", "employee"], added: ["team_lead"], removed: [] });
  });

  it("removes roles", () => {
    const plan = planRoleChange({ ...base, currentRoles: ["employee", "recruiter"], requestedRoles: [] });
    expect(plan).toEqual({ ok: true, finalRoles: ["employee"], added: [], removed: ["recruiter"] });
  });

  it("refuses self-change", () => {
    const plan = planRoleChange({ ...base, targetId: "admin", requestedRoles: ["super_admin"] });
    expect(plan).toEqual({ ok: false, error: "You cannot change your own roles." });
  });

  it("refuses a no-op", () => {
    expect(planRoleChange({ ...base, requestedRoles: ["employee"] }).ok).toBe(false);
  });

  it("protects the last Super Admin but allows demotion when another exists", () => {
    const current = ["employee", "super_admin"] as const;
    expect(planRoleChange({ ...base, currentRoles: current, requestedRoles: [], superAdminCount: 1 })).toEqual({
      ok: false,
      error: "There must always be at least one Super Admin.",
    });
    expect(planRoleChange({ ...base, currentRoles: current, requestedRoles: [], superAdminCount: 2 }).ok).toBe(true);
  });
});
