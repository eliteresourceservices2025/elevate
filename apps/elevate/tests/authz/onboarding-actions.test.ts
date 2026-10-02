import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Onboarding and offboarding actions run as each of the six roles with the database mocked to throw: a role without access is refused
// before anything touches data. Task actions (complete, skip, reopen) look the task up first, so they are covered per role in
// tests/integration/onboarding.test.ts instead.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/onboarding/actions");
const queries = await import("@/modules/onboarding/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const item = { title: "Do it", owner: "hr", dueOffsetDays: 0, required: true, check: "manual" };
const cases: { name: string; allowed: RoleSlug[]; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "saveChecklistTemplate", allowed: HR, call: () => actions.saveChecklistTemplate({ kind: "onboarding", name: "Template", items: [item] }) },
  { name: "archiveChecklistTemplate", allowed: HR, call: () => actions.archiveChecklistTemplate({ templateId: ID }) },
  { name: "completeOnboarding", allowed: HR, call: () => actions.completeOnboarding({ caseId: ID }) },
  { name: "sendTaskAgreement", allowed: HR, call: () => actions.sendTaskAgreement({ taskId: ID }) },
  { name: "startOffboarding", allowed: HR, call: () => actions.startOffboarding({ employeeId: ID, lastWorkingDay: "2099-01-01", reason: "resignation" }) },
  { name: "cancelOffboarding", allowed: HR, call: () => actions.cancelOffboarding({ caseId: ID }) },
  { name: "removeAccessNow", allowed: HR, call: () => actions.removeAccessNow({ caseId: ID }) },
  { name: "completeOffboarding", allowed: HR, call: () => actions.completeOffboarding({ caseId: ID }) },
  { name: "issueCertificate", allowed: HR, call: () => actions.issueCertificate({ employeeId: ID }) },
  // Everyone may submit their OWN exit interview; whether it is theirs is checked against the case in the integration tests
  { name: "submitExitInterview", allowed: [...ROLE_SLUGS], call: () => actions.submitExitInterview({ caseId: ID, reasonForLeaving: "A better offer", wouldReturn: "yes" }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("Onboarding and offboarding actions, every role", () => {
  for (const c of cases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = c.allowed.includes(role);
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
  { name: "getTemplates", allowed: HR, call: () => queries.getTemplates() },
  { name: "listOffboardingCandidates", allowed: HR, call: () => queries.listOffboardingCandidates() },
];

describe("Onboarding queries, every role", () => {
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
