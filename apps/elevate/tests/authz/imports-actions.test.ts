import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Import actions and queries run as each of the six roles with the database mocked to throw: a role without access is refused before
// anything touches data.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/imports/actions");
const queries = await import("@/modules/imports/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const cases: { name: string; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "commitImport", call: () => actions.commitImport({ batchId: ID }) },
  { name: "rollbackImport", call: () => actions.rollbackImport({ batchId: ID }) },
  { name: "discardImport", call: () => actions.discardImport({ batchId: ID }) },
  { name: "signOffImport", call: () => actions.signOffImport({ batchId: ID }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("Import actions, every role", () => {
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

const queryCases: { name: string; call: () => Promise<unknown> }[] = [
  { name: "listBatches", call: () => queries.listBatches() },
  { name: "getBatch", call: () => queries.getBatch(ID) },
  { name: "listBatchRows", call: () => queries.listBatchRows(ID, { filter: "all", page: 1, pageSize: 25 }) },
  { name: "getReconciliation", call: () => queries.getReconciliation(ID) },
];

describe("Import queries, every role", () => {
  for (const c of queryCases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = HR.includes(role);
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
