import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Safe Voice handler actions and queries, as each of the six roles, with the main database and the Safe Voice connection both mocked
// to throw: whoever is refused is refused before any data is touched. No role grants case access (a Super Admin and HR Admin included);
// only a person individually flagged as a handler passes. The Executive may read counts (and nothing else).

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/safevoice/handler-db", () => ({
  SafevoiceNotConfigured: class SafevoiceNotConfigured extends Error {},
  svdb: new Proxy({}, { get: () => { throw new Error("safe voice database touched"); } }),
}));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/safevoice/actions");
const queries = await import("@/modules/safevoice/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";

const as = (role: RoleSlug, handler: boolean) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role], isSafevoiceHandler: handler };
};

const actionCases: { name: string; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "replyToSafevoiceCase", call: () => actions.replyToSafevoiceCase({ caseId: ID, body: "Thank you for telling us.", expectReply: true }) },
  { name: "setSafevoiceCaseStatus", call: () => actions.setSafevoiceCaseStatus({ caseId: ID, status: "in_review" }) },
  { name: "closeSafevoiceCase", call: () => actions.closeSafevoiceCase({ caseId: ID, outcome: "no_action" }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("Safe Voice handler actions, every role", () => {
  for (const c of actionCases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        it(`${role} without the handler flag: is refused`, async () => {
          as(role, false);
          const result = await c.call();
          expect(result).toEqual({ ok: false, error: NO_ACCESS });
        });
        it(`${role} designated as a handler: passes authorize()`, async () => {
          as(role, true);
          const result = await c.call();
          expect(result.ok).toBe(false);
          expect(result.error).not.toBe(NO_ACCESS); // got past authorize and hit the (mocked) database
        });
      }
    });
  }

  it("rejects bad input before touching data, even for a handler", async () => {
    as("employee", true);
    expect(await actions.replyToSafevoiceCase({ caseId: "nope", body: "x", expectReply: true })).toMatchObject({ ok: false });
    expect(await actions.closeSafevoiceCase({ caseId: ID, outcome: "made-up" })).toMatchObject({ ok: false, error: "Choose an outcome." });
    expect(await actions.setSafevoiceCaseStatus({ caseId: ID, status: "closed" })).toMatchObject({ ok: false });
  });
});

const handlerOnly: { name: string; call: () => Promise<unknown> }[] = [
  { name: "listCases", call: () => queries.listCases({ filter: "open", page: 1, pageSize: 25 }) },
  { name: "getCase", call: () => queries.getCase(ID) },
  { name: "getAttachment", call: () => queries.getAttachment(ID) },
];

const outcome = (call: () => Promise<unknown>) =>
  call().then(
    () => "resolved",
    (e: unknown) => (e instanceof ForbiddenError ? "forbidden" : "other"),
  );

describe("Safe Voice queries, every role", () => {
  for (const c of handlerOnly) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        it(`${role} without the handler flag: is refused`, async () => {
          as(role, false);
          expect(await outcome(c.call)).toBe("forbidden");
        });
        it(`${role} designated as a handler: passes authorize()`, async () => {
          as(role, true);
          expect(await outcome(c.call)).toBe("other");
        });
      }
    });
  }

  describe("getStats (counts only)", () => {
    for (const role of ROLE_SLUGS) {
      const exec = role === "executive";
      it(`${role} without the handler flag: ${exec ? "passes authorize()" : "is refused"}`, async () => {
        as(role, false);
        expect(await outcome(() => queries.getStats())).toBe(exec ? "other" : "forbidden");
      });
      it(`${role} designated as a handler: passes authorize()`, async () => {
        as(role, true);
        expect(await outcome(() => queries.getStats())).toBe("other");
      });
    }
  });
});
