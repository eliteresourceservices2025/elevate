import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Runs every ELEVATE Tracker action and query as each of the six roles, with a database that throws if touched:
// a forbidden role must be refused before the database; an allowed role gets past authorize() and then trips the mock.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => { throw new Error("admin client touched"); } }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/activity/actions");
const shotActions = await import("@/modules/activity/shot-actions");
const queries = await import("@/modules/activity/queries");
const releaseActions = await import("@/modules/activity/release-actions");
const releaseQueries = await import("@/modules/activity/release-queries");

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NO_ACCESS = "You do not have access to do that.";
const ALL: RoleSlug[] = ["super_admin", "hr_admin", "team_lead", "recruiter", "executive", "employee"];

const as = (role: RoleSlug) => {
  currentUser.value = { id: ID, email: "actor@example.com", roles: [role] };
};

type ActionCase = { name: string; call: () => Promise<{ ok: boolean; error?: string }>; allowed: RoleSlug[] };

const actionCases: ActionCase[] = [
  { name: "createEnrollmentCode", call: () => actions.createEnrollmentCode(), allowed: ALL },
  { name: "revokeDevice", call: () => actions.revokeDevice({ deviceId: OTHER }), allowed: ALL },
  { name: "saveCategory", call: () => actions.saveCategory({ pattern: "^zoom$", category: "work", rank: 10 }), allowed: ["super_admin", "hr_admin"] },
  { name: "saveActivitySettings", call: () => actions.saveActivitySettings({ idleTimeoutSeconds: 180, offlineGraceMinutes: 5, lowActivityPercent: 30 }), allowed: ["super_admin", "hr_admin"] },
  { name: "archiveCategory", call: () => actions.archiveCategory({ id: OTHER }), allowed: ["super_admin", "hr_admin"] },
  { name: "createRelease", call: () => releaseActions.createRelease({ version: "1.0.0", added: "x", improved: "", fixed: "", minRequired: false, addsCollection: false, policyVersionId: null }), allowed: ["super_admin", "hr_admin"] },
  { name: "publishRelease", call: () => releaseActions.publishRelease({ id: OTHER }), allowed: ["super_admin", "hr_admin"] },
  { name: "withdrawRelease", call: () => releaseActions.withdrawRelease({ id: OTHER }), allowed: ["super_admin", "hr_admin"] },
  { name: "deleteDraftRelease", call: () => releaseActions.deleteDraftRelease({ id: OTHER }), allowed: ["super_admin", "hr_admin"] },
  // Anyone may open their own screenshots, so every role reaches the lookup; others' screenshots are checked in tests/integration/activity-access.test.ts.
  { name: "viewShot", call: () => shotActions.viewShot({ shotId: OTHER, reason: "coaching" }), allowed: ALL },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("tracker actions, every role", () => {
  for (const c of actionCases) {
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

describe("tracker queries, every role", () => {
  const cases: { name: string; call: () => Promise<unknown>; allowed: RoleSlug[] }[] = [
    { name: "getMyDay", call: () => queries.getMyDay({ date: "2026-11-10" }), allowed: ALL },
    { name: "getPersonDay", call: () => queries.getPersonDay({ employeeId: OTHER, date: "2026-11-10" }), allowed: ["super_admin", "hr_admin", "team_lead", "employee"] },
    { name: "listFloor", call: () => queries.listFloor({}), allowed: ["super_admin", "hr_admin", "team_lead"] },
    { name: "getActivitySettings", call: () => queries.getActivitySettings(), allowed: ["super_admin", "hr_admin"] },
    { name: "listAllDevices", call: () => queries.listAllDevices({ filter: "all", page: 1, pageSize: 25 }), allowed: ["super_admin", "hr_admin"] },
    { name: "getReleaseAdminView", call: () => releaseQueries.getReleaseAdminView(), allowed: ["super_admin", "hr_admin"] },
    { name: "listReleasesAdmin", call: () => releaseQueries.listReleasesAdmin(), allowed: ["super_admin", "hr_admin"] },
    { name: "listCategories", call: () => queries.listCategories(), allowed: ["super_admin", "hr_admin"] },
    { name: "listDevices (everyone's)", call: () => queries.listDevices({ employeeId: OTHER }), allowed: ["super_admin", "hr_admin"] },
    { name: "listDevices (own)", call: () => queries.listDevices({}), allowed: ALL },
  ];
  for (const q of cases) {
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

