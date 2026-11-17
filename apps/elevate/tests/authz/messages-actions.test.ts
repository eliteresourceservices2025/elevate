import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLE_SLUGS, type RoleSlug } from "@/lib/roles";

// Messages actions as each of the six roles, database mocked to throw: everyone may chat (membership is checked later, against the data),
// but only HR Admin and Super Admin may create, rename, change the people of, or delete a group. Bad input is refused before anything
// touches data, and nobody unauthenticated gets in.

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
const ADMINS: RoleSlug[] = ["super_admin", "hr_admin"];
const as = (role: RoleSlug) => {
  currentUser.fail = false;
  currentUser.value = { id: "44444444-4444-4444-8444-444444444444", email: "actor@example.com", roles: [role] };
};

type Call = { name: string; run: () => Promise<{ ok: boolean; error?: string }>; adminOnly: boolean };
const valid: Call[] = [
  { name: "openDirectMessage", run: () => actions.openDirectMessage({ userId: ID }), adminOnly: false },
  { name: "sendChatMessage", run: () => actions.sendChatMessage({ conversationId: ID, body: "hello" }), adminOnly: false },
  { name: "editChatMessage", run: () => actions.editChatMessage({ messageId: ID, body: "edited" }), adminOnly: false },
  { name: "deleteChatMessage", run: () => actions.deleteChatMessage({ messageId: ID }), adminOnly: false },
  { name: "markConversationRead", run: () => actions.markConversationRead({ conversationId: ID, seq: 3 }), adminOnly: false },
  { name: "loadChatMessages", run: () => actions.loadChatMessages({ conversationId: ID }), adminOnly: false },
  { name: "loadConversationList", run: () => actions.loadConversationList(), adminOnly: false },
  { name: "searchPeopleForChat", run: () => actions.searchPeopleForChat({ q: "ana" }), adminOnly: false },
  { name: "toggleChatReaction", run: () => actions.toggleChatReaction({ messageId: ID, emoji: "👍" }), adminOnly: false },
  { name: "createChatPoll", run: () => actions.createChatPoll({ conversationId: ID, question: "Lunch?", options: ["Pizza", "Noodles"], multiple: false, anonymous: false }), adminOnly: false },
  { name: "voteChatPoll", run: () => actions.voteChatPoll({ messageId: ID, optionId: ID2 }), adminOnly: false },
  { name: "requestChatUpload", run: () => actions.requestChatUpload({ conversationId: ID, fileName: "plan.pdf", size: 100, mime: "application/pdf", kind: "file" }), adminOnly: false },
  { name: "finalizeChatUpload", run: () => actions.finalizeChatUpload({ attachmentId: ID }), adminOnly: false },
  { name: "searchChatMessages", run: () => actions.searchChatMessages({ q: "schedule" }), adminOnly: false },
  { name: "muteChatConversation", run: () => actions.muteChatConversation({ conversationId: ID, until: "8h" }), adminOnly: false },
  { name: "getMyChatSettings", run: () => actions.getMyChatSettings(), adminOnly: false },
  { name: "saveMyChatSettings", run: () => actions.saveMyChatSettings({ appearOffline: false, emailDigest: true }), adminOnly: false },
  { name: "pinChatMessage", run: () => actions.pinChatMessage({ messageId: ID }), adminOnly: false },
  { name: "unpinChatMessage", run: () => actions.unpinChatMessage({ messageId: ID }), adminOnly: false },
  { name: "loadChatThread", run: () => actions.loadChatThread({ conversationId: ID, rootId: ID2 }), adminOnly: false },
  { name: "listChatPins", run: () => actions.listChatPins({ conversationId: ID }), adminOnly: false },
  { name: "createGroupConversation", run: () => actions.createGroupConversation({ title: "Crew", memberUserIds: [ID, ID2] }), adminOnly: true },
  { name: "addGroupMembers", run: () => actions.addGroupMembers({ conversationId: ID, userIds: [ID2, ID3] }), adminOnly: true },
  { name: "removeGroupMember", run: () => actions.removeGroupMember({ conversationId: ID, userId: ID2 }), adminOnly: true },
  { name: "renameGroupChat", run: () => actions.renameGroupChat({ conversationId: ID, title: "New name" }), adminOnly: true },
  { name: "deleteGroupChat", run: () => actions.deleteGroupChat({ conversationId: ID }), adminOnly: true },
  { name: "listGroupsToManage", run: () => actions.listGroupsToManage(), adminOnly: true },
  { name: "syncChatChannels", run: () => actions.syncChatChannels(), adminOnly: true },
  { name: "loadGroupPeopleToManage", run: () => actions.loadGroupPeopleToManage({ conversationId: ID }), adminOnly: true },
];
const badInput: { name: string; run: () => Promise<{ ok: boolean; error?: string }>; role: RoleSlug }[] = [
  { name: "openDirectMessage", run: () => actions.openDirectMessage({}), role: "employee" },
  { name: "sendChatMessage", run: () => actions.sendChatMessage({}), role: "employee" },
  { name: "editChatMessage", run: () => actions.editChatMessage({}), role: "employee" },
  { name: "deleteChatMessage", run: () => actions.deleteChatMessage({}), role: "employee" },
  { name: "markConversationRead", run: () => actions.markConversationRead({}), role: "employee" },
  { name: "loadChatMessages", run: () => actions.loadChatMessages({}), role: "employee" },
  { name: "searchPeopleForChat", run: () => actions.searchPeopleForChat({ q: "x".repeat(61) }), role: "employee" },
  { name: "toggleChatReaction", run: () => actions.toggleChatReaction({}), role: "employee" },
  { name: "createChatPoll", run: () => actions.createChatPoll({}), role: "employee" },
  { name: "voteChatPoll", run: () => actions.voteChatPoll({}), role: "employee" },
  { name: "requestChatUpload", run: () => actions.requestChatUpload({}), role: "employee" },
  { name: "finalizeChatUpload", run: () => actions.finalizeChatUpload({}), role: "employee" },
  { name: "searchChatMessages", run: () => actions.searchChatMessages({ q: "x".repeat(101) }), role: "employee" },
  { name: "muteChatConversation", run: () => actions.muteChatConversation({}), role: "employee" },
  { name: "saveMyChatSettings", run: () => actions.saveMyChatSettings({}), role: "employee" },
  { name: "pinChatMessage", run: () => actions.pinChatMessage({}), role: "employee" },
  { name: "unpinChatMessage", run: () => actions.unpinChatMessage({}), role: "employee" },
  { name: "loadChatThread", run: () => actions.loadChatThread({}), role: "employee" },
  { name: "listChatPins", run: () => actions.listChatPins({}), role: "employee" },
  { name: "createGroupConversation", run: () => actions.createGroupConversation({}), role: "hr_admin" },
  { name: "addGroupMembers", run: () => actions.addGroupMembers({}), role: "hr_admin" },
  { name: "removeGroupMember", run: () => actions.removeGroupMember({}), role: "hr_admin" },
  { name: "renameGroupChat", run: () => actions.renameGroupChat({}), role: "super_admin" },
  { name: "deleteGroupChat", run: () => actions.deleteGroupChat({}), role: "super_admin" },
  { name: "loadGroupPeopleToManage", run: () => actions.loadGroupPeopleToManage({}), role: "hr_admin" },
];

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("messages actions, every role", () => {
  for (const role of ROLE_SLUGS) {
    for (const { name, run, adminOnly } of valid) {
      const allowed = !adminOnly || ADMINS.includes(role);
      it(`${role}: ${allowed ? `may ${name} (refused only later, by membership, not by role)` : `is refused ${name}`}`, async () => {
        as(role);
        const result = await run();
        if (allowed) expect(result.ok === false && result.error).not.toBe(NO_ACCESS);
        else expect(result).toEqual({ ok: false, error: NO_ACCESS });
      });
    }
  }
});

describe("messages actions, input and sign-in", () => {
  for (const { name, run, role } of badInput) {
    it(`${name}: bad input is refused before the database`, async () => {
      as(role);
      expect(await run()).toEqual({ ok: false, error: BAD });
    });
  }
  for (const { name, run } of valid) {
    it(`${name}: someone who is not signed in gets nothing`, async () => {
      currentUser.fail = true;
      await expect(run()).rejects.toThrow("not signed in");
    });
  }
});
