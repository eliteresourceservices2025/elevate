import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSignal } from "../realtime-types";
import { POLL_MS, connectChatLive, type LiveClient } from "./connect-live";

const USER = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";

type Handler = (msg: { payload: ChatSignal }) => void;

function fakeClient(token: string | null = "jwt-token") {
  const calls: string[] = [];
  let handler: Handler | null = null;
  let statusCb: ((status: string) => void) | null = null;
  const channel = {
    on: vi.fn((_type: "broadcast", _filter: { event: string }, cb: Handler) => {
      handler = cb;
      return channel;
    }),
    subscribe: vi.fn((cb: (status: string) => void) => {
      statusCb = cb;
      return channel;
    }),
  };
  const client: LiveClient = {
    auth: { getSession: vi.fn(async () => ({ data: { session: token ? { access_token: token } : null } })) },
    realtime: { setAuth: vi.fn((t?: string) => void calls.push(`setAuth:${t}`)) },
    channel: vi.fn((topic: string) => {
      calls.push(`channel:${topic}`);
      return channel;
    }),
    removeChannel: vi.fn(() => void calls.push("removed")),
  };
  return { client, channel, calls, emit: (p: ChatSignal) => handler?.({ payload: p }), status: (s: string) => statusCb?.(s) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("connectChatLive", () => {
  it("subscribes to the private channel user:<id> after setAuth with the session token", async () => {
    const f = fakeClient();
    connectChatLive(f.client, USER, () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(f.calls).toEqual(["setAuth:jwt-token", `channel:user:${USER}`]);
    expect(f.client.channel).toHaveBeenCalledWith(`user:${USER}`, { config: { private: true } });
    expect(f.channel.on).toHaveBeenCalledWith("broadcast", { event: "chat" }, expect.any(Function));
  });

  it("calls onSignal when a broadcast arrives", async () => {
    const f = fakeClient();
    const seen: ChatSignal[] = [];
    connectChatLive(f.client, USER, (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(0);
    f.emit({ type: "message", conversationId: CONV, messageId: "m1" });
    expect(seen).toEqual([{ type: "message", conversationId: CONV, messageId: "m1" }]);
  });

  it("polls every 20 s while not subscribed and stops polling once subscribed", async () => {
    const f = fakeClient();
    const seen: ChatSignal[] = [];
    connectChatLive(f.client, USER, (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ conversationId: "" });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(seen).toHaveLength(2);
    f.status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(seen).toHaveLength(2);
    f.status("CHANNEL_ERROR");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(seen).toHaveLength(3);
  });

  it("reports whether it is live", async () => {
    const f = fakeClient();
    const states: boolean[] = [];
    connectChatLive(f.client, USER, () => {}, (live) => states.push(live));
    await vi.advanceTimersByTimeAsync(0);
    f.status("SUBSCRIBED");
    f.status("TIMED_OUT");
    expect(states).toEqual([true, false]);
  });

  it("removes the channel and stops polling when stopped", async () => {
    const f = fakeClient();
    const seen: ChatSignal[] = [];
    const stop = connectChatLive(f.client, USER, (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(f.client.removeChannel).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(seen).toHaveLength(0);
  });

  it("does not subscribe at all when stopped before the session loads", async () => {
    const f = fakeClient();
    const stop = connectChatLive(f.client, USER, () => {});
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.client.channel).not.toHaveBeenCalled();
  });

  it("keeps polling (and never throws) when there is no session", async () => {
    const f = fakeClient(null);
    const seen: ChatSignal[] = [];
    connectChatLive(f.client, USER, (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(f.client.channel).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
  });
});
