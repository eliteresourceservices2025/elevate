import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Time clock actions and queries run as each of the six roles with the database mocked to throw. Forbidden roles are
// refused first; allowed roles pass authorize() and then trip the mock. What happens after (state rules, corrections,
// scoping to a downline) is covered by tests/integration/attendance.test.ts.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const actions = await import("@/modules/attendance/actions");
const peopleActions = await import("@/modules/people/actions");
const queries = await import("@/modules/attendance/queries");
const scheduleActions = await import("@/modules/attendance/schedule-actions");
const extraActions = await import("@/modules/attendance/extra-hours-actions");
const extraQueries = await import("@/modules/attendance/extra-hours-queries");
const hoursActions = await import("@/modules/attendance/hours-actions");
const hoursQueries = await import("@/modules/attendance/hours-queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];
const EVERYONE: RoleSlug[] = [...ROLE_SLUGS];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const correction = { reason: "Forgot to clock out", events: [{ type: "clock_out", at: new Date(Date.now() - 3_600_000).toISOString() }] };
const claim = { employeeId: ID, reason: "Device died", events: [{ type: "clock_out", at: new Date(Date.now() - 3_600_000).toISOString() }] };
const TEAM_OR_HR: RoleSlug[] = ["super_admin", "hr_admin", "team_lead"];
const rules = { teamId: ID, allowedCidrs: ["203.0.113.0/24"], selfieRequired: false, idleMinutes: 30, graceMinutes: 60 };

const actionCases: { name: string; call: () => Promise<{ ok: boolean; error?: string }>; allowed: RoleSlug[] }[] = [
  { name: "clockIn", call: () => actions.clockIn({}), allowed: EVERYONE },
  { name: "startBreak", call: () => actions.startBreak(), allowed: EVERYONE },
  { name: "startBreak (30 minutes)", call: () => actions.startBreak({ breakMinutes: 30 }), allowed: EVERYONE },
  { name: "createMyProfile", call: () => peopleActions.createMyProfile({ firstName: "Olivia", lastName: "Owner" }), allowed: HR },
  { name: "endBreak", call: () => actions.endBreak(), allowed: EVERYONE },
  { name: "clockOut", call: () => actions.clockOut(), allowed: EVERYONE },
  { name: "requestClockSelfie", call: () => actions.requestClockSelfie(), allowed: EVERYONE },
  { name: "savePreferences", call: () => actions.savePreferences({ shareLocation: false }), allowed: EVERYONE },
  { name: "reportIdlePrompt", call: () => actions.reportIdlePrompt({ source: "fallback" }), allowed: EVERYONE },
  { name: "answerIdlePrompt", call: () => actions.answerIdlePrompt({ promptId: ID }), allowed: EVERYONE },
  { name: "requestCorrection", call: () => actions.requestCorrection(correction), allowed: EVERYONE },
  { name: "cancelCorrection", call: () => actions.cancelCorrection({ correctionId: ID }), allowed: EVERYONE },
  { name: "pingPresence", call: () => actions.pingPresence(), allowed: EVERYONE },
  { name: "requestEvidenceUpload", call: () => actions.requestEvidenceUpload({ mime: "image/png", size: 1000 }), allowed: EVERYONE },
  { name: "saveShiftNote", call: () => actions.saveShiftNote({ sessionId: ID, body: "Finished the inbox." }), allowed: EVERYONE },
  { name: "fileCorrectionForOthers", call: () => actions.fileCorrectionForOthers(claim), allowed: TEAM_OR_HR },
  { name: "assignSchedule", call: () => scheduleActions.assignSchedule({ employeeIds: [ID], effectiveFrom: "2026-10-01", startTime: "09:00", endTime: "17:00", weekdays: [1, 2, 3, 4, 5], breakMinutes: 60 }), allowed: HR },
  { name: "endSchedule", call: () => scheduleActions.endSchedule({ employeeId: ID, endDate: "2026-10-01" }), allowed: HR },
  { name: "requestExtraEvidenceUpload", call: () => extraActions.requestExtraEvidenceUpload({ mime: "image/png", size: 1000 }), allowed: EVERYONE },
  { name: "requestExtraHours", call: () => extraActions.requestExtraHours({ clientId: ID, windowStart: "2026-10-01T10:00:00Z", windowEnd: "2026-10-01T12:00:00Z", contactName: "Dana", reason: "Client needs it", evidenceIds: [ID] }), allowed: EVERYONE },
  { name: "answerExtraHours", call: () => extraActions.answerExtraHours({ requestId: ID, answer: "confirm" }), allowed: EVERYONE },
  { name: "fileExtraHoursFor", call: () => extraActions.fileExtraHoursFor({ employeeId: ID, clientId: ID, windowStart: "2026-10-01T10:00:00Z", windowEnd: "2026-10-01T12:00:00Z", contactName: "Pat", reason: "Client asked", confirmedByPhone: true }), allowed: TEAM_OR_HR },
  { name: "approveHoursWeek", call: () => hoursActions.approveHoursWeek({ employeeId: ID, weekStart: "2026-09-28" }), allowed: TEAM_OR_HR },
  { name: "approveCleanWeeks", call: () => hoursActions.approveCleanWeeks({ weekStart: "2026-09-28" }), allowed: TEAM_OR_HR },
  { name: "savePayPeriod", call: () => hoursActions.savePayPeriod({ kind: "weekly" }), allowed: HR },
  { name: "exportHours", call: () => hoursActions.exportHours({ periodStart: "2026-10-01", kind: "daily", includeUnapproved: false }), allowed: HR },
  { name: "saveClockRules", call: () => actions.saveClockRules(rules), allowed: HR },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("time clock actions, every role", () => {
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

describe("time clock queries, every role", () => {
  // Own data comes from the base Employee role (everyone holds it); a Team Lead role alone has team scope only.
  const OWN: RoleSlug[] = ["super_admin", "hr_admin", "employee"];
  const TEAM_VIEW: RoleSlug[] = ["super_admin", "hr_admin", "team_lead"];
  const queryCases: { name: string; call: () => Promise<unknown>; allowed: RoleSlug[] }[] = [
    { name: "getClockStatus", call: () => queries.getClockStatus(), allowed: EVERYONE },
    { name: "getMyTime", call: () => queries.getMyTime(), allowed: OWN },
    { name: "listWorkingNow", call: () => queries.listWorkingNow(), allowed: TEAM_VIEW },
    { name: "listFlags", call: () => queries.listFlags(), allowed: TEAM_VIEW },
    { name: "listCorrectionQueue", call: () => queries.listCorrectionQueue(), allowed: TEAM_VIEW },
    { name: "listClockRules", call: () => queries.listClockRules(), allowed: HR },
    { name: "listFilablePeople", call: () => queries.listFilablePeople(), allowed: TEAM_VIEW },
    { name: "listShiftNotes", call: () => queries.listShiftNotes(), allowed: TEAM_VIEW },
    { name: "listSchedules", call: () => queries.listSchedules(), allowed: HR },
    { name: "getMyExtraHours", call: () => extraQueries.getMyExtraHours(), allowed: EVERYONE },
    { name: "listExtraHoursQueue", call: () => extraQueries.listExtraHoursQueue(), allowed: TEAM_VIEW },
    { name: "listActiveClients", call: () => extraQueries.listActiveClients(), allowed: TEAM_VIEW },
    { name: "getTeamReview", call: () => hoursQueries.getTeamReview(), allowed: TEAM_VIEW },
    { name: "getHoursSettings", call: () => hoursQueries.getHoursSettings(), allowed: HR },
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
