import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Self-identification actions and queries, run as each of the six roles with the database mocked to throw. A role that is
// refused never reaches the database; allowed roles pass authorize() and then trip the mock. What happens after that
// (encryption, who can read what, retention) is covered by tests/integration/demographics.test.ts.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/demographics/actions");
const queries = await import("@/modules/demographics/queries");

const NO_ACCESS = "You do not have access to do that.";
const ID = "11111111-1111-4111-8111-111111111111";
const EVERYONE: RoleSlug[] = [...ROLE_SLUGS];
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("self-identification actions, every role", () => {
  const cases: { name: string; call: () => Promise<{ ok: boolean; error?: string }>; allowed: RoleSlug[] }[] = [
    { name: "saveMySelfIdentification", call: () => actions.saveMySelfIdentification({ gender: "woman", pronouns: "she_her" }), allowed: EVERYONE },
    { name: "clearMySelfIdentification", call: () => actions.clearMySelfIdentification(), allowed: EVERYONE },
  ];
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

  it("bad input is refused before the database is touched", async () => {
    as("employee");
    expect(await actions.saveMySelfIdentification({ gender: "self_described" })).toMatchObject({ ok: false, error: expect.stringContaining("how you describe") });
    expect(await actions.saveMySelfIdentification({ religion: "nonsense" })).toMatchObject({ ok: false });
  });
});

describe("self-identification queries, every role", () => {
  const cases: { name: string; call: () => Promise<unknown>; allowed: RoleSlug[] }[] = [
    { name: "getMySelfIdentification", call: () => queries.getMySelfIdentification(), allowed: EVERYONE },
    { name: "getPronounsFor", call: () => queries.getPronounsFor(ID), allowed: EVERYONE },
    { name: "getSelfIdentificationSummary", call: () => queries.getSelfIdentificationSummary(), allowed: HR },
  ];
  for (const q of cases) {
    describe(q.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = q.allowed.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const outcome = await q.call().then(
            () => "resolved",
            (e: Error) => (e instanceof ForbiddenError ? "forbidden" : "other"),
          );
          expect(outcome).toBe(allowed ? "other" : "forbidden");
        });
      }
    });
  }
});
