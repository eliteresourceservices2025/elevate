import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// The dashboard and the header search are open to every role: what they show is narrowed source by source by the owning
// module. Each role runs with the database mocked to throw, so "passes authorize()" means it reached the data and nobody is refused.

const currentUser = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => currentUser.value) }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));

const actions = await import("@/modules/dashboard/search-actions");
const queries = await import("@/modules/dashboard/queries");

const NO_ACCESS = "You do not have access to do that.";
const as = (role: RoleSlug) => {
  currentUser.value = { id: "33333333-3333-4333-8333-333333333333", email: "actor@example.com", roles: [role] };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("searchEverything, every role", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: passes authorize() and is never refused`, async () => {
      as(role);
      const result = await actions.searchEverything({ q: "maria" });
      expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
    });
  }
  it("a too-short or malformed query returns nothing without touching data", async () => {
    as("employee");
    expect(await actions.searchEverything({ q: "a" })).toEqual({ ok: true, data: [] });
    expect((await actions.searchEverything({ q: 42 })).ok).toBe(false);
    expect((await actions.searchEverything("maria")).ok).toBe(false);
  });
});

describe("dashboard queries, every role", () => {
  for (const role of ROLE_SLUGS) {
    it(`${role}: getGreeting and getKpis pass authorize()`, async () => {
      as(role);
      await expect(queries.getGreeting()).rejects.not.toBeInstanceOf(ForbiddenError);
      // The numbers hide themselves for a role with no access (they may resolve to nothing), so only a refusal would be wrong.
      await expect(queries.getKpis("my_work").catch((e: unknown) => e)).resolves.not.toBeInstanceOf(ForbiddenError);
    });
  }
});

describe("the other dashboard panels, every role", () => {
  // None of these may ever answer a role with a refusal: a panel the person has no access to simply comes back empty.
  for (const role of ROLE_SLUGS) {
    it(`${role}: approvals, attention, who is out, risks, tracker and workforce pass authorize()`, async () => {
      as(role);
      const feed = await import("@/modules/dashboard/feed-queries");
      const panels = await import("@/modules/dashboard/panel-queries");
      const calls: Promise<unknown>[] = [feed.getApprovalQueue(), feed.getAttention("my_work"), feed.getWhosOut(), panels.getRisks("hr"), panels.getTracker(), panels.getWorkforce()];
      for (const call of calls) await expect(call.catch((e: unknown) => e)).resolves.not.toBeInstanceOf(ForbiddenError);
    });
  }
});
