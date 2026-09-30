import { describe, expect, it } from "vitest";
import { ForbiddenError, PERMISSIONS, authorize, can, scopeFor, type ActionName } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug, type Scope } from "@/lib/roles";

// Written by hand from docs/architecture-plan.md ("Users, roles and permissions"), NOT derived
// from the registry. If you add or change an action, update this table in the same commit.
// Column order: super_admin, hr_admin, team_lead, recruiter, executive, employee.
// A = all, T = team, O = own, "-" = no access.
// Deferred (grant nothing yet): team lead "assigned openings", recruiter "hand-off only",
// executive "summary" for recruiting and reviews.
const EXPECTED: Record<string, string> = {
  "people.view_directory": "A A A A A A",
  "people.view_profile": "A A T - - O",
  "people.view_sensitive": "A A - - - O",
  "people.edit_profile": "A A - - - -",
  "people.request_contact_change": "- - - - - O",
  "people.create": "A A - - - -",
  "people.archive": "A A - - - -",
  "people.edit_sensitive": "A A - - - -",
  "people.approve_change": "A A - - - -",
  "people.view_client_assignments": "A A T - - O",
  "people.manage_assignments": "A A - - - -",
  "people.manage_clients": "A A - - - -",
  "people.manage_custom_fields": "A A - - - -",
  "people.view_history": "A A T - - O",
  "documents.manage": "A A - - - O",
  "timeoff.approve": "A A T - - -",
  "timeoff.approve_final": "A A - - - -",
  "attendance.view": "A A T - - O",
  "attendance.view_summary": "A A T - A -",
  "recruiting.view": "A A - A - -",
  "onboarding.manage": "A A T - - -",
  "onboarding.view_own_tasks": "- - - - - O",
  "reviews.view": "A A T - - O",
  "safevoice.handle": "- - - - - -", // handler flag only
  "safevoice.view_counts": "- - - - A -",
  "assets.view": "A A T - - O",
  "analytics.view": "A A T - A -",
  "analytics.view_hiring": "A A - A A -",
  "settings.manage_roles": "A - - - - -",
  "settings.set_safevoice_handler": "A - - - - -",
  "settings.reset_mfa": "A - - - - -",
  "settings.view_audit": "A - - - - -",
  "settings.manage_policies": "A A - - - -",
  "invitations.create": "A A - - - -",
};

const SCOPE_CODE: Record<string, Scope | null> = { A: "all", T: "team", O: "own", "-": null };
const actions = Object.keys(PERMISSIONS) as ActionName[];
const userWith = (...roles: RoleSlug[]) => ({ id: "actor", roles });

describe("permission matrix", () => {
  it("has an expected row for every action, and no extra rows", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...actions].sort());
  });

  for (const action of actions) {
    describe(action, () => {
      // eslint-disable-next-line security/detect-object-injection -- action comes from PERMISSIONS keys
      const codes = EXPECTED[action].split(" ");

      ROLE_SLUGS.forEach((role, i) => {
        // eslint-disable-next-line security/detect-object-injection -- index of a fixed tuple
        const expected = SCOPE_CODE[codes[i]];
        it(`${role} -> ${expected ?? "no access"}`, () => {
          expect(scopeFor(userWith(role), action)).toBe(expected);
        });
      });
    });
  }
});

describe("can() and resources", () => {
  it("'all' needs no resource", () => {
    expect(can(userWith("hr_admin"), "people.view_profile")).toBe(true);
  });

  it("'own' allows only the owner and fails closed without a resource", () => {
    const me = userWith("employee");
    expect(can(me, "people.view_profile", { ownerUserId: "actor" })).toBe(true);
    expect(can(me, "people.view_profile", { ownerUserId: "someone-else" })).toBe(false);
    expect(can(me, "people.view_profile")).toBe(false);
  });

  it("'team' needs the actor in the target's manager chain and fails closed without it", () => {
    const lead = userWith("team_lead");
    expect(can(lead, "timeoff.approve", { ownerUserId: "x", managerChainUserIds: ["actor", "boss"] })).toBe(true);
    expect(can(lead, "timeoff.approve", { ownerUserId: "x", managerChainUserIds: ["boss"] })).toBe(false);
    expect(can(lead, "timeoff.approve", { ownerUserId: "x" })).toBe(false);
  });

  it("combines roles: a team lead is also an employee and the widest matching scope wins", () => {
    const both = userWith("team_lead", "employee");
    expect(scopeFor(both, "people.view_profile")).toBe("team");
    expect(can(both, "people.view_profile", { ownerUserId: "actor" })).toBe(true); // own, via employee
    expect(can(both, "people.view_profile", { ownerUserId: "x", managerChainUserIds: ["actor"] })).toBe(true);
    expect(can(both, "people.view_profile", { ownerUserId: "x", managerChainUserIds: [] })).toBe(false);
  });

  it("a user with no roles gets nothing", () => {
    for (const action of actions) expect(can({ id: "actor", roles: [] }, action, { ownerUserId: "actor" })).toBe(false);
  });
});

describe("Safe Voice handlers", () => {
  it("no role opens case access, including Super Admin and HR Admin", () => {
    for (const role of ROLE_SLUGS) expect(can(userWith(role), "safevoice.handle")).toBe(false);
  });

  it("only a named handler can", () => {
    expect(can({ id: "h", roles: ["employee"], isSafevoiceHandler: true }, "safevoice.handle")).toBe(true);
    expect(can({ id: "h", roles: ["employee"], isSafevoiceHandler: false }, "safevoice.handle")).toBe(false);
  });

  it("the handler flag does not widen any other action", () => {
    const handler = { id: "h", roles: ["employee"] as RoleSlug[], isSafevoiceHandler: true };
    expect(can(handler, "settings.manage_roles")).toBe(false);
    expect(can(handler, "people.view_profile", { ownerUserId: "x" })).toBe(false);
  });
});

describe("authorize()", () => {
  it("resolves when allowed and throws ForbiddenError when not", async () => {
    await expect(authorize(userWith("super_admin"), "settings.manage_roles")).resolves.toBeUndefined();
    await expect(authorize(userWith("hr_admin"), "settings.manage_roles")).rejects.toBeInstanceOf(ForbiddenError);
  });
});
