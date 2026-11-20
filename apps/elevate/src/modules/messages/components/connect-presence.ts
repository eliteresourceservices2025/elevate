// Who is looking at a conversation right now, as plain functions so it can be tested without React. It joins the private channel
// conv:<id> (the database policy lets only current members in) with Supabase Presence. Only the person's own id is shared, nothing is
// stored, and someone who chose "Appear offline" watches without announcing themself. This is an "online dot", never a monitoring tool:
// it says nothing about activity, time or where.

type PresenceChannel = {
  on(type: "presence", filter: { event: "sync" }, callback: () => void): PresenceChannel;
  subscribe(callback: (status: string) => void): PresenceChannel;
  presenceState(): Record<string, unknown>;
  track(payload: Record<string, never>): unknown;
};

export type PresenceClient = {
  auth: { getSession(): Promise<{ data: { session: { access_token: string } | null } }> };
  realtime: { setAuth(token?: string): unknown };
  channel(topic: string, options: { config: { private: boolean; presence: { key: string } } }): PresenceChannel;
  removeChannel(channel: PresenceChannel): unknown;
};

/** Joins the conversation's presence. `onChange` gets the ids of the people online (including yourself when you announce). Returns the stop function. */
export function connectPresence(client: PresenceClient, conversationId: string, userId: string, announce: boolean, onChange: (online: Set<string>) => void): () => void {
  let stopped = false;
  let channel: PresenceChannel | null = null;
  void (async () => {
    try {
      const { data } = await client.auth.getSession();
      if (stopped || !data.session) return;
      client.realtime.setAuth(data.session.access_token);
      const joined = client.channel(`conv:${conversationId}`, { config: { private: true, presence: { key: userId } } });
      channel = joined;
      joined
        .on("presence", { event: "sync" }, () => {
          if (!stopped) onChange(new Set(Object.keys(joined.presenceState())));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED" && announce && !stopped) void joined.track({});
        });
    } catch {
      // No presence: nobody shows as online, and nothing else depends on it.
    }
  })();
  return () => {
    stopped = true;
    if (channel) void client.removeChannel(channel);
  };
}
