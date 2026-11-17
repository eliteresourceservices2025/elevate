import { describe, expect, it, vi } from "vitest";
import { connectPresence, type PresenceClient } from "./connect-presence";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "33333333-3333-4333-8333-333333333333";
const CONV = "22222222-2222-4222-8222-222222222222";

function fake(token: string | null = "jwt") {
  let sync: () => void = () => {};
  let status: (s: string) => void = () => {};
  let state: Record<string, unknown> = {};
  const track = vi.fn();
  const options: unknown[] = [];
  const channel = {
    on: vi.fn((_t: "presence", _f: { event: "sync" }, cb: () => void) => {
      sync = cb;
      return channel;
    }),
    subscribe: vi.fn((cb: (s: string) => void) => {
      status = cb;
      return channel;
    }),
    presenceState: () => state,
    track,
  };
  const client: PresenceClient = {
    auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) },
    realtime: { setAuth: vi.fn() },
    channel: vi.fn((topic: string, o) => {
      options.push([topic, o]);
      return channel;
    }),
    removeChannel: vi.fn(),
  };
  return { client, track, options, setState: (s: Record<string, unknown>) => ((state = s), sync()), status: (s: string) => status(s) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("connectPresence", () => {
  it("joins the private conversation channel keyed by the person and reports who is online", async () => {
    const f = fake();
    const seen: string[][] = [];
    connectPresence(f.client, CONV, USER, true, (s) => seen.push([...s].sort()));
    await flush();
    expect(f.options).toEqual([[`conv:${CONV}`, { config: { private: true, presence: { key: USER } } }]]);
    f.status("SUBSCRIBED");
    expect(f.track).toHaveBeenCalledWith({});
    f.setState({ [USER]: [{}], [OTHER]: [{}] });
    expect(seen.at(-1)).toEqual([USER, OTHER].sort());
  });

  it("appearing offline watches without announcing", async () => {
    const f = fake();
    connectPresence(f.client, CONV, USER, false, () => {});
    await flush();
    f.status("SUBSCRIBED");
    expect(f.track).not.toHaveBeenCalled();
  });

  it("does nothing without a session, and stops cleanly", async () => {
    const none = fake(null);
    const stop = connectPresence(none.client, CONV, USER, true, () => {});
    await flush();
    expect(none.client.channel).not.toHaveBeenCalled();
    stop();
    const f = fake();
    const stop2 = connectPresence(f.client, CONV, USER, true, () => {});
    await flush();
    stop2();
    expect(f.client.removeChannel).toHaveBeenCalled();
  });
});
