import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { broadcastChatSignal } = await import("./realtime");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";

function configured() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("SUPABASE_SECRET_KEY", "test-secret");
}

describe("ChatSignal", () => {
  it("has no text-like keys (it carries ids only)", () => {
    const source = fs.readFileSync(path.resolve(import.meta.dirname, "realtime-types.ts"), "utf8");
    const block = source.match(/export type ChatSignal = \{[\s\S]*?\n\};?/)?.[0] ?? "";
    expect(block).not.toBe("");
    expect(block).not.toMatch(/\b(body|text|content|message:|preview|title|name)\b/i);
  });
});

describe("broadcastChatSignal", () => {
  it("posts one private message per user on topic user:<id> with event chat", async () => {
    configured();
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    await broadcastChatSignal([ID1, ID2], { type: "message", conversationId: CONV, messageId: ID1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:54321/realtime/v1/api/broadcast");
    expect((init.headers as Record<string, string>).apikey).toBe("test-secret");
    const body = JSON.parse(init.body as string) as { messages: { topic: string; event: string; private: boolean; payload: unknown }[] };
    expect(body.messages.map((m) => m.topic)).toEqual([`user:${ID1}`, `user:${ID2}`]);
    expect(body.messages.every((m) => m.event === "chat" && m.private === true)).toBe(true);
    expect(body.messages[0].payload).toEqual({ type: "message", conversationId: CONV, messageId: ID1 });
  });

  it("splits a big group into requests of at most 100 people (a 200-person group)", async () => {
    configured();
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const people = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await broadcastChatSignal(people, { type: "message", conversationId: CONV, messageId: ID1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map((call) => (JSON.parse((call as unknown as [string, RequestInit])[1].body as string) as { messages: unknown[] }).messages.length);
    expect(sizes).toEqual([100, 100, 50]);
  });

  it("never throws when the request fails", async () => {
    configured();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(broadcastChatSignal([ID1], { type: "read", conversationId: CONV })).resolves.toBeUndefined();
  });

  it("does nothing when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await broadcastChatSignal([ID1], { type: "read", conversationId: CONV });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does nothing for an empty list of people", async () => {
    configured();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await broadcastChatSignal([], { type: "read", conversationId: CONV });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
