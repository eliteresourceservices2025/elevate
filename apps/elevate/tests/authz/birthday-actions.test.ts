import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// setMyBirthdayHidden as each of the six roles, database mocked to throw: everyone may change their OWN setting (nobody can change
// anyone else's, there is no input for it), and bad input is refused before anything touches data.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/people/birthday-actions");

const NO_ACCESS = "You do not have access to do that.";

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("setMyBirthdayHidden, every role", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: may change their own birthday setting`, async () => {
      as(role);
      const result = await actions.setMyBirthdayHidden({ hidden: true });
      expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
    });
  }

  it("refuses input that is not true or false", async () => {
    as("employee");
    expect((await actions.setMyBirthdayHidden({ hidden: "yes" })).ok).toBe(false);
    expect((await actions.setMyBirthdayHidden(null)).ok).toBe(false);
  });
});
