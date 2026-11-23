import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Adding, renaming and archiving a client's projects is the same right as managing clients: HR Admin and Super Admin only.
// The database is replaced with a mock that throws if touched, so a forbidden role must be refused before it, and an allowed role
// gets past authorize() (then trips the mock, which shows up as a generic error).

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createClientProject, renameClientProject, archiveClientProject, setClientProjectPeople, setClientNoProjectAllowed } = await import("@/modules/people/actions");

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NO_ACCESS = "You do not have access to do that.";
const ALLOWED: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: ID, email: "actor@example.com", roles: [role] };
};

const cases: { name: string; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "createClientProject", call: () => createClientProject({ clientId: OTHER, name: "Intake" }) },
  { name: "renameClientProject", call: () => renameClientProject({ projectId: OTHER, name: "Billing" }) },
  { name: "archiveClientProject", call: () => archiveClientProject({ projectId: OTHER }) },
  { name: "setClientNoProjectAllowed", call: () => setClientNoProjectAllowed({ clientId: OTHER, allowed: false }) },
  { name: "setClientProjectPeople", call: () => setClientProjectPeople({ projectId: OTHER, employeeIds: [ID] }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("client project actions, every role", () => {
  for (const c of cases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = ALLOWED.includes(role);
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

describe.each([["listClientProjectsForAdmin"], ["listClientProjectPeopleForAdmin"]] as const)("%s, every role", (fn) => {
  for (const role of ROLE_SLUGS) {
    const allowed = ALLOWED.includes(role);
    it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
      as(role);
      const queries = await import("@/modules/people/queries");
      const outcome = await queries[fn]().then(
        () => "resolved",
        (e: unknown) => (e instanceof ForbiddenError ? "forbidden" : "other"),
      );
      expect(outcome).toBe(allowed ? "other" : "forbidden");
    });
  }
});

describe("client project input", () => {
  it("refuses a bad project id or more than 200 people before touching anything", async () => {
    as("hr_admin");
    expect((await setClientProjectPeople({ projectId: "nope", employeeIds: [] })).ok).toBe(false);
    expect((await setClientProjectPeople({ projectId: OTHER, employeeIds: Array.from({ length: 201 }, () => ID) })).ok).toBe(false);
  });

  it("refuses a blank name and a bad id before touching anything", async () => {
    as("hr_admin");
    expect((await createClientProject({ clientId: OTHER, name: "   " })).ok).toBe(false);
    expect((await createClientProject({ clientId: "nope", name: "Intake" })).ok).toBe(false);
    expect((await renameClientProject({ projectId: OTHER, name: "" })).ok).toBe(false);
  });
});
