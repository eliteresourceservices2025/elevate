import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// People analytics runs as each of the six roles with the database mocked to throw: a role without access is refused before anything
// touches data. A role with access gets as far as the database (the mock throws "database touched", which is not a refusal).

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

const actions = await import("@/modules/analytics/actions");
const queries = await import("@/modules/analytics/queries");

const NO_ACCESS = "You do not have access to do that.";
const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("exportAnalytics, every role", () => {
  const allowed: RoleSlug[] = ["super_admin", "hr_admin"];
  for (const role of ROLE_SLUGS) {
    it(`${role}: ${allowed.includes(role) ? "passes authorize()" : "is refused"}`, async () => {
      as(role);
      const result = await actions.exportAnalytics({ range: 6, scope: "company" });
      expect(result.ok).toBe(false);
      if (allowed.includes(role)) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result.ok === false && result.error).toBe(NO_ACCESS);
    });
  }
});

describe("getDashboard, every role", () => {
  // The Executive and a Team Lead may look (a team lead at their own downline only); a Recruiter sees hiring; an Employee nothing.
  const allowed: RoleSlug[] = ["super_admin", "hr_admin", "team_lead", "recruiter", "executive"];
  for (const role of ROLE_SLUGS) {
    it(`${role}: ${allowed.includes(role) ? "is let in" : "is refused"}`, async () => {
      as(role);
      const call = queries.getDashboard({});
      if (allowed.includes(role)) await expect(call).rejects.not.toBeInstanceOf(ForbiddenError);
      else await expect(call).rejects.toBeInstanceOf(ForbiddenError);
    });
  }
});
