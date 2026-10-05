import { describe, expect, it } from "vitest";
import { availableLenses, defaultLens, pickLens } from "./lens";
import { QUICK_ACTIONS, quickActionsFor } from "./quick-actions";

const user = (...roles: Parameters<typeof availableLenses>[0][number][]) => ({ id: "u1", roles });

describe("views (lenses)", () => {
  it("everyone has My work, and it is the only view for a plain employee", () => {
    expect(availableLenses(["employee"])).toEqual(["my_work"]);
    expect(defaultLens(["employee"])).toBe("my_work");
  });
  it("dual roles get a view for each, most senior first, My work last", () => {
    expect(availableLenses(["employee", "super_admin", "hr_admin"])).toEqual(["admin", "hr", "my_work"]);
    expect(availableLenses(["employee", "super_admin", "team_lead"])).toEqual(["admin", "team_lead", "my_work"]);
    expect(availableLenses(["employee", "executive", "super_admin"])).toEqual(["admin", "executive", "my_work"]);
    expect(defaultLens(["employee", "team_lead", "recruiter"])).toBe("team_lead");
  });
  it("only offers a view the person holds, falling back to the default", () => {
    expect(pickLens(["employee", "hr_admin"], "executive", undefined)).toBe("hr");
    expect(pickLens(["employee", "hr_admin"], "nonsense", "my_work")).toBe("my_work");
    expect(pickLens(["employee"], "admin")).toBe("my_work");
  });
});

describe("quick actions", () => {
  it("shows HR their buttons and an employee only their own", () => {
    const hr = quickActionsFor(user("employee", "hr_admin"), "hr").map((q) => q.id);
    expect(hr).toContain("add-person");
    expect(hr).toContain("post-announcement");
    const emp = quickActionsFor(user("employee"), "my_work").map((q) => q.id);
    expect(emp).toEqual(expect.arrayContaining(["request-time-off", "extra-hours", "my-profile"]));
    expect(emp).not.toContain("add-person");
  });
  it("never offers a button the person has no permission for, whatever view is asked for", () => {
    for (const lens of ["admin", "hr", "executive", "team_lead", "recruiter", "my_work"] as const) {
      const ids = quickActionsFor(user("employee"), lens, 50).map((q) => q.id);
      for (const id of ["add-person", "award-days", "post-announcement", "send-for-signature", "start-offboarding", "launch-review", "register-asset"]) expect(ids).not.toContain(id);
    }
  });
  it("a team lead can review hours but not add people", () => {
    const ids = quickActionsFor(user("employee", "team_lead"), "team_lead").map((q) => q.id);
    expect(ids).toContain("review-hours");
    expect(ids).not.toContain("add-person");
  });
  it("every button links inside the app", () => {
    for (const q of QUICK_ACTIONS) expect(q.href.startsWith("/")).toBe(true);
  });
});
