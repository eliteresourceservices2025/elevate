import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Every organization action and query, run as each of the six roles, with the database mocked to
// throw if touched: forbidden roles must be refused first; allowed roles pass authorize() and then
// trip the mock (a generic error).

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/org/actions");
const queries = await import("@/modules/org/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];
const today = new Date().toISOString().slice(0, 10);

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const actionCases: { name: string; call: () => Promise<{ ok: boolean; error?: string }>; allowed: RoleSlug[] }[] = [
  { name: "createDepartment", call: () => actions.createDepartment({ name: "Operations" }), allowed: HR },
  { name: "updateDepartment", call: () => actions.updateDepartment({ departmentId: ID, name: "Operations" }), allowed: HR },
  { name: "archiveDepartment", call: () => actions.archiveDepartment({ departmentId: ID }), allowed: HR },
  { name: "createTeam", call: () => actions.createTeam({ name: "Team Nine", departmentId: ID }), allowed: HR },
  { name: "updateTeam", call: () => actions.updateTeam({ teamId: ID, name: "Team Nine", departmentId: OTHER }), allowed: HR },
  { name: "archiveTeam", call: () => actions.archiveTeam({ teamId: ID }), allowed: HR },
  { name: "createPosition", call: () => actions.createPosition({ title: "Analyst" }), allowed: HR },
  { name: "updatePosition", call: () => actions.updatePosition({ positionId: ID, title: "Analyst" }), allowed: HR },
  { name: "archivePosition", call: () => actions.archivePosition({ positionId: ID }), allowed: HR },
  { name: "setReporting", call: () => actions.setReporting({ employeeId: ID, managerId: OTHER, effectiveDate: today }), allowed: HR },
  { name: "reassignReports", call: () => actions.reassignReports({ fromManagerId: ID, toManagerId: OTHER, effectiveDate: today }), allowed: HR },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("org actions, every role", () => {
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

describe("org queries, every role", () => {
  const queryCases: { name: string; call: () => Promise<unknown>; allowed: RoleSlug[] }[] = [
    { name: "listStructure", call: () => queries.listStructure(), allowed: HR },
    { name: "listOrgOptions", call: () => queries.listOrgOptions(), allowed: HR },
    { name: "getOrgChart", call: () => queries.getOrgChart(), allowed: [...ROLE_SLUGS] },
    { name: "listTeamFilterOptions", call: () => queries.listTeamFilterOptions(), allowed: [...ROLE_SLUGS] },
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
