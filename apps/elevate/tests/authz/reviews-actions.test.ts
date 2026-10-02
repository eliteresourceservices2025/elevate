import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Review and goal actions run as each of the six roles with the database mocked to throw: a role without access is refused before
// anything touches data. Actions that look the review or goal up first (writing, acknowledging, goals) are covered per role in
// tests/integration/reviews.test.ts instead.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/reviews/actions");
const queries = await import("@/modules/reviews/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const question = { section: "A", prompt: "Quality?", type: "rating", required: true };
const cases: { name: string; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "saveReviewTemplate", call: () => actions.saveReviewTemplate({ name: "Template", questions: [question] }) },
  { name: "archiveReviewTemplate", call: () => actions.archiveReviewTemplate({ templateId: ID }) },
  { name: "setEarlyReviews", call: () => actions.setEarlyReviews({ enabled: true }) },
  { name: "launchReviewCycle", call: () => actions.launchReviewCycle({ name: "Q4 2099", type: "quarterly", templateId: ID, scope: { kind: "everyone" }, selfDueOn: "2099-01-01", leadDueOn: "2099-01-02", calibrateDueOn: "2099-01-03" }) },
  { name: "closeReviewCycle", call: () => actions.closeReviewCycle({ cycleId: ID }) },
  { name: "reassignReviewer", call: () => actions.reassignReviewer({ reviewId: ID, leadUserId: ID }) },
  { name: "calibrateReview", call: () => actions.calibrateReview({ reviewId: ID, finalRating: 3 }) },
  { name: "shareReview", call: () => actions.shareReview({ reviewId: ID }) },
  { name: "shareCycleReviews", call: () => actions.shareCycleReviews({ cycleId: ID }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("Review actions, every role", () => {
  for (const c of cases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = HR.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const result = await c.call();
          expect(result.ok).toBe(false);
          if (allowed) expect(result.error).not.toBe(NO_ACCESS);
          else expect(result.error).toBe(NO_ACCESS);
        });
      }
    });
  }
});

const queryCases: { name: string; allowed: RoleSlug[]; call: () => Promise<unknown> }[] = [
  { name: "listCycles", allowed: HR, call: () => queries.listCycles() },
  { name: "getCycle", allowed: HR, call: () => queries.getCycle(ID) },
  { name: "getReviewTemplates", allowed: HR, call: () => queries.getReviewTemplates() },
  { name: "getLaunchOptions", allowed: HR, call: () => queries.getLaunchOptions() },
  { name: "getReviewSummary", allowed: ["super_admin", "hr_admin", "executive"], call: () => queries.getReviewSummary() },
];

describe("Review queries, every role", () => {
  for (const c of queryCases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = c.allowed.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const outcome = await c.call().then(
            () => "resolved",
            (e: unknown) => (e instanceof ForbiddenError ? "forbidden" : "other"),
          );
          if (allowed) expect(outcome).not.toBe("forbidden");
          else expect(outcome).toBe("forbidden");
        });
      }
    });
  }
});
