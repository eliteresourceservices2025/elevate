import { beforeEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS, can, type ActionName } from "@/lib/authz";
import { ROLE_SLUGS } from "@/lib/roles";

// A client guest has no roles at all. They may use Messages (their own conversations) and nothing else: every other action in the
// permission registry is closed to them, and requireUser() turns a guest away from any page or action that has not opted in.

const GUEST = { id: "44444444-4444-4444-8444-444444444444", roles: [], isGuest: true } as const;

describe("a guest in the permission registry", () => {
  const names = Object.keys(PERMISSIONS) as ActionName[];

  it("the registry is not empty (so the loop below proves something)", () => {
    expect(names.length).toBeGreaterThan(100);
  });

  it("may only use Messages: own scope on messages.use, nothing else at all", () => {
    const allowed = names.filter((name) => can(GUEST, name, { ownerUserId: GUEST.id, managerChainUserIds: [GUEST.id] }));
    expect(allowed).toEqual(["messages.use"]);
  });

  it("gets nothing on messages.use for someone else's resource", () => {
    expect(can(GUEST, "messages.use", { ownerUserId: "someone-else" })).toBe(false);
  });

  it("cannot invite guests, make or manage groups, or anything else even with an `all` request", () => {
    for (const name of ["messages.invite_guests", "messages.create_group", "messages.manage_group"] as const) expect(can(GUEST, name)).toBe(false);
  });

  it("the guest flag alone grants nothing without isGuest, and no role gets messages.invite_guests except HR and Super Admin", () => {
    expect(can({ id: "x", roles: [] }, "messages.use", { ownerUserId: "x" })).toBe(false);
    const holders = ROLE_SLUGS.filter((role) => can({ id: "x", roles: [role] }, "messages.invite_guests"));
    expect(holders.sort()).toEqual(["hr_admin", "super_admin"]);
  });
});

// requireUser itself, with the sign-in service and the account set-up mocked.
const state = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: <T>(fn: T) => fn }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "44444444-4444-4444-8444-444444444444", email: "g@client.example", email_confirmed_at: "2026-01-01" } }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" } }) },
      signOut: async () => undefined,
    },
  }),
}));
vi.mock("@/modules/core/users", () => ({ ensureCoreUser: async () => state.user }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const base = { id: "44444444-4444-4444-8444-444444444444", email: "g@client.example", archivedAt: null, isSafevoiceHandler: false, payrollAccess: null, isPrivacyOfficer: false };

describe("requireUser and guests", () => {
  beforeEach(() => {
    state.user = null;
  });

  it("sends a guest to Messages unless the caller opts in", async () => {
    state.user = { ...base, isGuest: true, roles: [] };
    const { requireUser } = await import("@/lib/auth");
    await expect(requireUser()).rejects.toThrow("REDIRECT:/messages");
    await expect(requireUser({})).rejects.toThrow("REDIRECT:/messages");
    const opted = await requireUser({ allowGuest: true });
    expect(opted.isGuest).toBe(true);
    expect(opted.roles).toEqual([]);
  });

  it("does not change anything for staff", async () => {
    state.user = { ...base, isGuest: false, roles: ["employee"] };
    const { requireUser } = await import("@/lib/auth");
    const user = await requireUser();
    expect(user.roles).toEqual(["employee"]);
    expect((await requireUser({ allowGuest: true })).isGuest).toBe(false);
  });
});
