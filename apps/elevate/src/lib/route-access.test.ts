import { describe, expect, it } from "vitest";
import { decideAccess, safeNext } from "./route-access";

const to = (path: string) => ({ action: "redirect", to: path });
const allow = { action: "allow" };

describe("decideAccess", () => {
  it("sends signed-out visitors to login and remembers the page", () => {
    expect(decideAccess("/people", null)).toEqual(to("/login?next=%2Fpeople"));
    expect(decideAccess("/", null)).toEqual(to("/login"));
  });

  it("never lets an AAL1 session reach an app page", () => {
    for (const p of ["/dashboard", "/people", "/settings", "/time-off/requests"]) {
      expect(decideAccess(p, "aal1")).toEqual(to("/mfa"));
    }
  });

  it("lets AAL2 sessions in", () => {
    expect(decideAccess("/people", "aal2")).toEqual(allow);
  });

  it("allows MFA pages only at AAL1", () => {
    expect(decideAccess("/mfa", "aal1")).toEqual(allow);
    expect(decideAccess("/mfa", null)).toEqual(to("/login"));
    expect(decideAccess("/mfa", "aal2")).toEqual(to("/dashboard"));
  });

  it("keeps signed-in users off the guest pages", () => {
    expect(decideAccess("/login", null)).toEqual(allow);
    expect(decideAccess("/login", "aal1")).toEqual(to("/mfa"));
    expect(decideAccess("/signup", "aal2")).toEqual(to("/dashboard"));
  });

  it("keeps public pages public and password reset session-only", () => {
    expect(decideAccess("/careers", null)).toEqual(allow);
    expect(decideAccess("/auth/callback", null)).toEqual(allow);
    expect(decideAccess("/verify", null)).toEqual(allow);
    expect(decideAccess("/reset-password", null)).toEqual(to("/login"));
    expect(decideAccess("/reset-password", "aal1")).toEqual(allow);
  });

  it("does not treat look-alike paths as public", () => {
    expect(decideAccess("/careers-admin", null)).toEqual(to("/login?next=%2Fcareers-admin"));
    expect(decideAccess("/authors", "aal1")).toEqual(to("/mfa"));
    expect(decideAccess("/verify-me", null)).toEqual(to("/login?next=%2Fverify-me"));
  });
});

describe("safeNext", () => {
  it("accepts in-app paths", () => {
    expect(safeNext("/people?x=1")).toBe("/people?x=1");
  });
  it("rejects external and malformed targets", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "evil", "", null, undefined]) {
      expect(safeNext(bad)).toBe("/dashboard");
    }
  });
});
