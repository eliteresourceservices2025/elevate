import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// The three access-request actions as each of the six roles and as a client guest, database mocked to throw: only an HR Admin or Super Admin may ask or
// withdraw, only a Super Admin may decide, bad input is refused before anything touches data, and nobody who is not signed in gets in.

const current = vi.hoisted(() => ({ value: null as unknown, fail: false }));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => {
    if (current.fail) throw new Error("not signed in");
    return current.value;
  }),
}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("@/modules/org/service", () => ({ todayInZone: () => "2026-11-19" }));

const actions = await import("@/modules/chat-access/actions");

const ID = "11111111-1111-4111-8111-111111111111";
const NO_ACCESS = "You do not have access to do that.";
const REASON = "A complaint about conduct in this chat.";
const as = (role: RoleSlug) => {
  current.fail = false;
  current.value = { id: "44444444-4444-4444-8444-444444444444", email: "actor@example.com", roles: [role] };
};
const asGuest = () => {
  current.fail = false;
  current.value = { id: "55555555-5555-4555-8555-555555555555", email: "guest@client.example", roles: [], isGuest: true };
};

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("who may use the access request actions", () => {
  const rows: { name: string; allowed: RoleSlug[]; run: () => Promise<{ ok: boolean; error?: string }> }[] = [
    { name: "requestChatAccess", allowed: ["hr_admin", "super_admin"], run: () => actions.requestChatAccess({ kind: "chat", conversationId: ID, from: "2026-11-01", to: "2026-11-05", reason: REASON }) },
    { name: "cancelChatAccess", allowed: ["hr_admin", "super_admin"], run: () => actions.cancelChatAccess({ requestId: ID }) },
    { name: "decideChatAccess", allowed: ["super_admin"], run: () => actions.decideChatAccess({ requestId: ID, approve: true }) },
  ];
  for (const { name, allowed, run } of rows) {
    for (const role of ROLE_SLUGS) {
      it(`${role}: ${allowed.includes(role) ? "may" : "may not"} ${name}`, async () => {
        as(role);
        const result = await run();
        if (allowed.includes(role)) expect(result.error).not.toBe(NO_ACCESS);
        else expect(result).toEqual({ ok: false, error: NO_ACCESS });
      });
    }
    it(`a client guest may not ${name}`, async () => {
      asGuest();
      expect(await run()).toEqual({ ok: false, error: NO_ACCESS });
    });
    it(`${name}: someone who is not signed in gets nothing`, async () => {
      current.fail = true;
      await expect(run()).rejects.toThrow("not signed in");
    });
  }
});

describe("input is checked before the database", () => {
  it("refuses a short reason, a bad date, a direct kind and a bad id", async () => {
    as("hr_admin");
    expect((await actions.requestChatAccess({ kind: "chat", conversationId: ID, from: "2026-11-01", to: "2026-11-05", reason: "short" })).ok).toBe(false);
    expect((await actions.requestChatAccess({ kind: "chat", conversationId: ID, from: "soon", to: "2026-11-05", reason: REASON })).ok).toBe(false);
    expect((await actions.requestChatAccess({ kind: "dm", conversationId: ID, reason: REASON })).ok).toBe(false);
    expect(await actions.cancelChatAccess({ requestId: "nope" })).toEqual({ ok: false, error: "Check the request and try again." });
    as("super_admin");
    expect(await actions.decideChatAccess({ requestId: ID })).toEqual({ ok: false, error: "Check the request and try again." });
    expect(await actions.decideChatAccess({ requestId: ID, approve: "yes" })).toEqual({ ok: false, error: "Check the request and try again." });
  });
});
