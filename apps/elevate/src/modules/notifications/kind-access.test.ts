import { describe, expect, it } from "vitest";
import type { AuthzUser } from "@/lib/authz";
import { KIND_RULES, hiddenKindPrefixes, hiddenKindRules } from "./kind-access";

const user = (roles: AuthzUser["roles"]): AuthzUser => ({ id: "u1", roles, payrollAccess: null });
const hiddenKinds = (roles: AuthzUser["roles"]) => hiddenKindRules(user(roles)).map((r) => r.kind ?? r.prefix);

describe("hiddenKindPrefixes (recruiting notices)", () => {
  it("hides recruiting notices from a Contractor / VA, an Executive and a person with no role", () => {
    for (const roles of [["employee"], ["executive"], []] as AuthzUser["roles"][]) expect(hiddenKindPrefixes(user(roles))).toContain("recruiting.");
  });
  it("keeps them for every role that holds recruiting.view", () => {
    for (const role of ["super_admin", "hr_admin", "recruiter", "team_lead"] as const) expect(hiddenKindPrefixes(user([role]))).toEqual([]);
  });
  it("follows the role, so a downgraded Super Admin stops seeing them", () => {
    expect(hiddenKindPrefixes(user(["super_admin", "employee"]))).toEqual([]);
    expect(hiddenKindPrefixes(user(["employee"]))).toEqual(["recruiting."]);
  });
});

describe("hiddenKindRules (notices for people who decide)", () => {
  it("hides every decider notice from a Contractor / VA and a Recruiter", () => {
    for (const role of ["employee", "recruiter"] as const) expect(hiddenKinds([role]).length).toBe(KIND_RULES.length - (role === "recruiter" ? 1 : 0));
  });
  it("shows a Super Admin and HR Admin everything", () => {
    for (const role of ["super_admin", "hr_admin"] as const) expect(hiddenKinds([role])).toEqual([]);
  });
  it("hides the HR-only calibration notice from a Team Lead, but keeps their team notices", () => {
    expect(hiddenKinds(["team_lead"])).toEqual(["review.ready_to_calibrate"]);
  });
  it("lets an Executive keep time-off notices but nothing else of this kind", () => {
    const hidden = hiddenKinds(["executive"]);
    expect(hidden).not.toContain("timeoff.approval_needed");
    expect(hidden).not.toContain("timeoff.escalated");
    expect(hidden).toContain("hours.approval_summary");
    expect(hidden).toContain("attendance.correction_needed");
  });
  it("never lists a kind that is also sent to the person the request is about", () => {
    const kinds = KIND_RULES.map((r) => r.kind);
    for (const toThePerson of ["extrahours.reminder", "extrahours.confirm_needed", "timeoff.approved", "timeoff.declined", "attendance.missed_clockout", "attendance.correction_filed_for_you"]) expect(kinds).not.toContain(toThePerson);
  });
});
