import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Announcement, policy and acknowledgment actions and queries, run as each of the six roles with the
// database mocked to throw. Forbidden roles are refused first; allowed roles pass authorize() and then trip
// the mock. What happens after authorization (who is expected, once-only, versions) is covered by the
// database-backed suite in tests/integration/announcements.test.ts.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/announcements/actions");
const queries = await import("@/modules/announcements/queries");
const notificationActions = await import("@/modules/notifications/actions");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];
const EVERYONE: RoleSlug[] = [...ROLE_SLUGS];

const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

const post = { title: "Holiday schedule", body: "Office closed on the 25th.", audience: "all", teamIds: [], pinned: false, requiresAck: true };
const actionCases: { name: string; call: () => Promise<{ ok: boolean; error?: string }>; allowed: RoleSlug[] }[] = [
  { name: "createAnnouncement", call: () => actions.createAnnouncement(post), allowed: HR },
  { name: "updateAnnouncement", call: () => actions.updateAnnouncement({ announcementId: ID, title: "Holiday schedule", body: "Updated", pinned: false }), allowed: HR },
  { name: "archiveAnnouncement", call: () => actions.archiveAnnouncement({ announcementId: ID }), allowed: HR },
  { name: "acknowledge (announcement)", call: () => actions.acknowledge({ kind: "announcement", id: ID }), allowed: EVERYONE },
  { name: "acknowledge (policy version)", call: () => actions.acknowledge({ kind: "policy_version", id: ID }), allowed: EVERYONE },
  { name: "sendReminder", call: () => actions.sendReminder({ kind: "announcement", id: ID }), allowed: HR },
  { name: "exportAcknowledgments", call: () => actions.exportAcknowledgments({ kind: "policy_version", id: ID }), allowed: HR },
  { name: "createPolicy", call: () => actions.createPolicy({ title: "Code of conduct", body: "Be kind.", requiresAck: true }), allowed: HR },
  { name: "saveDraft", call: () => actions.saveDraft({ policyId: ID, body: "Be kind.", requiresAck: true }), allowed: HR },
  { name: "discardDraft", call: () => actions.discardDraft({ policyId: ID }), allowed: HR },
  { name: "archivePolicy", call: () => actions.archivePolicy({ policyId: ID }), allowed: HR },
  { name: "publishDraft", call: () => actions.publishDraft({ policyId: ID }), allowed: HR },
  { name: "setDigestOptOut", call: () => notificationActions.setDigestOptOut({ optOut: true }), allowed: EVERYONE },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("announcement actions, every role", () => {
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

describe("announcement queries, every role", () => {
  const TEAM_VIEW: RoleSlug[] = ["super_admin", "hr_admin", "team_lead"];
  const queryCases: { name: string; call: () => Promise<unknown>; allowed: RoleSlug[] }[] = [
    { name: "listAnnouncements", call: () => queries.listAnnouncements(), allowed: EVERYONE },
    { name: "getAnnouncement", call: () => queries.getAnnouncement(ID), allowed: EVERYONE },
    { name: "listPolicies", call: () => queries.listPolicies(), allowed: EVERYONE },
    { name: "getPolicy", call: () => queries.getPolicy(ID), allowed: EVERYONE },
    { name: "listMyPending", call: () => queries.listMyPending(), allowed: EVERYONE },
    { name: "getAckStatus", call: () => queries.getAckStatus({ kind: "announcement", id: ID }), allowed: TEAM_VIEW },
    { name: "getComposeOptions", call: () => queries.getComposeOptions(), allowed: HR },
    { name: "getAnnouncementForEdit", call: () => queries.getAnnouncementForEdit(ID), allowed: HR },
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
