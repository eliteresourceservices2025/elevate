import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// The course studio's actions and queries as each of the six roles (and the Privacy Officer flag), database mocked to throw: a
// person without access is refused before anything touches data.

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

const actions = await import("@/modules/learn/studio-actions");
const queries = await import("@/modules/learn/studio-queries");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const HR: RoleSlug[] = ["super_admin", "hr_admin"];
const as = (role: RoleSlug, isPrivacyOfficer = false) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role], isPrivacyOfficer };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

const calls: { name: string; call: () => Promise<{ ok: boolean; error?: string }> }[] = [
  { name: "createStudioDraft", call: () => actions.createStudioDraft({ course: "hipaa", note: "A change for review" }) },
  { name: "saveStudioCourseMeta", call: () => actions.saveStudioCourseMeta({ versionId: ID, stamp: 0, title: "A title", attestationVersion: "v2", attestationText: "x".repeat(60) }) },
  { name: "saveStudioModuleMeta", call: () => actions.saveStudioModuleMeta({ versionId: ID, stamp: 0, moduleKey: "foundations", title: "T", summary: "A summary text", estimatedMinutes: 10, tracks: ["full"], keyPoints: ["one", "two", "three"] }) },
  { name: "saveStudioQuestion", call: () => actions.saveStudioQuestion({ versionId: ID, stamp: 0, questionId: ID, topic: "Topic", stem: "A question long enough to pass?", options: [{ id: "a", text: "x" }, { id: "b", text: "y" }], correctIds: ["a"], rationale: "Because this is the reason." }) },
  { name: "addStudioModule", call: () => actions.addStudioModule({ versionId: "11111111-1111-4111-8111-111111111111", stamp: 0, title: "New module", estimatedMinutes: 5, tracks: ["full"] }) },
  { name: "removeStudioModule", call: () => actions.removeStudioModule({ versionId: "11111111-1111-4111-8111-111111111111", stamp: 0, moduleKey: "foundations" }) },
  { name: "moveStudioModule", call: () => actions.moveStudioModule({ versionId: "11111111-1111-4111-8111-111111111111", stamp: 0, moduleKey: "foundations", direction: "down" }) },
  { name: "addStudioScreen", call: () => actions.addStudioScreen({ versionId: "11111111-1111-4111-8111-111111111111", stamp: 0, moduleKey: "foundations", title: "New screen" }) },
  { name: "removeStudioScreen", call: () => actions.removeStudioScreen({ versionId: "11111111-1111-4111-8111-111111111111", stamp: 0, moduleKey: "foundations", screenId: "intro" }) },
  { name: "moveStudioScreen", call: () => actions.moveStudioScreen({ versionId: "11111111-1111-4111-8111-111111111111", stamp: 0, moduleKey: "foundations", screenId: "intro", direction: "up" }) },
  { name: "addStudioQuestion", call: () => actions.addStudioQuestion({ versionId: "11111111-1111-4111-8111-111111111111", stamp: 0, moduleKey: "foundations", type: "single" }) },
  { name: "removeStudioQuestion", call: () => actions.removeStudioQuestion({ versionId: "11111111-1111-4111-8111-111111111111", stamp: 0, questionId: "11111111-1111-4111-8111-111111111111" }) },
  { name: "saveStudioExamRules", call: () => actions.saveStudioExamRules({ versionId: "11111111-1111-4111-8111-111111111111", stamp: 0, passPercent: 80, maxTries: 3, waitMinutesAfterFail: 60, renewalMonths: 12, tracks: { full: 15 } }) },
  { name: "discardStudioDraft", call: () => actions.discardStudioDraft({ versionId: ID, stamp: 0 }) },
  { name: "publishStudioDraft", call: () => actions.publishStudioDraft({ versionId: ID, reviewerEmail: "rev@example.com", counselApprovedOn: "2026-10-13", material: false }) },
];

describe("course studio actions, every role", () => {
  for (const role of ROLE_SLUGS) {
    const allowed = HR.includes(role);
    for (const c of calls) {
      it(`${role}: ${allowed ? "may" : "is refused"} ${c.name}`, async () => {
        as(role);
        const result = await c.call();
        if (allowed) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
        else expect(result).toEqual({ ok: false, error: NO_ACCESS });
      });
    }
    it(`${role}: ${allowed ? "may read the studio" : "cannot read the studio"}`, async () => {
      as(role);
      const out = await queries.getStudioCourses().catch((e: unknown) => e);
      if (allowed) expect(out).not.toMatchObject({ name: "ForbiddenError" });
      else expect(out).toMatchObject({ name: "ForbiddenError" });
    });
  }

  it("the Privacy Officer flag opens the studio for an employee", async () => {
    as("employee", true);
    const out = await queries.getStudioCourses().catch((e: unknown) => e);
    expect(out).not.toMatchObject({ name: "ForbiddenError" });
    expect((await actions.createStudioDraft({ course: "hipaa", note: "A change for review" })).ok === false).toBe(true);
    const r = await actions.createStudioDraft({ course: "hipaa", note: "A change for review" });
    expect(r.ok === false && r.error).not.toBe(NO_ACCESS);
  });

  it("an employee without the flag is refused", async () => {
    as("employee", false);
    await expect(queries.getStudioCourses()).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});
