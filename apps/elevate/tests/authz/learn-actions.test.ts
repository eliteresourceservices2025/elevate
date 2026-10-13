import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Opening ELEVATE Learn as each of the six roles, database mocked to throw: every role is allowed through authorize() and then
// trips the mock (what happens next is covered by tests/integration/learn-handoff.test.ts).

const currentUser = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => true) }));
vi.mock("@/modules/signing/session", () => ({ currentSignInMethods: vi.fn(async () => "password, totp") }));

const actions = await import("@/modules/learn/actions");

const NO_ACCESS = "You do not have access to do that.";
const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("opening ELEVATE Learn, every role", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: may open training`, async () => {
      as(role);
      const result = await actions.startLearnLaunch();
      // It got past authorization (and the mocked database then refused it).
      expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
    });
  }

  it("is not available to someone with no role at all", async () => {
    currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "nobody@example.com", roles: [] };
    expect(await actions.startLearnLaunch()).toEqual({ ok: false, error: NO_ACCESS });
  });
});
