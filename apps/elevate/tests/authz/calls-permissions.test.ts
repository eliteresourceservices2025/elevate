import { describe, expect, it } from "vitest";
import { can } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Calls: who may start and join, who may start an all-hands, and the recorder flag (no role grants it; a Super Admin picks people).

const user = (role: RoleSlug, extra: Record<string, unknown> = {}) => ({ id: "11111111-1111-4111-8111-111111111111", roles: [role], ...extra });
const OWN = { ownerUserId: "11111111-1111-4111-8111-111111111111" };

describe("start and join", () => {
  it("every role may start and join (membership is checked separately, on every call action)", () => {
    for (const role of ROLE_SLUGS) {
      expect(can(user(role), "calls.start", OWN), role).toBe(true);
      expect(can(user(role), "calls.join", OWN), role).toBe(true);
    }
  });
  it("nobody can start or join for someone else", () => {
    for (const role of ROLE_SLUGS) expect(can(user(role), "calls.start", { ownerUserId: "someone-else" }), role).toBe(false);
  });
  it("a guest has no calls action at all", () => {
    const guest = { id: "g", roles: [], isGuest: true };
    for (const action of ["calls.start", "calls.join", "calls.start_townhall", "calls.record", "calls.manage_recorders", "calls.settings"] as const) {
      expect(can(guest, action, { ownerUserId: "g" }), action).toBe(false);
    }
  });
});

describe("all-hands", () => {
  it("only HR Admin, Super Admin and Executive start one", () => {
    const allowed = ROLE_SLUGS.filter((role) => can(user(role), "calls.start_townhall"));
    expect([...allowed].sort()).toEqual(["executive", "hr_admin", "super_admin"]);
  });
});

describe("recording", () => {
  it("no role grants it, not even Super Admin", () => {
    for (const role of ROLE_SLUGS) expect(can(user(role), "calls.record", OWN), role).toBe(false);
  });
  it("only a person a Super Admin picked (the flag) may, whatever their role", () => {
    for (const role of ROLE_SLUGS) {
      expect(can(user(role, { canRecordCalls: true }), "calls.record", OWN), role).toBe(true);
      expect(can(user(role, { canRecordCalls: false }), "calls.record", OWN), role).toBe(false);
    }
  });
  it("only a Super Admin picks recorders and changes the call settings", () => {
    const allowed = (action: "calls.manage_recorders" | "calls.settings") => ROLE_SLUGS.filter((role) => can(user(role), action));
    expect(allowed("calls.manage_recorders")).toEqual(["super_admin"]);
    expect(allowed("calls.settings")).toEqual(["super_admin"]);
    // The recorder flag does not let a person pick recorders.
    expect(can(user("employee", { canRecordCalls: true }), "calls.manage_recorders")).toBe(false);
  });
});
