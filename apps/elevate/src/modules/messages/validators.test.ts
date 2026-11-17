import { describe, expect, it } from "vitest";
import {
  MAX_BODY,
  MAX_GROUP,
  addMembersSchema,
  createGroupSchema,
  deleteGroupSchema,
  loadMessagesSchema,
  openDirectSchema,
  removeMemberSchema,
  renameGroupSchema,
  searchPeopleSchema,
  sendMessageSchema,
} from "./validators";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";

describe("message body", () => {
  it("rejects a whitespace-only body", () => {
    expect(sendMessageSchema.safeParse({ conversationId: ID, body: "   \n\t " }).success).toBe(false);
  });
  it("rejects a 4001-character body and accepts exactly 4000", () => {
    expect(sendMessageSchema.safeParse({ conversationId: ID, body: "a".repeat(MAX_BODY + 1) }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ conversationId: ID, body: "a".repeat(MAX_BODY) }).success).toBe(true);
  });
  it("trims the body", () => {
    const r = sendMessageSchema.parse({ conversationId: ID, body: "  hello  " });
    expect(r.body).toBe("hello");
  });
  it("rejects a conversation id that is not a uuid", () => {
    expect(sendMessageSchema.safeParse({ conversationId: "abc", body: "hi" }).success).toBe(false);
  });
});

describe("groups", () => {
  it("rejects a group with one other member (two people in total) and accepts two others", () => {
    expect(createGroupSchema.safeParse({ title: "Team", memberUserIds: [ID] }).success).toBe(false);
    expect(createGroupSchema.safeParse({ title: "Team", memberUserIds: [ID, ID2] }).success).toBe(true);
  });
  it("rejects duplicate member ids", () => {
    expect(createGroupSchema.safeParse({ title: "Team", memberUserIds: [ID, ID, ID2] }).success).toBe(false);
  });
  it("rejects an empty or too long title", () => {
    expect(createGroupSchema.safeParse({ title: "  ", memberUserIds: [ID, ID2] }).success).toBe(false);
    expect(createGroupSchema.safeParse({ title: "x".repeat(81), memberUserIds: [ID, ID2] }).success).toBe(false);
  });
  it("a group holds up to 200 people in total: 199 others are fine, 200 others are refused", () => {
    expect(MAX_GROUP).toBe(200);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(createGroupSchema.safeParse({ title: "Everyone", memberUserIds: ids(199) }).success).toBe(true);
    expect(createGroupSchema.safeParse({ title: "Everyone", memberUserIds: ids(200) }).success).toBe(false);
  });
  it("addMembers needs 1 to 50 unique people", () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(addMembersSchema.safeParse({ conversationId: ID, userIds: [] }).success).toBe(false);
    expect(addMembersSchema.safeParse({ conversationId: ID, userIds: [ID2, ID3] }).success).toBe(true);
    expect(addMembersSchema.safeParse({ conversationId: ID, userIds: [ID2, ID2] }).success).toBe(false);
    expect(addMembersSchema.safeParse({ conversationId: ID, userIds: ids(50) }).success).toBe(true);
    expect(addMembersSchema.safeParse({ conversationId: ID, userIds: ids(51) }).success).toBe(false);
  });
  it("rename needs a group id and a name of 1 to 80 characters, trimmed", () => {
    expect(renameGroupSchema.safeParse({ conversationId: ID, title: "  " }).success).toBe(false);
    expect(renameGroupSchema.safeParse({ conversationId: ID, title: "y".repeat(81) }).success).toBe(false);
    expect(renameGroupSchema.parse({ conversationId: ID, title: "  Front desk  " }).title).toBe("Front desk");
  });
  it("remove a member and delete a group need uuids", () => {
    expect(removeMemberSchema.safeParse({ conversationId: ID, userId: ID2 }).success).toBe(true);
    expect(removeMemberSchema.safeParse({ conversationId: ID, userId: "x" }).success).toBe(false);
    expect(deleteGroupSchema.safeParse({ conversationId: ID }).success).toBe(true);
    expect(deleteGroupSchema.safeParse({}).success).toBe(false);
  });
});

describe("loading and searching", () => {
  it("limit above 100 is refused and the default is 50", () => {
    expect(loadMessagesSchema.safeParse({ conversationId: ID, limit: 101 }).success).toBe(false);
    expect(loadMessagesSchema.parse({ conversationId: ID }).limit).toBe(50);
  });
  it("openDirect needs a uuid", () => {
    expect(openDirectSchema.safeParse({ userId: "nope" }).success).toBe(false);
  });
  it("search trims and caps the query at 60 characters", () => {
    expect(searchPeopleSchema.parse({ q: "  ana " }).q).toBe("ana");
    expect(searchPeopleSchema.safeParse({ q: "x".repeat(61) }).success).toBe(false);
  });
});
