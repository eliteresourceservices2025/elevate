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

describe("hiddenNavFor and the Activity menu item", () => {
  it("shows Activity to leads, HR and Super Admin, and hides it from everyone else", () => {
    for (const role of ["team_lead", "hr_admin", "super_admin"] as const) expect(hiddenNavFor(user([role]))).not.toContain("/activity");
    for (const role of ["employee", "recruiter", "executive"] as const) expect(hiddenNavFor(user([role]))).toContain("/activity");
  });
});

describe("hiddenNavFor and the Approvals menu item", () => {
  it("shows Approvals only to roles that can decide something", () => {
    for (const role of ["team_lead", "hr_admin", "super_admin", "executive"] as const) expect(hiddenNavFor(user([role]))).not.toContain("/approvals");
    for (const role of ["employee", "recruiter"] as const) expect(hiddenNavFor(user([role]))).toContain("/approvals");
  });
});

describe("hiddenNavFor and the ELEVATE Tracker App menu item", () => {
  it("shows it to every role", () => {
    for (const role of ["super_admin", "hr_admin", "team_lead", "recruiter", "executive", "employee"] as const) expect(hiddenNavFor(user([role]))).not.toContain("/tracker/download");
  });
});
