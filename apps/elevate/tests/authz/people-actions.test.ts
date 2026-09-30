import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Every HR-side people action and query, run as each of the six roles, with the database mocked
// to throw if touched: forbidden roles must be refused first; allowed roles pass authorize() and
// then trip the mock (a generic error). Self-service actions and the profile read look the record up
// before deciding, so the database-backed suite (tests/integration) covers those.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/people/actions");
const queries = await import("@/modules/people/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const person = { legalFirstName: "Maria", legalLastName: "Santos", workEmail: "maria@example.com" };

const actionCases: { name: string; call: () => Promise<{ ok: boolean; error?: string }>; allowed: RoleSlug[] }[] = [
  { name: "createEmployee", call: () => actions.createEmployee(person), allowed: HR },
  { name: "updateEmployee", call: () => actions.updateEmployee({ employeeId: ID, ...person }), allowed: HR },
  { name: "archiveEmployee", call: () => actions.archiveEmployee({ employeeId: ID }), allowed: HR },
  { name: "updateSensitive", call: () => actions.updateSensitive({ employeeId: ID, values: { tin: "123456789" } }), allowed: HR },
  { name: "reviewChangeRequest", call: () => actions.reviewChangeRequest({ requestId: ID, decision: "approve" }), allowed: HR },
  { name: "createClient", call: () => actions.createClient({ name: "Acme (fake)", timeZone: "America/Phoenix" }), allowed: HR },
  { name: "updateClient", call: () => actions.updateClient({ clientId: ID, name: "Acme (fake)", timeZone: "America/Phoenix" }), allowed: HR },
  { name: "assignClient", call: () => actions.assignClient({ employeeId: ID, clientId: OTHER, startDate: "2026-09-01" }), allowed: HR },
  { name: "endAssignment", call: () => actions.endAssignment({ assignmentId: ID, endDate: "2026-10-01" }), allowed: HR },
  { name: "createCustomFieldDef", call: () => actions.createCustomFieldDef({ key: "nickname", label: "Nickname", fieldType: "text" }), allowed: HR },
  { name: "archiveCustomFieldDef", call: () => actions.archiveCustomFieldDef({ fieldDefId: ID }), allowed: HR },
  { name: "setCustomFieldValues", call: () => actions.setCustomFieldValues({ employeeId: ID, values: { [OTHER]: "x" } }), allowed: HR },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("people actions, every role", () => {
  for (const c of actionCases) {
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

describe("people queries, every role", () => {
  const queryCases: { name: string; call: () => Promise<unknown>; allowed: RoleSlug[] }[] = [
    { name: "listDirectory", call: () => queries.listDirectory({}), allowed: [...ROLE_SLUGS] },
    { name: "listChangeRequests", call: () => queries.listChangeRequests(), allowed: HR },
    { name: "viewBankChangeRequest", call: () => queries.viewBankChangeRequest(ID), allowed: HR },
    { name: "listClients", call: () => queries.listClients(), allowed: HR },
    { name: "listClientsForFilter", call: () => queries.listClientsForFilter(), allowed: HR },
    { name: "listCustomFieldDefs", call: () => queries.listCustomFieldDefs(), allowed: HR },
  ];

  for (const q of queryCases) {
    describe(q.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = q.allowed.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const outcome = await q.call().then(
            () => "resolved",
            (e: unknown) => (e instanceof ForbiddenError ? "forbidden" : "other"),
          );
          expect(outcome).toBe(allowed ? "other" : "forbidden");
        });
      }
    });
  }
});
