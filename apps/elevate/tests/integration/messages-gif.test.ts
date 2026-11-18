import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

// Real-database tests for sending a GIF and for who may resolve its address (the proxy route calls gifUrlForViewer).

const current = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => current.user) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.87" }), cookies: async () => ({ get: () => undefined }) }));

const { db } = await import("@/lib/db");
const service = await import("@/modules/messages/service");
const { signGifUrl, verifyGifSignature } = await import("@/modules/messages/gif-sign");
const queries = await import("@/modules/messages/queries");

type Actor = { id: string; email: string };
let counter = 0;
const uniq = (p: string) => `${p}${Date.now().toString(36)}${counter++}`;
async function makeUser(label: string): Promise<Actor> {
  const id = randomUUID();
  const email = `${uniq(label)}@example.com`;
  await db.execute(sql`insert into core.users (id, email) values (${id}, ${email})`);
  return { id, email };
}
const URL_OK = "https://static.klipy.com/md/happy.gif";

describe("GIF signatures", () => {
  it("verify only for the exact address they were made for, and never for junk", () => {
    const sig = signGifUrl(URL_OK);
    expect(sig).toHaveLength(32);
    expect(verifyGifSignature(URL_OK, sig)).toBe(true);
    expect(verifyGifSignature(`${URL_OK}?x=1`, sig)).toBe(false);
    for (const bad of [undefined, null, 5, "", "short", sig.toUpperCase(), `${sig}x`]) expect(verifyGifSignature(URL_OK, bad)).toBe(false);
  });
});

describe("GIF messages", () => {
  it("a member sends an allowed GIF; members resolve it; outsiders and removed people cannot; the address is stored encrypted", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const stranger = await makeUser("s");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    const gif = await service.sendGif(a, { conversationId, url: URL_OK, sig: signGifUrl(URL_OK) });
    expect(await service.gifUrlForViewer(b, gif.id)).toBe(URL_OK);
    await expect(service.gifUrlForViewer(stranger, gif.id)).rejects.toThrow("not found");
    const stored = (await db.execute(sql`select kind, body_enc from chat.messages where id = ${gif.id}`)) as unknown as { kind: string; body_enc: string }[];
    expect(stored[0].kind).toBe("gif");
    expect(stored[0].body_enc).not.toContain("klipy");
    current.user = { ...b, roles: ["employee"] };
    expect((await queries.loadMessages({ conversationId })).messages.some((m) => m.id === gif.id && m.kind === "gif")).toBe(true);
    await service.removeMember(a, { conversationId, userId: b.id });
    await expect(service.gifUrlForViewer(b, gif.id)).rejects.toThrow("not found");
  });

  it("refuses addresses that are not https KLIPY, and a non-gif message", async () => {
    const a = await makeUser("a");
    const b = await makeUser("b");
    const c = await makeUser("c");
    const { conversationId } = await service.createGroup(a, { title: "Crew", memberUserIds: [b.id, c.id] });
    for (const url of ["http://static.klipy.com/a.gif", "https://evil.example/a.gif", "https://klipy.com.evil.example/a.gif", "https://support.giphy.com/a.gif", "https://klipy.co/a.gif"]) {
      // Even with a valid signature of that very address, a host that is not an allowed media host is refused.
      await expect(service.sendGif(a, { conversationId, url, sig: signGifUrl(url) })).rejects.toThrow("can't be sent");
    }
    // An allowed host with no signature, a wrong one, or one made for a different address: refused (only GIFs our search returned can be posted).
    await expect(service.sendGif(a, { conversationId, url: URL_OK, sig: "0".repeat(32) })).rejects.toThrow("can't be sent");
    await expect(service.sendGif(a, { conversationId, url: URL_OK, sig: signGifUrl("https://static.klipy.com/other.gif") })).rejects.toThrow("can't be sent");
    const text = await service.sendMessage(a, { conversationId, body: "hello" });
    await expect(service.gifUrlForViewer(b, text.id)).rejects.toThrow("not found");
  });
});
