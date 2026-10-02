import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Offer and hiring actions run as each of the six roles with the database mocked to throw: a role without access is refused before
// anything touches data. What they do afterwards, and the per-job checks for team leads (which need the database), are covered by
// tests/integration/offers.test.ts.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/offers/actions");
const queries = await import("@/modules/offers/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];
const MAKERS: RoleSlug[] = ["super_admin", "hr_admin", "recruiter"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const offer = { applicationId: ID, templateId: ID, roleTitle: "Virtual Assistant", startDate: "2026-12-01" };
const cases: { name: string; allowed: RoleSlug[]; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "saveOfferTemplate", allowed: HR, call: () => actions.saveOfferTemplate({ name: "Contractor offer", body: "x".repeat(40) }) },
  { name: "archiveOfferTemplate", allowed: HR, call: () => actions.archiveOfferTemplate({ templateId: ID }) },
  { name: "previewOffer", allowed: MAKERS, call: () => actions.previewOffer(offer) },
  { name: "makeOffer", allowed: MAKERS, call: () => actions.makeOffer(offer) },
  { name: "sendOffer", allowed: MAKERS, call: () => actions.sendOffer({ offerId: ID }) },
  { name: "withdrawOffer", allowed: MAKERS, call: () => actions.withdrawOffer({ offerId: ID }) },
  { name: "resendOfferLink", allowed: MAKERS, call: () => actions.resendOfferLink({ offerId: ID }) },
  { name: "hireCandidate", allowed: HR, call: () => actions.hireCandidate({ applicationId: ID, legalFirstName: "Ana", legalLastName: "Reyes", workEmail: "ana@example.com", startDate: "2026-12-01" }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("Offer and hiring actions, every role", () => {
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

describe("Offer templates query, every role", () => {
  for (const role of ROLE_SLUGS) {
    const allowed = HR.includes(role);
    it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
      as(role);
      const outcome = await queries.listOfferTemplates().then(
        () => "resolved",
        (e: unknown) => (e instanceof ForbiddenError ? "forbidden" : "other"),
      );
      expect(outcome).toBe(allowed ? "other" : "forbidden");
    });
  }
});
