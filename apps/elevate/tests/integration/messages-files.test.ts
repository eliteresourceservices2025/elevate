import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FakeStorage } from "./fake-storage";

// Real-database tests for files, pictures and voice notes in chat (Phase 2d), with an in-memory storage.

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.83" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const { setDocumentStorage, BUCKETS } = await import("@/modules/documents/storage");
const service = await import("@/modules/messages/service");
const uploads = await import("@/modules/messages/uploads");
const queries = await import("@/modules/messages/queries");

type Actor = { id: string; email: string; roles: string[] };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
const rows = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const as = (u: Actor) => {
  current.user = u;
};
const storage = new FakeStorage();
beforeAll(() => setDocumentStorage(storage));

async function makeUser(label: string): Promise<Actor> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email, roles: ["employee"] };
}
async function group(creator: Actor, others: Actor[]) {
  return (await service.createGroup(creator, { title: "Crew", memberUserIds: others.map((o) => o.id) })).conversationId;
}

const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));
/** A small JPEG that carries a GPS note in its EXIF segment. */
function jpegWithGps(): Uint8Array {
  const seg = (marker: number, body: number[]) => [0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body];
  return Uint8Array.from([0xff, 0xd8, ...seg(0xe0, [...ascii("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...seg(0xe1, [...ascii("Exif"), 0, 0, ...ascii("GPSLatitude=14.5995")]), 0xff, 0xda, 0, 4, 1, 2, 7, 7, 0xff, 0xd9]);
}
const webm = () => Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const pdf = () => Uint8Array.from([...ascii("%PDF-1.7\n"), ...ascii("1 0 obj <<>> endobj\n%%EOF")]);

/** The whole upload dance: ask, the browser uploads, finalize. */
async function upload(actor: Actor, conversationId: string, file: { name: string; mime: string; kind: "image" | "file" | "voice"; bytes: Uint8Array; durationS?: number }) {
  const ticket = await uploads.requestUpload(actor, { conversationId, fileName: file.name, size: file.bytes.length, mime: file.mime, kind: file.kind, durationS: file.durationS });
  storage.put(ticket.bucket, ticket.path, file.bytes);
  return { ticket, done: await uploads.finalizeUpload(actor, { attachmentId: ticket.id }) };
}

describe("uploads", () => {
  it("a picture is checked by its bytes and loses its GPS note; the name is cleaned", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const { ticket, done } = await upload(a, conv, { name: "../../clinic front desk.JPG", mime: "image/jpeg", kind: "image", bytes: jpegWithGps() });
    expect(done).toMatchObject({ kind: "image", mime: "image/jpeg" });
    expect(done.name).toBe("clinic front desk.jpg");
    const stored = await storage.read(ticket.bucket as typeof BUCKETS.chat, ticket.path);
    expect(Buffer.from(stored!).includes(Buffer.from("GPSLatitude"))).toBe(false);
    expect(Buffer.from(stored!).includes(Buffer.from("JFIF"))).toBe(true);
    const [row] = await rows<{ status: string; size: number; sha256: string; name_enc: string }>(sql`select status, size, sha256, name_enc from chat.message_attachments where id = ${ticket.id}`);
    expect(row.status).toBe("active");
    expect(row.size).toBe(stored!.length);
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.name_enc).not.toContain("clinic");
  });

  it("refuses a file whose bytes are not what it says, and removes it", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const ticket = await uploads.requestUpload(a, { conversationId: conv, fileName: "report.pdf", size: 40, mime: "application/pdf", kind: "file" });
    storage.put(ticket.bucket, ticket.path, Uint8Array.from(ascii("<html><script>alert(1)</script></html>")));
    await expect(uploads.finalizeUpload(a, { attachmentId: ticket.id })).rejects.toThrow("isn't an allowed");
    expect(await storage.read(ticket.bucket as typeof BUCKETS.chat, ticket.path)).toBeNull();
    const [row] = await rows<{ status: string }>(sql`select status from chat.message_attachments where id = ${ticket.id}`);
    expect(row.status).toBe("rejected");
  });

  it("a voice note is checked as audio; text pretending to be audio is refused", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const { done } = await upload(a, conv, { name: "voice.webm", mime: "audio/webm;codecs=opus", kind: "voice", bytes: webm(), durationS: 12 });
    expect(done).toMatchObject({ kind: "voice", mime: "audio/webm", durationS: 12 });
    const bad = await uploads.requestUpload(a, { conversationId: conv, fileName: "voice.webm", size: 30, mime: "audio/webm", kind: "voice", durationS: 3 });
    storage.put(bad.bucket, bad.path, Uint8Array.from(ascii("just some plain text, not audio")));
    await expect(uploads.finalizeUpload(a, { attachmentId: bad.id })).rejects.toThrow("isn't an allowed");
  });

  it("refuses at the request: too big, too long, wrong type, not a member, too many waiting", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const stranger = await makeUser("s");
    const conv = await group(a, [b, c]);
    const base = { conversationId: conv, fileName: "x.pdf", size: 100, mime: "application/pdf", kind: "file" as const };
    await expect(uploads.requestUpload(a, { ...base, size: 10 * 1024 * 1024 + 1 })).rejects.toThrow("10 MB");
    await expect(uploads.requestUpload(a, { ...base, kind: "voice", mime: "audio/webm", size: 6 * 1024 * 1024, durationS: 5 })).rejects.toThrow("5 MB");
    await expect(uploads.requestUpload(a, { ...base, kind: "voice", mime: "audio/webm", durationS: 121 })).rejects.toThrow("2 minutes");
    await expect(uploads.requestUpload(a, { ...base, mime: "application/x-msdownload", fileName: "setup.exe" })).rejects.toThrow("isn't an allowed");
    await expect(uploads.requestUpload(stranger, base)).rejects.toThrow("Conversation not found.");
    for (let i = 0; i < 10; i++) await uploads.requestUpload(a, base);
    await expect(uploads.requestUpload(a, base)).rejects.toThrow("waiting");
  });

  it("only the uploader can finalize", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const ticket = await uploads.requestUpload(a, { conversationId: conv, fileName: "x.pdf", size: 40, mime: "application/pdf", kind: "file" });
    storage.put(ticket.bucket, ticket.path, pdf());
    await expect(uploads.finalizeUpload(b, { attachmentId: ticket.id })).rejects.toThrow("Upload not found.");
    await expect(uploads.finalizeUpload(a, { attachmentId: ticket.id })).resolves.toBeDefined();
  });
});

