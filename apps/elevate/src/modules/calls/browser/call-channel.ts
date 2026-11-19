// A call's private Realtime channel call:<id>, as plain functions so it can be tested without React. The database policy lets a browser
// only TRACK PRESENCE here (mute, raised hand): the server sends everything else ("tracks changed", "roster changed", "ended"), so a
// participant can't fake those. Presence is only a hint for the little mute and hand icons; the server stays the authority on who is
// in the call and what they may pull.

export type CallPresence = { muted: boolean; hand: boolean };
export type CallEventMessage = { type: "tracks" | "roster" | "ended"; callId: string };

type CallChannel = {
  on(type: "presence", filter: { event: "sync" }, callback: () => void): CallChannel;
  on(type: "broadcast", filter: { event: string }, callback: (message: { payload: CallEventMessage }) => void): CallChannel;
  subscribe(callback: (status: string) => void): CallChannel;
  presenceState(): Record<string, unknown[]>;
  track(payload: CallPresence): unknown;
};

export type CallChannelClient = {
  auth: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> };
  realtime: { setAuth(token?: string): unknown };
  channel(topic: string, options: { config: { private: boolean; presence: { key: string } } }): CallChannel;
  removeChannel(channel: CallChannel): unknown;
};

const isPresence = (value: unknown): value is CallPresence => typeof value === "object" && value !== null && typeof (value as CallPresence).muted === "boolean" && typeof (value as CallPresence).hand === "boolean";

/** Joins the call channel. Returns `update` (publish my own mute / hand) and `stop`. Never throws: without it, icons just don't show. */
export function connectCallChannel(
  client: CallChannelClient,
  callId: string,
  userId: string,
  initial: CallPresence,
  on: { presence: (byUser: Record<string, CallPresence>) => void; event: (event: CallEventMessage) => void },
): { update: (next: CallPresence) => void; stop: () => void } {
  let stopped = false;
  let channel: CallChannel | null = null;
  let subscribed = false;
  let latest = initial;
  void (async () => {
    try {
      const { data } = await client.auth.getSession();
      if (stopped || !data.session) return;
      client.realtime.setAuth(data.session.access_token);
      const joined = client.channel(`call:${callId}`, { config: { private: true, presence: { key: userId } } });
      channel = joined;
      joined
        .on("presence", { event: "sync" }, () => {
          if (stopped) return;
          const byUser: Record<string, CallPresence> = {};
          for (const [key, entries] of Object.entries(joined.presenceState())) {
            const last = [...entries].reverse().find(isPresence);
            if (last) byUser[key] = { muted: last.muted, hand: last.hand };
          }
          on.presence(byUser);
        })
        .on("broadcast", { event: "call" }, (message) => {
          const event = message.payload;
          if (!stopped && event && (event.type === "tracks" || event.type === "roster" || event.type === "ended") && event.callId === callId) on.event(event);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED" && !stopped) {
            subscribed = true;
            void joined.track(latest);
          }
        });
    } catch {
      // No live channel: the 30-second heartbeat keeps the call current.
    }
  })();
  return {
    update(next) {
      latest = next;
      if (channel && subscribed && !stopped) void channel.track(next);
    },
    stop() {
      stopped = true;
      if (channel) void client.removeChannel(channel);
    },
  };
}
