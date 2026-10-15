import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// People retention actions run as each of the six roles with the database mocked to throw: a role without access is refused
// before anything touches data. What the job does is covered by tests/integration/people-retention.test.ts.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/people/retention-actions");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const cases: { name: string; allowed: RoleSlug[]; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "savePeopleRetention", allowed: HR, call: () => actions.savePeopleRetention({ enabled: false, archiveAfterMonths: 60, anonymizeAfterMonths: 72 }) },
  { name: "setLegalHold", allowed: HR, call: () => actions.setLegalHold({ employeeId: ID, hold: true, reason: "Open dispute" }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("People retention actions, every role", () => {
  for (const c of cases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = c.allowed.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const result = await c.call();
          if (allowed) expect(result.error).not.toBe(NO_ACCESS);
          else {
            expect(result.ok).toBe(false);
            expect(result.error).toBe(NO_ACCESS);
          }
        });
      }
    });
  }
});
