import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Time off actions and queries, run as each of the six roles with the database mocked to throw. Forbidden roles
// are refused first; allowed roles pass authorize() and then trip the mock. What happens after authorization
// (ledger rules, expiry, scoping to a downline) is covered by tests/integration/timeoff.test.ts.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/timeoff/actions");
const queries = await import("@/modules/timeoff/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];
const EVERYONE: RoleSlug[] = [...ROLE_SLUGS];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const holiday = { calendar: "PH", date: "2026-12-25", name: "Christmas Day", kind: "regular", verified: true };

const actionCases: { name: string; call: () => Promise<{ ok: boolean; error?: string }>; allowed: RoleSlug[] }[] = [
  { name: "awardDays", call: () => actions.awardDays({ employeeId: ID, leaveTypeId: OTHER, days: 1, reason: "Trivia night winner" }), allowed: HR },
  { name: "adjustBalance", call: () => actions.adjustBalance({ employeeId: ID, leaveTypeId: OTHER, days: -1, reason: "Entered twice by mistake" }), allowed: HR },
  { name: "createLeaveType", call: () => actions.createLeaveType({ name: "Bonus day", tracksBalance: true }), allowed: HR },
  { name: "updateLeaveType", call: () => actions.updateLeaveType({ leaveTypeId: ID, name: "Bonus day" }), allowed: HR },
  { name: "archiveLeaveType", call: () => actions.archiveLeaveType({ leaveTypeId: ID }), allowed: HR },
  { name: "createHoliday", call: () => actions.createHoliday(holiday), allowed: HR },
  { name: "updateHoliday", call: () => actions.updateHoliday({ ...holiday, holidayId: ID }), allowed: HR },
  { name: "archiveHoliday", call: () => actions.archiveHoliday({ holidayId: ID }), allowed: HR },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("time off actions, every role", () => {
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

describe("time off queries, every role", () => {
  const queryCases: { name: string; call: () => Promise<unknown>; allowed: RoleSlug[] }[] = [
    // Own data comes from the base Employee role (everyone holds it); a Team Lead role alone has team scope only.
    { name: "getMyTimeOff", call: () => queries.getMyTimeOff(), allowed: ["super_admin", "hr_admin", "employee"] },
    { name: "getPersonTimeOff", call: () => queries.getPersonTimeOff(ID), allowed: ["super_admin", "hr_admin", "team_lead", "employee"] },
    { name: "listBalances", call: () => queries.listBalances(), allowed: ["super_admin", "hr_admin", "team_lead"] },
    { name: "getAwardOptions", call: () => queries.getAwardOptions(), allowed: HR },
    { name: "listLeaveTypes", call: () => queries.listLeaveTypes(), allowed: HR },
    { name: "getHolidays", call: () => queries.getHolidays(2026), allowed: EVERYONE },
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
