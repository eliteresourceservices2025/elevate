import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// "My data" and privacy actions, run as each of the six roles with the database mocked to throw.
// Every role may use them for their own data (so none is refused); each passes authorize() and then trips the mock.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const privacyActions = await import("@/modules/privacy/actions");
const peopleActions = await import("@/modules/people/actions");
const queries = await import("@/modules/privacy/queries");

const NO_ACCESS = "You do not have access to do that.";
const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("privacy actions, every role", () => {
  const cases: { name: string; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
    { name: "exportMyData (json)", call: () => privacyActions.exportMyData({ format: "json" }) },
    { name: "exportMyData (pdf)", call: () => privacyActions.exportMyData({ format: "pdf" }) },
    { name: "requestDataRights", call: () => peopleActions.requestDataRights({ kind: "correction", details: "Please fix my birth date." }) },
  ];
  for (const c of cases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        it(`${role}: passes authorize()`, async () => {
          as(role);
          const result = await c.call();
          expect(result.ok).toBe(false);
          expect(result.error).not.toBe(NO_ACCESS); // allowed for their own data, then stopped by the mocked database
        });
      }
    });
  }
});

describe("privacy queries, every role", () => {
  for (const [name, call] of [
    ["getMyData", () => queries.getMyData()],
    ["getPrivacyGate", () => queries.getPrivacyGate()],
  ] as const) {
    describe(name, () => {
      for (const role of ROLE_SLUGS) {
        it(`${role}: passes authorize()`, async () => {
          as(role);
          const outcome = await call().then(
            () => "resolved",
            (e: unknown) => (e instanceof Error && e.name === "ForbiddenError" ? "forbidden" : "other"),
          );
          // getPrivacyGate swallows a database failure so the app stays usable; getMyData surfaces it
          expect(outcome).not.toBe("forbidden");
        });
      }
    });
  }
});
