import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Recruiting actions and queries run as each of the six roles with the database mocked to throw: a role without access is refused
// before anything touches data. What the actions do after that, and the per-opening checks for team leads (which need the
// database), are covered by tests/integration/recruiting.test.ts.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/recruiting/actions");
const queries = await import("@/modules/recruiting/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const MANAGERS: RoleSlug[] = ["super_admin", "hr_admin", "recruiter"];
const INTERVIEWERS: RoleSlug[] = ["super_admin", "hr_admin", "recruiter", "team_lead"];
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const cases: { name: string; allowed: RoleSlug[]; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "saveOpening", allowed: MANAGERS, call: () => actions.saveOpening({}) },
  { name: "setOpeningStatus", allowed: MANAGERS, call: () => actions.setOpeningStatus({ id: ID, status: "open" }) },
  { name: "moveApplication", allowed: MANAGERS, call: () => actions.moveApplication({ applicationId: ID, to: "screening" }) },
  { name: "rejectApplication", allowed: MANAGERS, call: () => actions.rejectApplication({ applicationId: ID, reason: "Not a fit" }) },
  { name: "scheduleInterview", allowed: MANAGERS, call: () => actions.scheduleInterview({}) },
  { name: "cancelInterview", allowed: MANAGERS, call: () => actions.cancelInterview({ interviewId: ID }) },
  { name: "submitScorecard", allowed: INTERVIEWERS, call: () => actions.submitScorecard({}) },
  { name: "saveRetention", allowed: HR, call: () => actions.saveRetention({ enabled: false, rejectedMonths: 12, withdrawnMonths: 6 }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("Recruiting actions, every role", () => {
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
  { name: "listOpenings", allowed: ["super_admin", "hr_admin", "recruiter", "team_lead"], call: () => queries.listOpenings() },
  { name: "getRecruitingSummary", allowed: ["super_admin", "hr_admin", "recruiter", "team_lead", "executive"], call: () => queries.getRecruitingSummary() },
  { name: "getRetentionView", allowed: HR, call: () => queries.getRetentionView() },
  { name: "getOpeningFormOptions", allowed: MANAGERS, call: () => queries.getOpeningFormOptions() },
  { name: "listInterviewerChoices", allowed: MANAGERS, call: () => queries.listInterviewerChoices() },
];

describe("Recruiting queries, every role", () => {
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
          expect(outcome).toBe(allowed ? "other" : "forbidden");
        });
      }
    });
  }
});
