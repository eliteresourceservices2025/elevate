import { describe, expect, it, vi } from "vitest";
import { connectCallChannel, type CallChannelClient, type CallEventMessage, type CallPresence } from "./call-channel";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const CALL = "22222222-2222-4222-8222-222222222222";
const flush = () => new Promise((r) => setTimeout(r, 0));

function fake(token: string | null = "jwt") {
  let sync = () => {};
  let broadcast: (m: { payload: CallEventMessage }) => void = () => {};
  let status: (s: string) => void = () => {};
  let state: Record<string, unknown[]> = {};
  const track = vi.fn();
  const topics: unknown[] = [];
  const channel = {
    on: vi.fn((type: string, _filter: unknown, cb: never) => {
      if (type === "presence") sync = cb as () => void;
      else broadcast = cb as (m: { payload: CallEventMessage }) => void;
      return channel;
    }),
    subscribe: vi.fn((cb: (s: string) => void) => {
      status = cb;
      return channel;
    }),
    presenceState: () => state,
    track,
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) },
    realtime: { setAuth: vi.fn() },
    channel: vi.fn((topic: string, options: unknown) => (topics.push([topic, options]), channel)),
    removeChannel: vi.fn(),
  } as unknown as CallChannelClient;
  return { client, track, topics, status: (s: string) => status(s), setState: (s: Record<string, unknown[]>) => ((state = s), sync()), emit: (p: CallEventMessage) => broadcast({ payload: p }) };
}

describe("connectCallChannel", () => {
  it("joins the private call channel keyed by the person and announces my state once subscribed", async () => {
    const f = fake();
    connectCallChannel(f.client, CALL, USER, { muted: false, hand: false }, { presence: () => {}, event: () => {} });
    await flush();
    expect(f.topics).toEqual([[`call:${CALL}`, { config: { private: true, presence: { key: USER } } }]]);
    f.status("SUBSCRIBED");
    expect(f.track).toHaveBeenCalledWith({ muted: false, hand: false });
  });

  it("reports everyone's mute and hand from presence, ignoring malformed entries, and passes server events", async () => {
    const f = fake();
    const seen: Record<string, CallPresence>[] = [];
    const events: CallEventMessage[] = [];
    connectCallChannel(f.client, CALL, USER, { muted: false, hand: false }, { presence: (p) => seen.push(p), event: (e) => events.push(e) });
    await flush();
    f.setState({ [USER]: [{ muted: true, hand: false }], [OTHER]: [{ muted: false, hand: false }, { muted: false, hand: true }], junk: [{ muted: "yes" }] });
    expect(seen.at(-1)).toEqual({ [USER]: { muted: true, hand: false }, [OTHER]: { muted: false, hand: true } });
    f.emit({ type: "tracks", callId: CALL });
    f.emit({ type: "ended", callId: "someone-elses-call" } as CallEventMessage);
    f.emit({ type: "hacked" as never, callId: CALL });
    expect(events).toEqual([{ type: "tracks", callId: CALL }]);
  });

  it("updates my own state after joining, and stops cleanly; does nothing without a session", async () => {
    const f = fake();
    const link = connectCallChannel(f.client, CALL, USER, { muted: false, hand: false }, { presence: () => {}, event: () => {} });
    await flush();
    f.status("SUBSCRIBED");
    link.update({ muted: true, hand: true });
    expect(f.track).toHaveBeenLastCalledWith({ muted: true, hand: true });
    link.stop();
    expect(f.client.removeChannel).toHaveBeenCalled();
    const none = fake(null);
    connectCallChannel(none.client, CALL, USER, { muted: false, hand: false }, { presence: () => {}, event: () => {} });
    await flush();
    expect(none.client.channel).not.toHaveBeenCalled();
  });
});
