import { describe, expect, it } from "vitest";
import type { AuthzUser } from "@/lib/authz";
import { hiddenNavFor } from "@/lib/nav-access";

// The menu keeps Payroll for people chosen by payroll level only: no role grants it, not even Super Admin.
const user = (roles: AuthzUser["roles"], payrollAccess: AuthzUser["payrollAccess"] = null): AuthzUser => ({ id: "u1", roles, payrollAccess });

describe("hiddenNavFor and the Payroll menu item", () => {
  it("shows Payroll to a person with any payroll level, even with no role", () => {
    for (const level of ["preparer", "approver", "viewer"] as const) expect(hiddenNavFor(user([], level))).not.toContain("/payroll");
  });
  it("hides Payroll from a Super Admin with no level, and from every role with no level", () => {
    expect(hiddenNavFor(user(["super_admin"]))).toContain("/payroll");
    for (const role of ["hr_admin", "executive", "team_lead", "recruiter", "employee"] as const) expect(hiddenNavFor(user([role]))).toContain("/payroll");
  });
  it("does not hide it from a Super Admin who also holds a level", () => {
    expect(hiddenNavFor(user(["super_admin"], "viewer"))).not.toContain("/payroll");
  });
});
