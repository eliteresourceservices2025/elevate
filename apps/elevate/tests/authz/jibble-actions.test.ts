import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Jibble link actions and queries run as each of the six roles with the database mocked to throw. Only HR Admin and
// Super Admin pass authorize(); everyone else is refused first. What the actions do after that is covered by
// tests/integration/jibble.test.ts.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/jibble/actions");
const queries = await import("@/modules/jibble/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const cases: { name: string; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "testJibbleConnection", call: () => actions.testJibbleConnection() },
  { name: "syncJibblePeopleNow", call: () => actions.syncJibblePeopleNow() },
  { name: "setJibblePerson", call: () => actions.setJibblePerson({ employeeId: ID, jibblePersonId: ID }) },
  { name: "retryJibbleSend", call: () => actions.retryJibbleSend({ logId: ID }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("Jibble actions, every role", () => {
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

describe("Jibble overview query, every role", () => {
  for (const role of ROLE_SLUGS) {
    const allowed = HR.includes(role);
    it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
      as(role);
      const outcome = await queries.getJibbleOverview().then(
        () => "resolved",
        (e: unknown) => (e instanceof ForbiddenError ? "forbidden" : "other"),
      );
      expect(outcome).toBe(allowed ? "other" : "forbidden");
    });
  }
});
