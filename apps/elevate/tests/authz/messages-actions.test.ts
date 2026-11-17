import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Messages actions as each of the six roles, database mocked to throw: every role may chat (membership is checked later, against the
// data), bad input is refused before anything touches data, and nobody unauthenticated gets in.

const currentUser = vi.hoisted(() => ({ value: null as unknown, fail: false }));
vi.mock("@/lib/auth", () => ({
  requireUser: vi.fn(async () => {
    if (currentUser.fail) throw new Error("not signed in");
    return currentUser.value;
  }),
}));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database touched"); } }) }));
vi.mock("@/modules/audit/write", () => ({ writeAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const actions = await import("@/modules/messages/actions");

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const NO_ACCESS = "You do not have access to do that.";
const BAD = "Check the request and try again.";
const as = (role: RoleSlug) => {
  currentUser.fail = false;
  currentUser.value = { id: "44444444-4444-4444-8444-444444444444", email: "actor@example.com", roles: [role] };
};

type Call = [name: string, run: () => Promise<{ ok: boolean; error?: string }>];
const valid: Call[] = [
  ["openDirectMessage", () => actions.openDirectMessage({ userId: ID })],
  ["createGroupConversation", () => actions.createGroupConversation({ title: "Crew", memberUserIds: [ID, ID2] })],
  ["sendChatMessage", () => actions.sendChatMessage({ conversationId: ID, body: "hello" })],
  ["editChatMessage", () => actions.editChatMessage({ messageId: ID, body: "edited" })],
  ["deleteChatMessage", () => actions.deleteChatMessage({ messageId: ID })],
  ["markConversationRead", () => actions.markConversationRead({ conversationId: ID, seq: 3 })],
  ["addGroupMembers", () => actions.addGroupMembers({ conversationId: ID, userIds: [ID2, ID3] })],
  ["leaveGroupConversation", () => actions.leaveGroupConversation({ conversationId: ID })],
  ["loadChatMessages", () => actions.loadChatMessages({ conversationId: ID })],
  ["loadConversationList", () => actions.loadConversationList()],
  ["searchPeopleForChat", () => actions.searchPeopleForChat({ q: "ana" })],
];
const badInput: Call[] = [
  ["openDirectMessage", () => actions.openDirectMessage({})],
  ["createGroupConversation", () => actions.createGroupConversation({})],
  ["sendChatMessage", () => actions.sendChatMessage({})],
  ["editChatMessage", () => actions.editChatMessage({})],
  ["deleteChatMessage", () => actions.deleteChatMessage({})],
  ["markConversationRead", () => actions.markConversationRead({})],
  ["addGroupMembers", () => actions.addGroupMembers({})],
  ["leaveGroupConversation", () => actions.leaveGroupConversation({})],
  ["loadChatMessages", () => actions.loadChatMessages({})],
  ["searchPeopleForChat", () => actions.searchPeopleForChat({ q: "x".repeat(61) })],
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("messages actions, every role", () => {
  for (const role of ROLE_SLUGS) {
    for (const [name, run] of valid) {
      it(`${role}: may ${name} (refused only later, by membership, not by role)`, async () => {
        as(role);
        const result = await run();
        expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
      });
    }
  }
});

describe("messages actions, input and sign-in", () => {
  for (const [name, run] of badInput) {
    it(`${name}: bad input is refused before the database`, async () => {
      as("employee");
      expect(await run()).toEqual({ ok: false, error: BAD });
    });
  }
  for (const [name, run] of valid) {
    it(`${name}: someone who is not signed in gets nothing`, async () => {
      currentUser.fail = true;
      await expect(run()).rejects.toThrow("not signed in");
    });
  }
});
