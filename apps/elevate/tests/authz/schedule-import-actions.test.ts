import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// The attendance-sheet import's actions and queries as each of the six roles, database mocked to throw: a person without access is
// refused before anything touches data.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: () => {
        throw new Error("database touched");
      },
    },
  ),
}));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => true) }));

const actions = await import("@/modules/schedule-import/actions");
const queries = await import("@/modules/schedule-import/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const ALLOWED: RoleSlug[] = ["super_admin", "hr_admin"];
const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("schedule import, every role", () => {
  for (const role of ROLE_SLUGS) {
    const allowed = ALLOWED.includes(role);
    it(`${role}: ${allowed ? "may" : "is refused"} discarding an upload`, async () => {
      as(role);
      const r = await actions.discardScheduleImport({ batchId: ID });
      if (allowed) expect(r.ok === false && r.error).not.toBe(NO_ACCESS);
      else expect(r).toEqual({ ok: false, error: NO_ACCESS });
    });
    for (const [name, call] of [
      ["listScheduleImports", () => queries.listScheduleImports()],
      ["getScheduleImportPlan", () => queries.getScheduleImportPlan(ID)],
    ] as const) {
      it(`${role}: ${allowed ? "may read" : "cannot read"} ${name}`, async () => {
        as(role);
        const out = await call().catch((e: unknown) => e);
        if (allowed) expect(out).not.toMatchObject({ name: "ForbiddenError" });
        else expect(out).toMatchObject({ name: "ForbiddenError" });
      });
    }
  }

  for (const role of ROLE_SLUGS) {
    const allowed = ALLOWED.includes(role);
    it(`${role}: ${allowed ? "may" : "is refused"} applying an import`, async () => {
      as(role);
      const r = await actions.applyScheduleImport({ batchId: ID, digest: "a".repeat(64), accepted: [{ key: "k" }], endAssignmentIds: [], endDate: null, acknowledgeBackdated: false });
      if (allowed) expect(r.ok === false && r.error).not.toBe(NO_ACCESS);
      else expect(r).toEqual({ ok: false, error: NO_ACCESS });
    });
  }

  it("refuses a malformed apply request before reaching the database", async () => {
    as("hr_admin");
    expect((await actions.applyScheduleImport({ batchId: "nope", digest: "x", accepted: [] })).ok).toBe(false);
    expect((await actions.applyScheduleImport({ batchId: ID, digest: "a".repeat(64), accepted: [{ key: "k", breakMinutes: 999 }] })).ok).toBe(false);
  });

  it("refuses a malformed id before reaching the database", async () => {
    as("hr_admin");
    const r = await actions.discardScheduleImport({ batchId: "not-an-id" });
    expect(r.ok).toBe(false);
  });
});
