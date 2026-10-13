import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Privacy incident actions and queries as each of the six roles, database mocked to throw: a person without access is refused
// before anything touches data. The Privacy Officer flag is checked with and without the flag.

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
vi.mock("@/lib/rate-limit", () => ({ allowRequest: vi.fn(async () => true) }));

const actions = await import("@/modules/incidents/actions");
const queries = await import("@/modules/incidents/queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];
const as = (role: RoleSlug, isPrivacyOfficer = false) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role], isPrivacyOfficer };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("incident actions, every role", () => {
  for (const role of ROLE_SLUGS) {
    const handler = HR.includes(role);
    it(`${role}: may report`, async () => {
      as(role);
      const result = await actions.reportIncident({ kind: "other", happenedOn: "2026-10-01", howFound: "I noticed it", whatHappened: "A short description here." });
      expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
    });
    it(`${role}: ${handler ? "may change a status" : "is refused changing a status"}`, async () => {
      as(role);
      const result = await actions.setIncidentStatus({ id: ID, status: "in_review" });
      if (handler) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result).toEqual({ ok: false, error: NO_ACCESS });
    });
    it(`${role}: ${handler ? "may name a Privacy Officer" : "is refused naming a Privacy Officer"}`, async () => {
      as(role);
      const result = await actions.setPrivacyOfficer({ email: "someone@example.com", enabled: true });
      if (handler) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      else expect(result).toEqual({ ok: false, error: NO_ACCESS });
    });
    it(`${role}: ${handler ? "may read the inbox" : "cannot read the inbox"}`, async () => {
      as(role);
      const call = queries.listIncidentInbox({ page: 1, pageSize: 25 }).catch((e: unknown) => e);
      if (handler) await expect(call).resolves.not.toMatchObject({ name: "ForbiddenError" });
      else await expect(call).resolves.toMatchObject({ name: "ForbiddenError" });
    });
    it(`${role}: ${handler ? "may list Privacy Officers" : "cannot list Privacy Officers"}`, async () => {
      as(role);
      const call = queries.listPrivacyOfficers().catch((e: unknown) => e);
      if (handler) await expect(call).resolves.not.toMatchObject({ name: "ForbiddenError" });
      else await expect(call).resolves.toMatchObject({ name: "ForbiddenError" });
    });
  }

  it("the Privacy Officer flag opens the inbox and statuses but not designation", async () => {
    as("employee", true);
    await expect(queries.listIncidentInbox({ page: 1, pageSize: 25 }).catch((e: unknown) => e)).resolves.not.toMatchObject({ name: "ForbiddenError" });
    const status = await actions.setIncidentStatus({ id: ID, status: "in_review" });
    expect(status.ok === false && status.error).not.toBe(NO_ACCESS);
    expect(await actions.setPrivacyOfficer({ email: "x@example.com", enabled: true })).toEqual({ ok: false, error: NO_ACCESS });
  });

  it("without the flag an employee is refused the inbox", async () => {
    as("employee", false);
    await expect(queries.listIncidentInbox({ page: 1, pageSize: 25 })).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});
