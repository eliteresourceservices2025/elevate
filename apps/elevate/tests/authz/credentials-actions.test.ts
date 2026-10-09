import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Certificate actions and queries run as each of the six roles with the database mocked to throw: a role without access is refused
// before anything touches data. Who may see WHICH certificate (own, downline) is checked against real rows in
// tests/integration/credentials.test.ts.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/credentials/actions");
const queries = await import("@/modules/credentials/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const cases: { name: string; allowed: RoleSlug[]; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "addCredential", allowed: HR, call: () => actions.addCredential({ employeeId: ID, name: "HIPAA Awareness certificate", expiresOn: "2027-01-31" }) },
  { name: "removeCredential", allowed: HR, call: () => actions.removeCredential({ credentialId: ID }) },
  { name: "importCredentials", allowed: HR, call: () => actions.importCredentials({ csv: "Name\nx", nameContains: "HIPAA", commit: false }) },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("Certificate actions, every role", () => {
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

const VIEWERS: RoleSlug[] = ["super_admin", "hr_admin", "team_lead", "employee"];
const queryCases: { name: string; allowed: RoleSlug[]; call: () => Promise<unknown> }[] = [
  { name: "listCredentials", allowed: HR, call: () => queries.listCredentials({}, { page: 1, pageSize: 25 }) },
  { name: "credentialCounts", allowed: HR, call: () => queries.credentialCounts() },
  { name: "listCredentialPeople", allowed: HR, call: () => queries.listCredentialPeople() },
  { name: "getMyCredentials", allowed: VIEWERS, call: () => queries.getMyCredentials() },
  // The team list is only for a lead; HR reads the full list instead
  { name: "listTeamCredentials", allowed: ["team_lead"], call: () => queries.listTeamCredentials() },
];

describe("Certificate queries, every role", () => {
  for (const c of queryCases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = c.allowed.includes(role);
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
