import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// The two summary reads behind the executive dashboard tiles, as each of the six roles, database mocked to throw: a role without access
// is refused (ForbiddenError) before anything touches data; a role with access gets past authorize() and only then reaches the database.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));

const learn = await import("@/modules/learn/queries");
const health = await import("@/modules/dashboard/manager-queries");

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const ALLOWED: RoleSlug[] = ["super_admin", "hr_admin", "executive"];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("getTrainingCompliance (counts only), every role", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: ${ALLOWED.includes(role) ? "gets past authorize" : "is refused"}`, async () => {
      as(role);
      const run = learn.getTrainingCompliance();
      if (ALLOWED.includes(role)) await expect(run).rejects.not.toBeInstanceOf(ForbiddenError);
      else await expect(run).rejects.toBeInstanceOf(ForbiddenError);
    });
  }
});

describe("getHealthSummary (late and total only), every role", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: ${ALLOWED.includes(role) ? "gets past authorize" : "is refused"}`, async () => {
      as(role);
      const run = health.getHealthSummary();
      if (ALLOWED.includes(role)) await expect(run).rejects.not.toBeInstanceOf(ForbiddenError);
      else await expect(run).rejects.toBeInstanceOf(ForbiddenError);
    });
  }
});
