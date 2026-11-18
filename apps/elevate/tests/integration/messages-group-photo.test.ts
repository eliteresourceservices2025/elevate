import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FakeStorage } from "./fake-storage";

// The picture of a group or channel: HR uploads it without being in the group, only its members (and managers) can fetch it,
// and it follows the same byte checks as any chat picture.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.91" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const { setDocumentStorage } = await import("@/modules/documents/storage");
const service = await import("@/modules/messages/service");
const uploads = await import("@/modules/messages/uploads");
const queries = await import("@/modules/messages/queries");

type Actor = { id: string; email: string; roles: string[] };
let counter = 0;
const storage = new FakeStorage();
beforeAll(() => setDocumentStorage(storage));
async function makeUser(label: string): Promise<Actor> {
  const id = randomUUID();
  const email = `${label}${Date.now().toString(36)}${counter++}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email, roles: ["employee"] };
}
const png = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);
async function uploadPhoto(hr: Actor, conversationId: string, bytes: Uint8Array, mime = "image/png") {
  const ticket = await uploads.requestUpload(hr, { conversationId, fileName: "team.png", size: bytes.length, mime, kind: "image" }, "manager");
  storage.put(ticket.bucket, ticket.path, bytes);
  return uploads.finalizeUpload(hr, { attachmentId: ticket.id }, "manager");
}

describe("group and channel pictures", () => {
  it("HR sets one without being a member; members and managers can read it; strangers cannot; it shows in the list", async () => {
    const hr = await makeUser("hr");
    const creator = await makeUser("creator");
    const b = await makeUser("b");
    const stranger = await makeUser("s");
    const { conversationId } = await service.createChannel(creator, { title: "News", memberUserIds: [b.id], postingAdminsOnly: false });
    const done = await uploadPhoto(hr, conversationId, png());
    await service.setConversationPhoto(hr, { conversationId, attachmentId: done.id });

    expect((await uploads.loadConversationPhoto(b, conversationId, false)).mime).toBe("image/png");
    expect((await uploads.loadConversationPhoto(hr, conversationId, true)).bytes.length).toBeGreaterThan(0);
    await expect(uploads.loadConversationPhoto(stranger, conversationId, false)).rejects.toThrow("File not found.");
    current.user = { ...b, roles: ["employee"] };
    expect((await queries.listMyConversations()).find((c) => c.id === conversationId)!.photoAttachmentId).toBe(done.id);

    await service.setConversationPhoto(hr, { conversationId, attachmentId: null });
    await expect(uploads.loadConversationPhoto(b, conversationId, false)).rejects.toThrow("File not found.");
  });

  it("refuses a non-picture, someone else's upload, a picture from another chat, and a direct message", async () => {
    const hr = await makeUser("hr");
    const other = await makeUser("o");
    const a = await makeUser("a");
    const b = await makeUser("b");
    const g1 = (await service.createGroup(a, { title: "One", memberUserIds: [b.id, other.id] })).conversationId;
    const g2 = (await service.createGroup(a, { title: "Two", memberUserIds: [b.id, other.id] })).conversationId;
    // Text is not a picture: refused by its bytes.
    await expect(uploadPhoto(hr, g1, Uint8Array.from([0x68, 0x69, 0x21, 0x21]), "image/png")).rejects.toThrow();
    const done = await uploadPhoto(hr, g1, png());
    await expect(service.setConversationPhoto(other, { conversationId: g1, attachmentId: done.id })).rejects.toThrow("cannot be used");
    await expect(service.setConversationPhoto(hr, { conversationId: g2, attachmentId: done.id })).rejects.toThrow("cannot be used");
    const dm = (await service.openDirect(a, b.id)).conversationId;
    await expect(uploads.requestUpload(hr, { conversationId: dm, fileName: "x.png", size: 10, mime: "image/png", kind: "image" }, "manager")).rejects.toThrow("Group not found.");
    await expect(service.setConversationPhoto(hr, { conversationId: dm, attachmentId: done.id })).rejects.toThrow("Group not found.");
  });
});
