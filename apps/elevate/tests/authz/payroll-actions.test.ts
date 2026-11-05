import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Choosing payroll access, as each of the six roles. The database is replaced with a mock that throws if touched:
// whoever is refused is refused before any data is read.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setPayrollAccess } = await import("@/modules/settings/actions");
const { getPayrollAccessList } = await import("@/modules/settings/queries");

const OTHER = "22222222-2222-4222-8222-222222222222";
const NO_ACCESS = "You do not have access to do that.";

const as = (role: RoleSlug) => {
  currentUser.value = { id: "11111111-1111-4111-8111-111111111111", email: "actor@example.com", roles: [role], payrollAccess: null };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("setPayrollAccess, every role", () => {
  for (const role of ROLE_SLUGS) {
    const allowed = role === "super_admin";
    it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
      as(role);
      const result = await setPayrollAccess({ userId: OTHER, level: "viewer" });
      expect(result.ok).toBe(false);
      if (allowed) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result).toEqual({ ok: false, error: NO_ACCESS });
    });
  }

  it("a payroll level alone does not let a non-Super Admin choose access", async () => {
    currentUser.value = { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com", roles: ["hr_admin"], payrollAccess: "approver" };
    expect(await setPayrollAccess({ userId: OTHER, level: "viewer" })).toEqual({ ok: false, error: NO_ACCESS });
  });

  it("rejects an unknown level before touching data", async () => {
    as("super_admin");
    expect(await setPayrollAccess({ userId: OTHER, level: "owner" })).toEqual({ ok: false, error: "Check the request and try again." });
    expect(await setPayrollAccess({ userId: "nope", level: null })).toEqual({ ok: false, error: "Check the request and try again." });
  });
});

describe("getPayrollAccessList, every role", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: ${role === "super_admin" ? "passes authorize()" : "is refused"}`, async () => {
      as(role);
      if (role === "super_admin") await expect(getPayrollAccessList()).rejects.toThrow("database touched");
      else await expect(getPayrollAccessList()).rejects.toMatchObject({ name: "ForbiddenError" });
    });
  }
});