describe("sending and reading attachments", () => {
  it("a message with a picture shows it to members with the cleaned name, and only finished uploads of the sender can be attached", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const conv = await group(a, [b, c]);
    const other = await group(a, [b, c]);
    const { done } = await upload(a, conv, { name: "front desk.jpg", mime: "image/jpeg", kind: "image", bytes: jpegWithGps() });
    const pending = await uploads.requestUpload(a, { conversationId: conv, fileName: "later.pdf", size: 40, mime: "application/pdf", kind: "file" });
    const theirs = await upload(b, conv, { name: "mine.jpg", mime: "image/jpeg", kind: "image", bytes: jpegWithGps() });
    const elsewhere = await upload(a, other, { name: "elsewhere.jpg", mime: "image/jpeg", kind: "image", bytes: jpegWithGps() });

    await expect(service.sendMessage(a, { conversationId: conv, body: "", attachmentIds: [pending.id] })).rejects.toThrow("attachment");
    await expect(service.sendMessage(a, { conversationId: conv, body: "", attachmentIds: [theirs.done.id] })).rejects.toThrow("attachment");
    await expect(service.sendMessage(a, { conversationId: conv, body: "", attachmentIds: [elsewhere.done.id] })).rejects.toThrow("attachment");
    await expect(service.sendMessage(a, { conversationId: conv, body: "", attachmentIds: [] })).rejects.toThrow();

    const sent = await service.sendMessage(a, { conversationId: conv, body: "Here is the desk", attachmentIds: [done.id] });
    await expect(service.sendMessage(a, { conversationId: conv, body: "again", attachmentIds: [done.id] })).rejects.toThrow("attachment"); // already used
    as(b);
    const m = (await queries.loadMessages({ conversationId: conv })).messages.find((x) => x.id === sent.id)!;
    expect(m).toMatchObject({ kind: "image", body: "Here is the desk" });
    expect(m.attachments).toEqual([expect.objectContaining({ id: done.id, kind: "image", name: "front desk.jpg", mime: "image/jpeg" })]);
  });

  it("the viewer rule: members from their join time on; strangers, removed members and removed messages get nothing", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const d = await makeUser("d");
    const stranger = await makeUser("s");
    const conv = await group(a, [b, c]);
    const { done } = await upload(a, conv, { name: "plan.pdf", mime: "application/pdf", kind: "file", bytes: pdf() });
    // Before it is sent, only the uploader can see it.
    await expect(uploads.loadAttachmentForViewer(b, done.id)).rejects.toThrow("File not found.");
    await expect(uploads.loadAttachmentForViewer(a, done.id)).resolves.toMatchObject({ mime: "application/pdf", kind: "file" });
    const sent = await service.sendMessage(a, { conversationId: conv, body: "the plan", attachmentIds: [done.id] });
    const seen = await uploads.loadAttachmentForViewer(b, done.id);
    expect(seen.name).toBe("plan.pdf");
    expect(Buffer.from(seen.bytes).toString("latin1")).toContain("%PDF-1.7");
    await expect(uploads.loadAttachmentForViewer(stranger, done.id)).rejects.toThrow("File not found.");
    await db.execute(sql`select pg_sleep(0.05)`);
    await service.addMembers(a, conv, [d.id]);
    await expect(uploads.loadAttachmentForViewer(d, done.id)).rejects.toThrow("File not found."); // sent before d joined
    await service.removeMember(a, { conversationId: conv, userId: c.id });
    await expect(uploads.loadAttachmentForViewer(c, done.id)).rejects.toThrow("File not found.");
    await service.deleteMessage(a, sent.id);
    await expect(uploads.loadAttachmentForViewer(b, done.id)).rejects.toThrow("File not found.");
  });
});
