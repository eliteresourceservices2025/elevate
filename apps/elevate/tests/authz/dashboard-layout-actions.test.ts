import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// saveDashboardLayout and resetDashboardLayout as each of the six roles, database mocked to throw: everyone may change their OWN layout
// (there is no input for anyone else's), and bad input is refused before anything touches data.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));
const touched = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { touched.count++; throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/dashboard/layout-actions");

const NO_ACCESS = "You do not have access to do that.";
const GOOD = { view: "team_lead", hidden: ["team-flags"], order: ["decisions"] };

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("saveDashboardLayout and resetDashboardLayout, every role", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: may save and reset their own layout`, async () => {
      as(role);
      const saved = await actions.saveDashboardLayout(GOOD);
      expect(saved.ok === false && saved.error).not.toBe(NO_ACCESS);
      const reset = await actions.resetDashboardLayout({ view: "team_lead" });
      expect(reset.ok === false && reset.error).not.toBe(NO_ACCESS);
    });
  }

  it("refuses input that is not a layout before touching data", async () => {
    as("employee");
    touched.count = 0;
    for (const bad of [null, { view: "boss", hidden: [], order: [] }, { view: "hr", hidden: ["Bad Id"], order: [] }, { view: "hr", hidden: [], order: Array(31).fill("a") }]) {
      const result = await actions.saveDashboardLayout(bad);
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
    }
    expect((await actions.resetDashboardLayout({ view: "x" })).ok).toBe(false);
    expect(touched.count).toBe(0);
  });
});
