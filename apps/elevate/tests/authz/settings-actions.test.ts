import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Runs every settings action and query as each of the six roles.
// The database and Supabase admin client are replaced with mocks that throw if touched, so:
//   - a forbidden role must get "no access" and never reach the database;
//   - an allowed role must get past authorize() (and then trips the throwing mock, which shows
//     up as a generic error, proving the guard let it through).

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: () => { throw new Error("database touched"); } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => { throw new Error("admin client touched"); },
}));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setUserRoles, setSafevoiceHandler, resetAuthenticator, createInvitation, revokeInvitation } = await import(
  "@/modules/settings/actions"
);
const { listPeopleWithRoles, listInvitations, listAuditEntries } = await import("@/modules/settings/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NO_ACCESS = "You do not have access to do that.";

const as = (role: RoleSlug) => {
  currentUser.value = { id: ID, email: "actor@example.com", roles: [role] };
};

type Case = {
  name: string;
  call: () => Promise<{ ok: boolean; error?: string }>;
  allowed: RoleSlug[];
};

const cases: Case[] = [
  { name: "setUserRoles", call: () => setUserRoles({ userId: OTHER, roles: ["team_lead"] }), allowed: ["super_admin"] },
  { name: "setSafevoiceHandler", call: () => setSafevoiceHandler({ userId: OTHER, enabled: true }), allowed: ["super_admin"] },
  { name: "resetAuthenticator", call: () => resetAuthenticator({ userId: OTHER }), allowed: ["super_admin"] },
  { name: "createInvitation", call: () => createInvitation({ email: "new@example.com" }), allowed: ["super_admin", "hr_admin"] },
  { name: "revokeInvitation", call: () => revokeInvitation({ invitationId: OTHER }), allowed: ["super_admin", "hr_admin"] },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("settings actions, every role", () => {
  for (const c of cases) {
    describe(c.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = c.allowed.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const result = await c.call();
          expect(result.ok).toBe(false); // the mocked database always fails the allowed path
          if (allowed) expect(result.error).not.toBe(NO_ACCESS);
          else expect(result.error).toBe(NO_ACCESS);
        });
      }
    });
  }
});

describe("settings queries, every role", () => {
  const queries: { name: string; call: () => Promise<unknown>; allowed: RoleSlug[] }[] = [
    { name: "listPeopleWithRoles", call: () => listPeopleWithRoles(), allowed: ["super_admin"] },
    { name: "listInvitations", call: () => listInvitations(), allowed: ["super_admin", "hr_admin"] },
    { name: "listAuditEntries", call: () => listAuditEntries({}), allowed: ["super_admin"] },
  ];

  for (const q of queries) {
    describe(q.name, () => {
      for (const role of ROLE_SLUGS) {
        const allowed = q.allowed.includes(role);
        it(`${role}: ${allowed ? "passes authorize()" : "is refused"}`, async () => {
          as(role);
          const outcome = await q.call().then(
            () => "resolved",
            (e: unknown) => (e instanceof ForbiddenError ? "forbidden" : "other"),
          );
          expect(outcome).toBe(allowed ? "other" : "forbidden"); // allowed roles then hit the throwing db mock
        });
      }
    });
  }
});
