import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Contact support as each of the six roles, database mocked to throw: a role without access is refused before anything touches data.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => true) }));

const actions = await import("@/modules/support/actions");
const queries = await import("@/modules/support/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];
const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("support actions, every role", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: may ask for help`, async () => {
      as(role);
      const result = await actions.submitSupportRequest({ topic: "sign_in", subject: "Cannot sign in", message: "It keeps saying my password is wrong." });
      expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
    });
    const allowed = HR.includes(role);
    it(`${role}: ${allowed ? "may close a request" : "is refused closing a request"}`, async () => {
      as(role);
      const result = await actions.closeSupportRequest({ id: ID });
      if (allowed) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result).toEqual({ ok: false, error: NO_ACCESS });
    });
    it(`${role}: ${allowed ? "may read the inbox" : "cannot read the inbox"}`, async () => {
      as(role);
      if (allowed) await expect(queries.listSupportInbox().catch((e: unknown) => e)).resolves.not.toMatchObject({ name: "ForbiddenError" });
      else await expect(queries.listSupportInbox()).rejects.toMatchObject({ name: "ForbiddenError" });
    });
  }
});
