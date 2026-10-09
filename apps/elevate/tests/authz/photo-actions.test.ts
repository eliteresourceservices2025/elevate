import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// removeProfilePhoto as each of the six roles, database mocked to throw: a role without access is refused before anything touches data.
// Own photo: everyone passes authorize(). Someone else's photo: only HR and Super Admin. Real rows are in tests/integration/profile-photo.test.ts.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/people/photo-actions");

const OTHER = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("removeProfilePhoto, every role", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: may remove their own photo`, async () => {
      as(role);
      const result = await actions.removeProfilePhoto();
      expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
    });

    const allowed = HR.includes(role);
    it(`${role}: ${allowed ? "may remove another person's photo" : "is refused for another person's photo"}`, async () => {
      as(role);
      const result = await actions.removeProfilePhoto({ userId: OTHER });
      if (allowed) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result).toEqual({ ok: false, error: NO_ACCESS });
    });
  }

  it("rejects an address that is not an account id", async () => {
    as("hr_admin");
    const result = await actions.removeProfilePhoto({ userId: "../../x" });
    expect(result.ok).toBe(false);
  });
});
