import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Opening ELEVATE Learn as each of the six roles, database mocked to throw: every role is allowed through authorize() and then
// trips the mock (what happens next is covered by tests/integration/learn-handoff.test.ts).

const currentUser = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => true) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/modules/signing/session", () => ({ currentSignInMethods: vi.fn(async () => "password, totp") }));

const actions = await import("@/modules/learn/actions");
const queries = await import("@/modules/learn/queries");

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

const ID = "11111111-1111-4111-8111-111111111111";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

describe("HR's training actions and the status list, every role", () => {
  for (const role of ROLE_SLUGS) {
    const hr = HR.includes(role);
    it(`${role}: ${hr ? "may give more tries" : "is refused giving more tries"}`, async () => {
      as(role);
      const result = await actions.grantLearnRetry({ kind: "tries", assignmentId: ID, amount: 1, reason: "Connection dropped" });
      if (hr) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result).toEqual({ ok: false, error: NO_ACCESS });
    });
    it(`${role}: ${hr ? "may assign the training" : "is refused assigning the training"}`, async () => {
      as(role);
      const result = await actions.assignLearnTraining({ userId: ID, track: "full" });
      if (hr) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result).toEqual({ ok: false, error: NO_ACCESS });
    });
    const sees = hr || role === "team_lead";
    it(`${role}: ${sees ? "may read the status list" : "cannot read the status list"}`, async () => {
      as(role);
      const outcome = await queries.listTrainingStatus({}, { page: 1, pageSize: 25 }).catch((e: unknown) => e);
      if (sees) expect(outcome).not.toMatchObject({ name: "ForbiddenError" });
      else expect(outcome).toMatchObject({ name: "ForbiddenError" });
    });
  }
});
