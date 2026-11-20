import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// The count queries behind the recruiter and admin dashboard tiles, as each of the six roles, database mocked to throw: a role without
// access is refused (ForbiddenError) before anything touches data; a role with access gets past authorize() and only then hits the database.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));

const recruiting = await import("@/modules/recruiting/queries");
const manager = await import("@/modules/dashboard/manager-queries");

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const CASES: { name: string; run: () => Promise<unknown>; allowed: RoleSlug[] }[] = [
  { name: "getUpcomingInterviews", run: () => recruiting.getUpcomingInterviews(), allowed: ["super_admin", "hr_admin", "recruiter"] },
  { name: "getOffersPending", run: () => recruiting.getOffersPending(), allowed: ["super_admin", "hr_admin", "recruiter"] },
  { name: "getNewApplicantsByOpening", run: () => recruiting.getNewApplicantsByOpening(), allowed: ["super_admin", "hr_admin", "recruiter", "team_lead"] },
  { name: "getTalentPoolCount", run: () => recruiting.getTalentPoolCount(), allowed: ["super_admin", "hr_admin", "recruiter"] },
  { name: "getAccessCounts", run: () => manager.getAccessCounts(), allowed: ["super_admin"] },
  { name: "getAuditHighlights", run: () => manager.getAuditHighlights(), allowed: ["super_admin"] },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

for (const c of CASES) {
  describe(`${c.name}, every role`, () => {
    for (const role of ROLE_SLUGS) {
      const allowed = c.allowed.includes(role);
      it(`${role}: ${allowed ? "gets past authorize" : "is refused"}`, async () => {
        as(role);
        const run = c.run();
        if (allowed) await expect(run).rejects.not.toBeInstanceOf(ForbiddenError);
        else await expect(run).rejects.toBeInstanceOf(ForbiddenError);
      });
    }
  });
}
